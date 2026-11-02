const { createPublicKey, verify } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const {
  getDb,
  getFirebaseServiceAccount,
  isSameOrigin,
  nomineeIds,
  sendJson,
} = require("../server/admin");

let signingCertificates;
let certificatesExpireAt = 0;

async function getSigningCertificates() {
  if (signingCertificates && Date.now() < certificatesExpireAt) {
    return signingCertificates;
  }

  const response = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
    { signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) {
    throw new Error(`Firebase token certificates returned HTTP ${response.status}.`);
  }

  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1]) || 300;
  signingCertificates = await response.json();
  certificatesExpireAt = Date.now() + maxAge * 1000;
  return signingCertificates;
}

async function verifyAnonymousIdToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const certificates = await getSigningCertificates();
  const certificate = certificates[header.kid];
  if (typeof certificate !== "string") return null;

  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey(certificate),
    Buffer.from(parts[2], "base64url"),
  );
  const now = Math.floor(Date.now() / 1000);
  if (
    !validSignature
    || claims.aud !== projectId
    || claims.iss !== `https://securetoken.google.com/${projectId}`
    || typeof claims.sub !== "string"
    || claims.sub.length === 0
    || claims.sub.length > 128
    || !Number.isSafeInteger(claims.exp)
    || claims.exp <= now
    || !Number.isSafeInteger(claims.iat)
    || claims.iat > now + 300
    || claims.firebase?.sign_in_provider !== "anonymous"
  ) {
    return null;
  }

  return { uid: claims.sub };
}

module.exports = async function castVote(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  if (!isSameOrigin(request)) {
    return sendJson(response, 403, { error: "Vote request rejected." });
  }

  const authorization = request.headers.authorization;
  const tokenMatch = typeof authorization === "string"
    ? /^Bearer ([^\s]+)$/.exec(authorization)
    : null;
  if (!tokenMatch || tokenMatch[1].length > 8192) {
    return sendJson(response, 401, { error: "A voting session is required." });
  }

  const nomineeId = request.body?.nomineeId;
  if (typeof nomineeId !== "string" || !nomineeIds.includes(nomineeId)) {
    return sendJson(response, 400, { error: "Choose a nominee from the official ballot." });
  }

  try {
    const serviceAccount = getFirebaseServiceAccount();
    const db = getDb(serviceAccount);
    const voter = await verifyAnonymousIdToken(tokenMatch[1], serviceAccount.project_id);
    if (!voter) {
      return sendJson(response, 401, { error: "Your voting session has expired. Reload the ballot." });
    }

    const deviceRef = db.collection("devices").doc(voter.uid);
    const resultRef = db.collection("results").doc(nomineeId);
    await db.runTransaction(async (transaction) => {
      const deviceSnapshot = await transaction.get(deviceRef);
      if (deviceSnapshot.exists) {
        const error = new Error("This browser profile has already voted.");
        error.code = "already-voted";
        throw error;
      };

      const resultSnapshot = await transaction.get(resultRef);
      const currentVotes = resultSnapshot.exists ? resultSnapshot.get("votes") : 0;
      if (!Number.isSafeInteger(currentVotes) || currentVotes < 0 || currentVotes === Number.MAX_SAFE_INTEGER) {
        throw new Error(`Invalid vote total for ${nomineeId}.`);
      }

      transaction.create(deviceRef, {
        hasVoted: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(resultRef, {
        votes: currentVotes + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return sendJson(response, 200, { success: true });
  } catch (error) {
    if (error.code === "already-voted") {
      return sendJson(response, 409, { error: error.message });
    }
    console.error("Vote endpoint failed.", error);
    return sendJson(response, 503, { error: "Your vote could not be saved. Please try again." });
  }
}

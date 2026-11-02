const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();
const adminPassword = defineSecret("ADMIN_PASSWORD");
const adminUid = "ballon-dor-admin";
const nomineeIds = [
  "balaga",
  "chidoshi",
  "easy-rsa",
  "gbaby",
  "government",
  "jose-mourinho",
  "ligugela-t-stark",
  "mabunda-khehla",
  "malovhele-km",
  "manando",
  "mashau-m-dzembe",
  "mudau-mabai",
  "shepard",
  "shalulile",
  "thee-lowkeys",
  "thoni-respect",
  "vhalaudzi-uje",
  "vhaludzi-gwamasenga",
  "vho-lieba",
  "zwivhuya-sbuda",
];
const allowedNominees = new Set(nomineeIds);
const adminSessionLifetime = 30 * 60 * 1000;

function createAdminSession(expiresAt, password) {
  const signature = createHmac("sha256", password)
    .update(`${adminUid}:${expiresAt}`)
    .digest("base64url");
  return `${expiresAt}.${signature}`;
}

function isValidAdminSession(sessionToken, password) {
  if (typeof sessionToken !== "string" || sessionToken.length > 256) return false;
  const [expiry, signature, extra] = sessionToken.split(".");
  if (extra !== undefined || !/^\d{13}$/.test(expiry) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return false;
  }

  const expiresAt = Number(expiry);
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + adminSessionLifetime + 60_000) {
    return false;
  }

  const expected = createHmac("sha256", password)
    .update(`${adminUid}:${expiresAt}`)
    .digest();
  const supplied = Buffer.from(signature, "base64url");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

exports.castVote = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  const signInProvider = request.auth?.token?.firebase?.sign_in_provider;
  const nomineeId = request.data?.nomineeId;

  if (!uid || signInProvider !== "anonymous") {
    throw new HttpsError("unauthenticated", "A Firebase anonymous voting session is required.");
  }
  if (typeof nomineeId !== "string" || !allowedNominees.has(nomineeId)) {
    throw new HttpsError("invalid-argument", "Choose a nominee from the official ballot.");
  }

  const deviceRef = db.collection("devices").doc(uid);
  const resultRef = db.collection("results").doc(nomineeId);

  try {
    await db.runTransaction(async (transaction) => {
      const deviceSnapshot = await transaction.get(deviceRef);
      if (deviceSnapshot.exists) {
        throw new HttpsError("already-exists", "This browser profile has already voted.");
      }

      const resultSnapshot = await transaction.get(resultRef);
      const currentVotes = resultSnapshot.exists ? resultSnapshot.get("votes") : 0;
      if (!Number.isSafeInteger(currentVotes) || currentVotes < 0) {
        throw new HttpsError("internal", "The nominee's vote total is invalid.");
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
    return { success: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("Vote transaction failed.", error);
    throw new HttpsError("internal", "The vote could not be saved. Please try again.");
  }
});

exports.authenticateAdmin = onCall({
  region: "us-central1",
  secrets: [adminPassword],
  enforceAppCheck: false,
}, async (request) => {
  const submittedPassword = request.data?.password;
  const configuredPassword = adminPassword.value();

  if (typeof submittedPassword !== "string" || submittedPassword.length > 256) {
    throw new HttpsError("permission-denied", "The password is incorrect.");
  }
  if (configuredPassword.length < 32) {
    console.error("ADMIN_PASSWORD must be configured with at least 32 characters.");
    throw new HttpsError("failed-precondition", "Admin sign-in is not configured.");
  }

  const requestIp = request.rawRequest.ip
    || (process.env.FUNCTIONS_EMULATOR === "true" ? "emulator" : undefined);
  if (!requestIp) {
    throw new HttpsError("unavailable", "Could not verify this sign-in request. Please try again.");
  }

  const ipHash = createHash("sha256").update(requestIp).digest("hex");
  const attemptRef = db.collection("adminLoginAttempts").doc(ipHash);
  const now = Date.now();
  const windowMilliseconds = 15 * 60 * 1000;
  const maxAttempts = 10;

  const attemptState = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const data = snapshot.data();
    const windowStartedAt = data?.windowStartedAt?.toMillis() ?? 0;
    const previousWindowActive = now - windowStartedAt < windowMilliseconds;
    const attempts = previousWindowActive ? data?.attempts ?? 0 : 0;
    const blockedUntil = data?.blockedUntil?.toMillis() ?? 0;

    if (blockedUntil > now) {
      return { limited: true };
    }

    const nextAttempts = attempts + 1;
    transaction.set(attemptRef, {
      attempts: nextAttempts,
      windowStartedAt: previousWindowActive
        ? data.windowStartedAt
        : new Date(now),
      blockedUntil: nextAttempts >= maxAttempts
        ? new Date(now + windowMilliseconds)
        : null,
      expiresAt: new Date(now + windowMilliseconds * 2),
    });

    return { limited: false };
  });

  if (attemptState.limited) {
    throw new HttpsError("resource-exhausted", "Too many sign-in attempts. Please try again later.");
  }

  const submittedHash = createHash("sha256").update(submittedPassword).digest();
  const configuredHash = createHash("sha256").update(configuredPassword).digest();
  if (!timingSafeEqual(submittedHash, configuredHash)) {
    throw new HttpsError("permission-denied", "The password is incorrect.");
  }

  try {
    await attemptRef.delete();
    const expiresAt = Date.now() + adminSessionLifetime;
    return { sessionToken: createAdminSession(expiresAt, configuredPassword) };
  } catch (error) {
    console.error("Could not create an administrator session.", error);
    throw new HttpsError("internal", "Admin sign-in failed. Please try again.");
  }
});

exports.getAdminResults = onCall({
  region: "us-central1",
  secrets: [adminPassword],
}, async (request) => {
  const configuredPassword = adminPassword.value();
  if (configuredPassword.length < 32) {
    console.error("ADMIN_PASSWORD must be configured with at least 32 characters.");
    throw new HttpsError("failed-precondition", "Admin access is not configured.");
  }
  if (!isValidAdminSession(request.data?.sessionToken, configuredPassword)) {
    throw new HttpsError("unauthenticated", "Admin session expired. Sign in again.");
  }

  try {
    const references = nomineeIds.map((id) => db.collection("results").doc(id));
    const snapshots = await db.getAll(...references);
    const results = snapshots.map((snapshot, index) => {
      const votes = snapshot.exists ? snapshot.get("votes") : 0;
      if (!Number.isSafeInteger(votes) || votes < 0) {
        throw new HttpsError("internal", `Invalid vote total for ${nomineeIds[index]}.`);
      }
      return { id: nomineeIds[index], votes };
    });
    return { results };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("Could not load administrator results.", error);
    throw new HttpsError("internal", "Live results are unavailable. Please try again.");
  }
});

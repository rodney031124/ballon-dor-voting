const { getAuth } = require("firebase-admin/auth");
const { FieldValue } = require("firebase-admin/firestore");
const {
  getDb,
  getFirebaseServiceAccount,
  isSameOrigin,
  nomineeIds,
  sendJson,
} = require("../server/admin");

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
    let voter;
    try {
      voter = await getAuth().verifyIdToken(tokenMatch[1]);
    } catch (error) {
      if (["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired"].includes(error.code)) {
        return sendJson(response, 401, { error: "Your voting session has expired. Reload the ballot." });
      }
      throw error;
    }

    if (!voter.uid || voter.firebase?.sign_in_provider !== "anonymous") {
      return sendJson(response, 403, { error: "An anonymous voting session is required." });
    }

    const deviceRef = db.collection("devices").doc(voter.uid);
    const resultRef = db.collection("results").doc(nomineeId);
    await db.runTransaction(async (transaction) => {
      const deviceSnapshot = await transaction.get(deviceRef);
      if (deviceSnapshot.exists) {
        const error = new Error("This browser profile has already voted.");
        error.code = "already-voted";
        throw error;
      }

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
};

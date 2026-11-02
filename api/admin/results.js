const {
  getConfig,
  getDb,
  isSameOrigin,
  isValidSession,
  nomineeIds,
  readSessionCookie,
  sendJson,
} = require("../../server/admin");

module.exports = async function getAdminResults(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  if (!isSameOrigin(request)) {
    return sendJson(response, 403, { error: "Results request rejected." });
  }

  try {
    const { sessionSecret, serviceAccount } = getConfig();
    if (!isValidSession(readSessionCookie(request), sessionSecret)) {
      return sendJson(response, 401, { error: "Admin session expired. Sign in again." });
    }

    const db = getDb(serviceAccount);
    const references = nomineeIds.map((id) => db.collection("results").doc(id));
    const snapshots = await db.getAll(...references);
    const results = snapshots.map((snapshot, index) => {
      const votes = snapshot.exists ? snapshot.get("votes") : 0;
      if (!Number.isSafeInteger(votes) || votes < 0) {
        throw new Error(`Invalid vote total for ${nomineeIds[index]}.`);
      }
      return { id: nomineeIds[index], votes };
    });

    return sendJson(response, 200, { results });
  } catch (error) {
    console.error("Admin results endpoint failed.", error);
    return sendJson(response, 503, { error: "Live results are temporarily unavailable." });
  }
};

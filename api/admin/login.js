const {
  consumeLoginAttempt,
  createSessionToken,
  getClientIp,
  getConfig,
  getDb,
  isSameOrigin,
  passwordMatches,
  sendJson,
  setSessionCookie,
} = require("../../server/admin");

module.exports = async function loginAdmin(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  if (!isSameOrigin(request)) {
    return sendJson(response, 403, { error: "Sign-in request rejected." });
  }

  try {
    const { password, sessionSecret, serviceAccount } = getConfig();
    const submittedPassword = request.body?.password;
    if (typeof submittedPassword !== "string" || submittedPassword.length > 256) {
      return sendJson(response, 400, { error: "Enter a valid password." });
    }

    const ip = getClientIp(request);
    if (!ip) {
      return sendJson(response, 503, { error: "Could not verify this sign-in request." });
    }
    const db = getDb(serviceAccount);
    const attempt = await consumeLoginAttempt(db, ip);
    if (attempt.limited) {
      return sendJson(response, 429, { error: "Too many sign-in attempts. Try again later." });
    }

    if (!passwordMatches(submittedPassword, password)) {
      return sendJson(response, 401, { error: "The password is incorrect." });
    }

    await attempt.reference.delete();
    setSessionCookie(response, createSessionToken(sessionSecret), request);
    return sendJson(response, 200, { success: true });
  } catch (error) {
    console.error("Admin sign-in endpoint failed.", error);
    return sendJson(response, 503, { error: "Admin sign-in is temporarily unavailable." });
  }
};

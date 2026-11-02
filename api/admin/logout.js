const {
  clearSessionCookie,
  isSameOrigin,
  sendJson,
} = require("../../server/admin");

module.exports = function logoutAdmin(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  if (!isSameOrigin(request)) {
    return sendJson(response, 403, { error: "Sign-out request rejected." });
  }

  clearSessionCookie(response, request);
  return sendJson(response, 200, { success: true });
};

const crypto = require("node:crypto");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const sessionLifetime = 30 * 60 * 1000;
const sessionCookieName = "__Host-admin_session";
const maxAttempts = 10;
const loginWindow = 15 * 60 * 1000;
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

function getFirebaseServiceAccount() {
  const serviceAccountValue = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!serviceAccountValue) {
    throw new Error("Firebase server access is not configured.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(
      Buffer.from(serviceAccountValue, "base64").toString("utf8"),
    );
  } catch {
    throw new Error("Firebase server access is misconfigured.");
  }
  if (
    serviceAccount.project_id !== "school-ballon-d-or"
    || typeof serviceAccount.client_email !== "string"
    || typeof serviceAccount.private_key !== "string"
  ) {
    throw new Error("Firebase server access is misconfigured.");
  }

  return serviceAccount;
}

function getConfig() {
  const password = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (typeof password !== "string" || password.length < 32) {
    throw new Error("Admin sign-in is not configured.");
  }
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error("Admin sessions are not configured.");
  }

  return { password, sessionSecret, serviceAccount: getFirebaseServiceAccount() };
}

function getDb(serviceAccount) {
  const app = getApps()[0] || initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  return getFirestore(app);
}

function passwordMatches(submittedPassword, configuredPassword) {
  if (typeof submittedPassword !== "string" || submittedPassword.length > 256) {
    return false;
  }
  const submittedHash = crypto.createHash("sha256").update(submittedPassword).digest();
  const configuredHash = crypto.createHash("sha256").update(configuredPassword).digest();
  return crypto.timingSafeEqual(submittedHash, configuredHash);
}

function getClientIp(request) {
  const realIp = request.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",").at(-1).trim();
  }
  return null;
}

async function consumeLoginAttempt(db, ip) {
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
  const reference = db.collection("adminLoginAttempts").doc(ipHash);
  const now = Date.now();

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    const windowStartedAt = data?.windowStartedAt?.toMillis() || 0;
    const previousWindowActive = now - windowStartedAt < loginWindow;
    const attempts = previousWindowActive && Number.isSafeInteger(data?.attempts)
      ? data.attempts
      : 0;
    const blockedUntil = data?.blockedUntil?.toMillis() || 0;

    if (blockedUntil > now) return { limited: true };

    const nextAttempts = attempts + 1;
    transaction.set(reference, {
      attempts: nextAttempts,
      windowStartedAt: previousWindowActive
        ? data.windowStartedAt
        : Timestamp.fromMillis(now),
      blockedUntil: nextAttempts >= maxAttempts
        ? Timestamp.fromMillis(now + loginWindow)
        : null,
      expiresAt: Timestamp.fromMillis(now + loginWindow * 2),
    });
    return { limited: false };
  });

  return { ...result, reference };
}

function signSession(expiresAt, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`school-ballon-admin:${expiresAt}`)
    .digest("base64url");
}

function createSessionToken(secret) {
  const expiresAt = Date.now() + sessionLifetime;
  return `${expiresAt}.${signSession(expiresAt, secret)}`;
}

function isValidSession(token, secret) {
  if (typeof token !== "string" || token.length > 256) return false;
  const [expiry, signature, extra] = token.split(".");
  if (
    extra !== undefined
    || !/^\d{13}$/.test(expiry)
    || !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return false;
  }

  const expiresAt = Number(expiry);
  const now = Date.now();
  if (
    !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || expiresAt > now + sessionLifetime + 60_000
  ) {
    return false;
  }

  const expected = Buffer.from(signSession(expiresAt, secret), "base64url");
  const supplied = Buffer.from(signature, "base64url");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function readSessionCookie(request) {
  const cookies = request.headers.cookie || "";
  const prefix = `${sessionCookieName}=`;
  const cookie = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : "";
}

function setSessionCookie(response, token, request) {
  const secure = process.env.VERCEL === "1"
    || request.headers["x-forwarded-proto"] === "https";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(response, request) {
  const secure = process.env.VERCEL === "1"
    || request.headers["x-forwarded-proto"] === "https";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

function sendJson(response, status, body) {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.status(status).json(body);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return true;

  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers.host;
  if (!host) return false;

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

module.exports = {
  clearSessionCookie,
  consumeLoginAttempt,
  createSessionToken,
  getClientIp,
  getConfig,
  getDb,
  getFirebaseServiceAccount,
  isSameOrigin,
  isValidSession,
  nomineeIds,
  passwordMatches,
  readSessionCookie,
  sendJson,
  setSessionCookie,
};

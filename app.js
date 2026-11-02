require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "school-ballon-d-or";
const voterHashSecret = process.env.VOTER_HASH_SECRET;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const adminCookieName = "ballondor.admin";
const adminSessionLifetime = 8 * 60 * 60;

const nominees = [
  { id: "balaga", name: "Balaga", initials: "BA", color: "coral", image: "/balaga.jpg.jpeg" },
  { id: "chidoshi", name: "Chidoshi", initials: "CH", color: "blue", image: "/chidoshi.jpg.jpeg" },
  { id: "easy-rsa", name: "Easy RSA", initials: "ER", color: "violet", image: "/easy-rsa.jpg.jpeg" },
  { id: "gbaby", name: "GBaby", initials: "GB", color: "sky", image: "/gbaby.jpg.jpeg" },
  { id: "government", name: "Government", initials: "GO", color: "gold" },
  { id: "jose-mourinho", name: "Jose Mourinho", initials: "JM", color: "red", image: "/jose-mourinho.jpg.jpeg" },
  { id: "ligugela-t-stark", name: "Ligugela T.Stark", initials: "LT", color: "blue", image: "/ligugela-t-stark.jpg.jpeg" },
  { id: "mabunda-khehla", name: "Mabunda (Khehla)", initials: "MK", color: "green", image: "/mabunda-khehla.jpg.jpeg" },
  { id: "malovhele-km", name: "Malovhele KM", initials: "MK", color: "violet", image: "/malovhele-km.jpg.jpeg" },
  { id: "manando", name: "Manando", initials: "MA", color: "red", image: "/manando.jpg.jpeg" },
  { id: "mashau-m-dzembe", name: "Mashau M (Dzembe)", initials: "MD", color: "sky", image: "/mashau-m-dzembe.jpg.jpeg" },
  { id: "mudau-mabai", name: "Mudau (Mabai)", initials: "MM", color: "blue", image: "/mudau-mabai.jpg.jpeg" },
  { id: "shepard", name: "Shepard", initials: "SH", color: "coral", image: "/shepard.jpg.jpeg" },
  { id: "shalulile", name: "Shalulile", initials: "SA", color: "red", image: "/shalulile.jpg.jpeg" },
  { id: "thee-lowkeys", name: "Thee Lowkeys", initials: "TL", color: "green", image: "/thee-lowkeys.jpg.jpeg" },
  { id: "thoni-respect", name: "Thoni (Respect)", initials: "TR", color: "gold" },
  { id: "vhalaudzi-uje", name: "Vhalaudzi (Uje)", initials: "VU", color: "violet", image: "/vhalaudzi-uje.jpg.jpeg" },
  { id: "vhaludzi-gwamasenga", name: "Vhaludzi (Gwamasenga)", initials: "VG", color: "sky", image: "/vhaludzi-gwamasenga.jpg.jpeg" },
  { id: "vho-lieba", name: "Vho Lieba", initials: "VL", color: "coral", image: "/vho-lieba.jpg.jpeg" },
  { id: "zwivhuya-sbuda", name: "Zwivhuya (Sbuda)", initials: "ZS", color: "blue", image: "/zwivhuya-sbuda.jpg.jpeg" },
];

const nomineeIds = new Set(nominees.map((nominee) => nominee.id));

let db;

function configureFirestore() {
  if (!firebaseProjectId) {
    console.warn("Firestore is disabled. Set FIREBASE_PROJECT_ID to enable voting and results.");
    return;
  }
  if (!voterHashSecret || voterHashSecret.length < 32) {
    console.warn("Firestore voting is disabled. Set VOTER_HASH_SECRET to at least 32 characters.");
    return;
  }
  const firebaseOptions = { projectId: firebaseProjectId };
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    firebaseOptions.credential = applicationDefault();
  }
  initializeApp(firebaseOptions);
  db = getFirestore();
}

function isValidDeviceId(deviceId) {
  return typeof deviceId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId);
}

function deviceFingerprint(deviceId) {
  return crypto.createHmac("sha256", voterHashSecret).update(deviceId.toLowerCase()).digest("hex");
}

function requireFirestore(res) {
  if (!db) {
    res.status(503).json({
      error: "Voting is not configured. Set FIREBASE_PROJECT_ID, VOTER_HASH_SECRET, and Firebase server credentials.",
    });
    return false;
  }
  return true;
}

async function hasDeviceVoted(deviceId) {
  const device = await db.collection("devices").doc(deviceFingerprint(deviceId)).get();
  return device.exists && device.data().hasVoted === true;
}

async function castVote(deviceId, nomineeId) {
  const deviceRef = db.collection("devices").doc(deviceFingerprint(deviceId));
  const resultRef = db.collection("results").doc(nomineeId);
  return db.runTransaction(async (transaction) => {
    const device = await transaction.get(deviceRef);
    if (device.exists) {
      return false;
    }
    transaction.create(deviceRef, {
      hasVoted: true,
      timestamp: FieldValue.serverTimestamp(),
    });
    transaction.set(resultRef, { votes: FieldValue.increment(1) }, { merge: true });
    return true;
  });
}

async function getResults() {
  const [resultsSnapshot, devicesSnapshot] = await Promise.all([
    db.collection("results").get(),
    db.collection("devices").count().get(),
  ]);
  const counts = new Map();
  for (const result of resultsSnapshot.docs) {
    if (!nomineeIds.has(result.id)) {
      continue;
    }
    const votes = result.data().votes;
    if (!Number.isSafeInteger(votes) || votes < 0) {
      throw new Error(`Invalid vote total for nominee ${result.id}.`);
    }
    counts.set(result.id, votes);
  }
  const results = nominees
    .map((nominee) => ({ ...nominee, votes: counts.get(nominee.id) || 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  return {
    results,
    totalVotes: results.reduce((total, nominee) => total + nominee.votes, 0),
    deviceCount: devicesSnapshot.data().count,
  };
}

function requireAdmin(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return res.redirect("/admin");
  }
  return next();
}

function getAdminCookie(req) {
  const cookies = req.headers.cookie || "";
  const prefix = `${adminCookieName}=`;
  const cookie = cookies.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : "";
}

function isAdminAuthenticated(req) {
  if (!sessionSecret || sessionSecret.length < 32) {
    return false;
  }
  const [expiresAtText, signature, ...extra] = getAdminCookie(req).split(".");
  if (extra.length || !/^\d{10,}$/.test(expiresAtText || "") || !/^[a-f0-9]{64}$/.test(signature || "")) {
    return false;
  }
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = crypto.createHmac("sha256", sessionSecret).update(`admin:${expiresAt}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function createAdminCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + adminSessionLifetime;
  const signature = crypto.createHmac("sha256", sessionSecret).update(`admin:${expiresAt}`).digest("hex");
  const secure = isProduction ? "; Secure" : "";
  return `${adminCookieName}=${expiresAt}.${signature}; Path=/; Max-Age=${adminSessionLifetime}; HttpOnly; SameSite=Lax${secure}`;
}

function clearAdminCookie(res) {
  const secure = isProduction ? "; Secure" : "";
  res.set("Set-Cookie", `${adminCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: isProduction ? "1d" : 0 }));
app.get("/", (req, res) => {
  res.redirect("/vote");
});

app.get("/vote", (req, res) => {
  res.render("vote", {
    nominees,
    error: null,
    selectedId: null,
  });
});

app.post("/api/voter-status", async (req, res) => {
  const deviceId = req.body.deviceId;
  if (!isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: "A valid device ID is required." });
  }
  if (!requireFirestore(res)) {
    return;
  }
  try {
    const hasVoted = await hasDeviceVoted(deviceId);
    return res.set("Cache-Control", "no-store").json({ hasVoted });
  } catch (error) {
    console.error("Could not check device status in Firestore:", error);
    return res.status(503).json({ error: "Could not check this device's voting status." });
  }
});

app.post("/vote", async (req, res) => {
  const selectedId = typeof req.body.nominee === "string" ? req.body.nominee : "";
  const deviceId = req.body.deviceId;
  if (!db) {
    return res.status(503).render("vote", {
      nominees,
      error: "Voting is not configured. Set up Firebase server credentials, then reload this page.",
      selectedId,
    });
  }
  if (!isValidDeviceId(deviceId) || !nomineeIds.has(selectedId)) {
    return res.status(400).render("vote", {
      nominees,
      error: !isValidDeviceId(deviceId)
        ? "This browser could not be identified. Please reload the page and try again."
        : "Choose a nominee from the ballot before submitting.",
      selectedId,
    });
  }

  try {
    const accepted = await castVote(deviceId, selectedId);
    if (!accepted) {
      return res.redirect("/vote?alreadyVoted=1");
    }
    return res.redirect("/vote?submitted=1");
  } catch (error) {
    console.error("Could not save ballot:", error);
    return res.status(500).render("vote", {
      nominees,
      error: "Your vote could not be saved. Please try again.",
      selectedId,
    });
  }
});

app.get("/admin", (req, res) => {
  if (isAdminAuthenticated(req)) {
    return res.redirect("/admin/dashboard");
  }
  return res.render("admin-login", {
    error: null,
    configured: Boolean(adminPassword && sessionSecret && sessionSecret.length >= 32),
  });
});

app.post("/admin/sign-in", (req, res) => {
  const submittedPassword = typeof req.body.password === "string" ? req.body.password : "";
  const configured = Boolean(adminPassword && sessionSecret && sessionSecret.length >= 32);
  const submittedBuffer = Buffer.from(submittedPassword);
  const configuredBuffer = Buffer.from(adminPassword || "");
  const matches = configured
    && submittedBuffer.length === configuredBuffer.length
    && crypto.timingSafeEqual(submittedBuffer, configuredBuffer);
  if (!matches) {
    return res.status(configured ? 401 : 503).render("admin-login", {
      error: configured ? "That password didn't match. Try again." : "Admin access is not configured on this server.",
      configured,
    });
  }
  res.set("Set-Cookie", createAdminCookie());
  return res.redirect("/admin/dashboard");
});

app.get("/admin/dashboard", requireAdmin, (req, res) => {
  if (!db) {
    return res.status(503).render("service-error", {
      message: "Firestore is not configured. Set up the Firebase project and server credentials.",
    });
  }
  return getResults().then(({ results, totalVotes, deviceCount }) => {
    res.render("admin", { results, totalVotes, voterCount: deviceCount });
  }).catch((error) => {
    console.error("Could not load the admin dashboard:", error);
    res.status(503).render("service-error", {
      message: "The results service is currently unavailable. Check the server's Firebase configuration.",
    });
  });
});

app.get("/admin/results", requireAdmin, async (req, res) => {
  if (!requireFirestore(res)) {
    return;
  }
  try {
    const results = await getResults();
    return res.set("Cache-Control", "no-store").json({
      totalVotes: results.totalVotes,
      deviceCount: results.deviceCount,
      results: results.results.map(({ id, votes }) => ({ id, votes })),
    });
  } catch (error) {
    console.error("Could not load vote results:", error);
    return res.status(503).json({ error: "The results service is currently unavailable." });
  }
});

app.get("/admin/live", requireAdmin, (req, res) => {
  if (!requireFirestore(res)) {
    return;
  }
  res.status(200).set({
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");

  let closed = false;
  let refreshRequested = false;
  let refreshInProgress = false;
  let unsubscribe = () => {};
  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(": keep-alive\n\n");
    }
  }, 25000);
  const sendResults = async () => {
    if (closed) {
      return;
    }
    refreshRequested = true;
    if (refreshInProgress) {
      return;
    }
    refreshInProgress = true;
    try {
      while (refreshRequested && !closed) {
        refreshRequested = false;
        const currentResults = await getResults();
        if (!closed) {
          res.write(`event: results\ndata: ${JSON.stringify({
            totalVotes: currentResults.totalVotes,
            deviceCount: currentResults.deviceCount,
            results: currentResults.results.map(({ id, votes }) => ({ id, votes })),
          })}\n\n`);
        }
      }
    } catch (error) {
      console.error("Could not stream vote results:", error);
      if (!closed) {
        res.write(`event: service-error\ndata: ${JSON.stringify({ message: "Live results are temporarily unavailable." })}\n\n`);
      }
    } finally {
      refreshInProgress = false;
    }
  };
  unsubscribe = db.collection("results").onSnapshot(sendResults, (error) => {
    console.error("Firestore live results listener failed:", error);
    if (!closed) {
      res.write(`event: service-error\ndata: ${JSON.stringify({ message: "Live results connection failed." })}\n\n`);
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
  });
  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.post("/admin/sign-out", (req, res) => {
  clearAdminCookie(res);
  return res.redirect("/admin");
});

app.use((req, res) => {
  res.status(404).send("Page not found.");
});

try {
  configureFirestore();
} catch (error) {
  console.error("Could not initialize Firebase Admin SDK:", error);
}
app.listen(port, () => {
  console.log(`Ballon d'Or voting app is running at http://localhost:${port}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("Admin dashboard is locked until ADMIN_PASSWORD is configured.");
  }
  if (!sessionSecret || sessionSecret.length < 32) {
    console.warn("Admin dashboard is locked until SESSION_SECRET is set to at least 32 characters.");
  }
});

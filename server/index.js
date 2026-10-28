import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { createStore, CHANNELS } from "./store.js";

const PORT = process.env.PORT || 4000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const isProd = process.env.NODE_ENV === "production";
const origins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);

// Planning assumptions (NOT measured). Edit here; the dashboard labels them as assumptions.
const PLAN = {
  target: 500,
  reachToVisitRate: 0.25,        // assumed: 25% of people reached visit the page
  visitToRegistrationRate: 0.20, // assumed: 20% of visitors register
  channelTargets: { "College Clubs": 200, "Student Ambassadors": 200, "WhatsApp/Telegram": 60, "Organic Social": 40 }
};

const store = createStore();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render sits behind one proxy; needed for correct per-IP rate limits
app.use((_req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
app.use(cors({ origin: origins.includes("*") ? true : origins, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "X-Admin-Key"] }));
app.use(express.json({ limit: "10kb" }));

const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please wait a minute and try again." } });
app.use("/api", limiter(60_000, 120));
const writeLimit = limiter(60_000, 10);

const clean = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max + 1);
const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']{2,}$/;
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

function maskEmail(email) {
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}***@${d}`;
}
const publicReg = r => ({ id: r.id, name: r.name, email: maskEmail(r.email), college: r.college, source: r.source, simulated: r.simulated, createdAt: r.createdAt });

async function summary() {
  const counts = await store.countsBySource();
  const bySource = {};
  for (const c of CHANNELS) {
    const real = counts[`${c}|false`] || 0, simulated = counts[`${c}|true`] || 0;
    bySource[c] = { real, simulated, total: real + simulated, target: PLAN.channelTargets[c] };
  }
  const real = Object.values(bySource).reduce((s, c) => s + c.real, 0);
  const simulated = Object.values(bySource).reduce((s, c) => s + c.simulated, 0);
  const total = real + simulated;
  const requiredVisits = Math.round(PLAN.target / PLAN.visitToRegistrationRate);
  return {
    measured: {
      total, real, simulated, target: PLAN.target, remaining: Math.max(0, PLAN.target - total),
      progress: Math.min(100, Math.round(total / PLAN.target * 100)),
      channelsActive: Object.values(bySource).filter(c => c.total > 0).length, bySource
    },
    plan: {
      target: PLAN.target, reachToVisitRate: PLAN.reachToVisitRate, visitToRegistrationRate: PLAN.visitToRegistrationRate,
      requiredVisits, requiredReach: Math.round(requiredVisits / PLAN.reachToVisitRate)
    },
    tracking: { reach: null, visits: null } // not instrumented: no analytics integrated
  };
}

app.get("/api/health", wrap(async (_req, res) => {
  try { await store.ping(); res.json({ ok: true, persistence: store.kind, exportEnabled: !!ADMIN_KEY }); }
  catch { res.status(503).json({ ok: false, error: "Database unavailable." }); }
}));

app.get("/api/dashboard", wrap(async (_req, res) => {
  res.json({ summary: await summary(), registrations: (await store.recentRegistrations(20)).map(publicReg), persistence: store.kind });
}));

app.get("/api/ambassadors", wrap(async (_req, res) => {
  res.json((await store.listAmbassadors()).map(({ id, name, college, code, simulated, registrations, newRegistrations }) => ({ id, name, college, code, simulated, registrations, newRegistrations })));
}));

app.post("/api/ambassadors", writeLimit, wrap(async (req, res) => {
  const name = clean(req.body?.name, 80), college = clean(req.body?.college, 120);
  if (name.length < 2 || name.length > 80 || college.length < 2 || college.length > 120) return res.status(400).json({ error: "Enter a name (2-80 chars) and college (2-120 chars)." });
  const a = await store.createAmbassador({ name, college });
  res.status(201).json({ id: a.id, name: a.name, college: a.college, code: a.code });
}));

app.post("/api/register", writeLimit, wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80), college = clean(b.college, 120);
  const email = clean(b.email, 254).toLowerCase();
  const referralCode = clean(b.referralCode, 20).toUpperCase().replace(/\s/g, "");
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter your full name (2-80 characters)." });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (college.length < 2 || college.length > 120) return res.status(400).json({ error: "Enter your college (2-120 characters)." });
  if (b.consent !== true) return res.status(400).json({ error: "Please agree to the data-use notice to register." });
  let ambassador = null;
  if (referralCode) {
    if (!/^[A-Z0-9]{3,20}$/.test(referralCode)) return res.status(400).json({ error: "Referral codes use 3-20 letters and numbers." });
    ambassador = await store.findAmbassadorByCode(referralCode);
    if (!ambassador) return res.status(400).json({ error: "That referral code was not found. Check the code and try again." });
  }
  const requested = String(b.source ?? "Organic Social");
  if (!ambassador && requested === "Student Ambassadors") return res.status(400).json({ error: "Ambassador signups need a valid referral code." });
  const source = ambassador ? "Student Ambassadors" : CHANNELS.includes(requested) ? requested : "Organic Social";
  try {
    const row = await store.insertRegistration({ name, email, college, source, referralCode: ambassador?.code || null, ambassadorId: ambassador?.id || null, consentAt: new Date().toISOString() });
    res.status(201).json({ message: "Registration recorded.", registration: { id: row.id, name: row.name, source: row.source, referralCode: row.referralCode } });
  } catch (e) {
    if (e.code === "DUPLICATE_EMAIL") return res.status(409).json({ error: "This email is already registered." });
    throw e;
  }
}));

// CSV: quote every field, double quotes, and neutralise spreadsheet formulas (=,+,-,@,tab,CR).
const csvCell = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};
const toCsv = rows => "\uFEFF" + rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const sendCsv = (res, name, rows) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(toCsv(rows));
};
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: "Registration export is disabled: ADMIN_KEY is not set on the server." });
  const given = Buffer.from(String(req.get("x-admin-key") || "")), want = Buffer.from(ADMIN_KEY);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(401).json({ error: "Invalid admin key." });
  next();
}
app.get("/api/export/registrations.csv", limiter(60_000, 10), requireAdmin, wrap(async (_req, res) => {
  const rows = await store.allRegistrations();
  sendCsv(res, "nxtwave-registrations.csv", [
    ["name", "email", "college", "source", "referral_code", "created_at", "record_type"],
    ...rows.map(r => [r.name, r.email, r.college, r.source, r.referralCode, r.createdAt, r.simulated ? "SIMULATED_SEED" : "NEW_DEMO_ENTRY"])
  ]);
}));
app.get("/api/export/channels.csv", wrap(async (_req, res) => {
  const s = await summary();
  sendCsv(res, "nxtwave-channel-summary.csv", [
    ["channel", "new_demo_entries", "simulated_seed", "total", "planning_target"],
    ...Object.entries(s.measured.bySource).map(([c, v]) => [c, v.real, v.simulated, v.total, v.target])
  ]);
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, _req, res, _next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  console.error(err);
  res.status(500).json({ error: "Server error. Please try again." });
});

try { await store.init(); } catch (e) { console.error("Storage init failed:", e.message); process.exit(1); }
if (store.kind === "in-memory") console.warn("WARNING: DATABASE_URL not set. Using in-memory storage; data resets on restart.");
if (isProd && !ADMIN_KEY) console.warn("WARNING: ADMIN_KEY not set; registration CSV export is disabled.");
app.listen(PORT, () => console.log(`API on :${PORT} (${store.kind})`));

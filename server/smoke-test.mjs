// Usage: BASE=http://localhost:4000 ADMIN_KEY=... node smoke-test.mjs
const BASE = process.env.BASE || "http://localhost:4000", KEY = process.env.ADMIN_KEY || "";
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); if (!cond) fail++; };
const call = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t }; };
const post = (path, body) => call(path, { method: "POST", body: JSON.stringify(body) });
const stamp = Date.now();
const base = { name: "Test User", college: "Test College", consent: true };

const h = await call("/api/health"); ok("health ok", h.json?.ok === true, h.text); console.log("      persistence:", h.json?.persistence);
const d0 = (await call("/api/dashboard")).json.summary.measured;
ok("seed data present and flagged simulated", d0.simulated === 37, JSON.stringify(d0));

const amb = await post("/api/ambassadors", { name: "Smoke Ambassador", college: "Smoke College" });
ok("ambassador created with code", amb.status === 201 && /^[A-Z0-9]{3,20}$/.test(amb.json?.code), amb.text);
const code = amb.json?.code;
const amb2 = await post("/api/ambassadors", { name: "Smoke Ambassador", college: "Smoke College" });
ok("same-name ambassador gets a different unique code", amb2.json?.code && amb2.json.code !== code);

const e1 = `Smoke.${stamp}@Example.com`;
const r1 = await post("/api/register", { ...base, email: e1, referralCode: code.toLowerCase(), source: "Organic Social" });
ok("register with referral code (lowercase accepted)", r1.status === 201 && r1.json.registration.source === "Student Ambassadors", r1.text);
const dup1 = await post("/api/register", { ...base, email: e1.toLowerCase() });
ok("duplicate email (same case) -> 409", dup1.status === 409, dup1.text);
const dup2 = await post("/api/register", { ...base, email: `  ${e1.toUpperCase()}  ` });
ok("duplicate email (different case + spaces) -> 409", dup2.status === 409, dup2.text);
ok("invalid email -> 400", (await post("/api/register", { ...base, email: "nope" })).status === 400);
ok("missing consent -> 400", (await post("/api/register", { ...base, email: `c${stamp}@example.com`, consent: false })).status === 400);
ok("unknown referral code -> 400", (await post("/api/register", { ...base, email: `u${stamp}@example.com`, referralCode: "ZZZZZZ9" })).status === 400);
ok("ambassador source without code -> 400", (await post("/api/register", { ...base, email: `s${stamp}@example.com`, source: "Student Ambassadors" })).status === 400);
const r2 = await post("/api/register", { ...base, name: '=HYPERLINK("http://x")', email: `f${stamp}@example.com`, source: "College Clubs" });
ok("formula-like name accepted as text", r2.status === 201, r2.text);
const big = await call("/api/register", { method: "POST", body: JSON.stringify({ name: "x".repeat(20000) }) });
ok("oversized body -> 413", big.status === 413, String(big.status));
const bad = await call("/api/register", { method: "POST", body: "{bad" });
ok("malformed JSON -> 400", bad.status === 400, String(bad.status));

const d1 = (await call("/api/dashboard")).json;
ok("total increased by exactly 2", d1.summary.measured.total === d0.total + 2, `${d0.total} -> ${d1.summary.measured.total}`);
ok("real count = new entries", d1.summary.measured.real === d0.real + 2);
ok("ambassador channel +1, clubs +1", d1.summary.measured.bySource["Student Ambassadors"].real === d0.bySource["Student Ambassadors"].real + 1 && d1.summary.measured.bySource["College Clubs"].real === d0.bySource["College Clubs"].real + 1);
ok("public dashboard masks emails", d1.registrations.every(r => /^.\*\*\*@/.test(r.email)));
const lb = (await call("/api/ambassadors")).json;
const mine = lb.find(a => a.code === code);
ok("leaderboard counts referral (1)", mine?.registrations === 1 && mine?.newRegistrations === 1, JSON.stringify(mine));
ok("leaderboard sorted desc", lb.every((a, i) => i === 0 || lb[i - 1].registrations >= a.registrations));

const noKey = await call("/api/export/registrations.csv"); ok("registrations CSV without key blocked (401/503)", [401, 503].includes(noKey.status), String(noKey.status));
if (KEY) {
  const wrong = await call("/api/export/registrations.csv", { headers: { "X-Admin-Key": "wrong" } }); ok("wrong key -> 401", wrong.status === 401);
  const csv = await call("/api/export/registrations.csv", { headers: { "X-Admin-Key": KEY } });
  ok("registrations CSV with key -> 200", csv.status === 200, csv.text.slice(0, 80));
  ok("CSV formula neutralised", csv.text.includes(`"'=HYPERLINK(""http://x"")"`), csv.text.split("\r\n").find(l => l.includes("HYPERLINK")));
  ok("CSV has SIMULATED_SEED and NEW_DEMO_ENTRY labels", csv.text.includes("SIMULATED_SEED") && csv.text.includes("NEW_DEMO_ENTRY"));
  ok("CSV row count = total + header", csv.text.trim().split("\r\n").length === d1.summary.measured.total + 1);
}
const ch = await call("/api/export/channels.csv");
ok("channel CSV 200 with 4 channels", ch.status === 200 && ch.text.trim().split("\r\n").length === 5, ch.text);
console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED"); process.exit(fail ? 1 : 0);

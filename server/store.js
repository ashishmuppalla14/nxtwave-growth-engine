import crypto from "node:crypto";
import pg from "pg";
import fs from "node:fs";

export const CHANNELS = ["College Clubs", "Student Ambassadors", "WhatsApp/Telegram", "Organic Social"];
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SEED_AMBASSADORS = [
  ["Aarav Sharma", "Demo Engineering College A", "AARAV10"],
  ["Diya Reddy", "Demo Engineering College B", "DIYA10"],
  ["Kabir Rao", "Demo Engineering College C", "KABIR10"],
  ["Meera Iyer", "Demo Engineering College D", "MEERA10"]
];
const FIRST = ["Ananya","Rahul","Ishita","Arjun","Priya","Rohan","Sneha","Vikram","Aditi","Kiran","Nisha","Dev"];
const LAST = ["Kumar","Reddy","Sharma","Patel","Rao","Iyer","Das","Singh"];
const SEED_SOURCES = [["Student Ambassadors","AARAV10"],["Student Ambassadors","DIYA10"],["College Clubs",null],["WhatsApp/Telegram",null],["Organic Social",null]];

export function makeCode(name) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "CAMPUS";
  let suffix = "";
  for (let i = 0; i < 3; i++) suffix += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return base + suffix;
}
function seedRows() {
  return Array.from({ length: 37 }, (_, i) => {
    const [source, code] = SEED_SOURCES[i % SEED_SOURCES.length];
    return {
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
      email: `student${i + 1}@${i % 2 ? "example.com" : "example.org"}`,
      college: `Demo Engineering College ${(i % 8) + 1}`,
      source, referralCode: code,
      createdAt: new Date(Date.now() - (i % 7) * 86400000 - i * 60000).toISOString()
    };
  });
}
const dup = () => Object.assign(new Error("duplicate email"), { code: "DUPLICATE_EMAIL" });

/* ---------------- In-memory store (local fallback, no persistence) ---------------- */
function memoryStore(seed) {
  const ambassadors = [], registrations = [];
  const api = {
    kind: "in-memory",
    async init() {
      if (!seed) return;
      for (const [name, college, code] of SEED_AMBASSADORS)
        ambassadors.push({ id: crypto.randomUUID(), name, college, code, simulated: true, createdAt: new Date().toISOString() });
      for (const r of seedRows())
        registrations.push({ id: crypto.randomUUID(), ...r, ambassadorId: ambassadors.find(a => a.code === r.referralCode)?.id || null, simulated: true });
    },
    async ping() { return true; },
    async listAmbassadors() {
      return ambassadors.map(a => {
        const mine = registrations.filter(r => r.ambassadorId === a.id);
        return { ...a, registrations: mine.length, newRegistrations: mine.filter(r => !r.simulated).length };
      }).sort((a, b) => b.registrations - a.registrations || a.createdAt.localeCompare(b.createdAt));
    },
    async findAmbassadorByCode(code) { return ambassadors.find(a => a.code === code) || null; },
    async createAmbassador({ name, college }) {
      let code; do code = makeCode(name); while (ambassadors.some(a => a.code === code));
      const a = { id: crypto.randomUUID(), name, college, code, simulated: false, createdAt: new Date().toISOString() };
      ambassadors.push(a); return a;
    },
    async insertRegistration(r) {
      if (registrations.some(x => x.email.toLowerCase() === r.email)) throw dup();
      const row = { id: crypto.randomUUID(), ...r, simulated: false, createdAt: new Date().toISOString() };
      registrations.push(row); return row;
    },
    async countsBySource() {
      return registrations.reduce((acc, r) => { const k = `${r.source}|${r.simulated}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    },
    async recentRegistrations(limit) { return registrations.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); },
    async allRegistrations() { return registrations.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  };
  return api;
}

/* ---------------- Postgres store (Supabase or any Postgres) ---------------- */
function postgresStore(url, seed) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    ssl: local || process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
  });
  const mapReg = r => ({ id: r.id, name: r.name, email: r.email, college: r.college, source: r.source, referralCode: r.referral_code, ambassadorId: r.ambassador_id, simulated: r.simulated, createdAt: r.created_at.toISOString() });
  return {
    kind: "postgres",
    async init() {
      await pool.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
      const { rows } = await pool.query("select (select count(*) from registrations)::int r, (select count(*) from ambassadors)::int a");
      if (!seed || rows[0].r || rows[0].a) return;
      const ids = {};
      for (const [name, college, code] of SEED_AMBASSADORS) {
        const res = await pool.query("insert into ambassadors(name,college,code,simulated) values($1,$2,$3,true) returning id", [name, college, code]);
        ids[code] = res.rows[0].id;
      }
      for (const r of seedRows())
        await pool.query("insert into registrations(name,email,college,source,referral_code,ambassador_id,simulated,created_at) values($1,$2,$3,$4,$5,$6,true,$7)",
          [r.name, r.email, r.college, r.source, r.referralCode, r.referralCode ? ids[r.referralCode] : null, r.createdAt]);
    },
    async ping() { await pool.query("select 1"); return true; },
    async listAmbassadors() {
      const { rows } = await pool.query(`select a.id,a.name,a.college,a.code,a.simulated,a.created_at,
        count(r.id)::int registrations, count(r.id) filter (where not r.simulated)::int new_registrations
        from ambassadors a left join registrations r on r.ambassador_id=a.id
        group by a.id order by registrations desc, a.created_at asc`);
      return rows.map(a => ({ id: a.id, name: a.name, college: a.college, code: a.code, simulated: a.simulated, createdAt: a.created_at.toISOString(), registrations: a.registrations, newRegistrations: a.new_registrations }));
    },
    async findAmbassadorByCode(code) {
      const { rows } = await pool.query("select id,name,code from ambassadors where code=$1", [code]);
      return rows[0] || null;
    },
    async createAmbassador({ name, college }) {
      for (let i = 0; i < 6; i++) {
        try {
          const { rows } = await pool.query("insert into ambassadors(name,college,code) values($1,$2,$3) returning id,name,college,code,simulated,created_at", [name, college, makeCode(name)]);
          const a = rows[0];
          return { id: a.id, name: a.name, college: a.college, code: a.code, simulated: a.simulated, createdAt: a.created_at.toISOString() };
        } catch (e) { if (e.code !== "23505") throw e; }
      }
      throw new Error("Could not generate a unique code");
    },
    async insertRegistration(r) {
      try {
        const { rows } = await pool.query(`insert into registrations(name,email,college,source,referral_code,ambassador_id,consent_at)
          values($1,$2,$3,$4,$5,$6,$7) returning *`, [r.name, r.email, r.college, r.source, r.referralCode, r.ambassadorId, r.consentAt]);
        return mapReg(rows[0]);
      } catch (e) { if (e.code === "23505") throw dup(); throw e; }
    },
    async countsBySource() {
      const { rows } = await pool.query("select source, simulated, count(*)::int n from registrations group by 1,2");
      return Object.fromEntries(rows.map(r => [`${r.source}|${r.simulated}`, r.n]));
    },
    async recentRegistrations(limit) { return (await pool.query("select * from registrations order by created_at desc limit $1", [limit])).rows.map(mapReg); },
    async allRegistrations() { return (await pool.query("select * from registrations order by created_at asc")).rows.map(mapReg); }
  };
}

export function createStore() {
  const seed = process.env.SEED_DEMO_DATA !== "false";
  return process.env.DATABASE_URL ? postgresStore(process.env.DATABASE_URL, seed) : memoryStore(seed);
}

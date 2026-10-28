import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, ArrowDownToLine, ArrowUpRight, BadgeCheck, BarChart3, Check, ChevronRight, CircleAlert, Copy, Link2, Megaphone, Plus, RefreshCw, Target, Trophy, Users, UserPlus, X } from "lucide-react";
import "./style.css";

const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const fmt = n => new Intl.NumberFormat("en-IN").format(n);
const CHANNELS = ["College Clubs", "Student Ambassadors", "WhatsApp/Telegram", "Organic Social"];
const FORM_SOURCES = CHANNELS.filter(c => c !== "Student Ambassadors"); // ambassador attribution only via a valid code
const REF_PARAM = (new URLSearchParams(window.location.search).get("ref") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

async function request(path, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response;
  try { response = await fetch(`${API}/api${path}`, { ...options, signal: ctrl.signal, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); }
  catch { throw Object.assign(new Error("The server is unreachable or still waking up (free hosting can take up to a minute). Please retry shortly."), { unavailable: true }); }
  finally { clearTimeout(timer); }
  return response;
}
async function api(path, options) {
  const response = await request(path, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || (response.status >= 500 ? "Server error. Please try again." : "Something went wrong. Please try again."));
  return data;
}
async function download(path, filename, headers) {
  const response = await request(path, { headers });
  if (!response.ok) { const d = await response.json().catch(() => null); throw new Error(d?.error || "Download failed."); }
  const url = URL.createObjectURL(await response.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function App() {
  const [data, setData] = useState(null);
  const [ambassadors, setAmbassadors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [down, setDown] = useState(null);
  const [tab, setTab] = useState(REF_PARAM ? "registrations" : "overview");
  const [notice, setNotice] = useState(null);
  const [reg, setReg] = useState({ name: "", email: "", college: "", source: "WhatsApp/Telegram", referralCode: REF_PARAM, consent: false });
  const [amb, setAmb] = useState({ name: "", college: "" });
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(false);
  const timer = useRef();

  const show = (type, text) => { setNotice({ type, text }); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setNotice(null), 6000); };
  async function load(quiet) {
    if (!quiet) setLoading(true);
    try {
      const [dash, leaders, status] = await Promise.all([api("/dashboard"), api("/ambassadors"), api("/health")]);
      setData(dash); setAmbassadors(leaders); setHealth(status.ok); setDown(null);
    } catch (e) { setHealth(false); setDown(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function register(e) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      const r = await api("/register", { method: "POST", body: JSON.stringify(reg) });
      show("success", `Registration recorded. Source: ${r.registration.source}.`);
      setReg({ ...reg, name: "", email: "", college: "", consent: false }); await load(true);
    } catch (err) { show("error", err.message); }
    finally { setBusy(false); }
  }
  async function addAmbassador(e) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try {
      const r = await api("/ambassadors", { method: "POST", body: JSON.stringify(amb) });
      setAmb({ name: "", college: "" }); await load(true); setTab("ambassadors");
      show("success", `Ambassador created. Referral code: ${r.code}`);
    } catch (err) { show("error", err.message); }
    finally { setBusy(false); }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); show("success", `Copied ${text}`); }
    catch { show("error", `Copy unavailable. Select and copy: ${text}`); }
  }
  async function exportFile(kind) {
    try {
      if (kind === "channels") return await download("/export/channels.csv", "nxtwave-channel-summary.csv");
      let key = sessionStorage.getItem("adminKey") || window.prompt("Admin key required to export registrations (contains emails):");
      if (!key) return;
      try { await download("/export/registrations.csv", "nxtwave-registrations.csv", { "X-Admin-Key": key }); sessionStorage.setItem("adminKey", key); }
      catch (err) { sessionStorage.removeItem("adminKey"); throw err; }
    } catch (err) { show("error", err.message); }
  }

  const m = data?.summary.measured;
  const memory = data?.persistence === "in-memory";
  const titles = { overview: "Campaign overview", registrations: "Student registrations", ambassadors: "Campus ambassadors", acquisition: "Acquisition performance" };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Megaphone size={21} /></div><div><b>Growth Engine</b><span>NXTWAVE WORKSHOP</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{[["overview", "Overview", BarChart3], ["registrations", "Registrations", Users], ["ambassadors", "Ambassadors", Trophy], ["acquisition", "Acquisition", Target]].map(([id, label, Icon]) =>
        <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}><Icon size={18} />{label}{tab === id && <ChevronRight size={15} className="nav-chevron" />}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="goal-mini"><div className="goal-head"><Target size={16} /><span>Campaign goal</span></div><strong>{fmt(m?.total || 0)} <small>/ {m?.target || 500}</small></strong><div className="progress"><i style={{ width: `${m?.progress || 0}%` }} /></div><p>{m ? `${fmt(m.remaining)} to go (incl. simulated)` : "—"}</p></div>
        <div className="api-status"><span className={health ? "status-dot" : "status-dot offline"} />{health ? "API connected" : "API unavailable"}</div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">CAMPAIGN WORKSPACE / OCT 2026</div><h1>{titles[tab]}</h1></div>
        <div className="top-actions"><span className="demo-pill"><span /> SIMULATED SEED DATA</span><button className="icon-button" title="Refresh data" aria-label="Refresh data" onClick={() => load()}><RefreshCw size={17} /></button><button className="button button-dark" onClick={() => setTab("registrations")}><UserPlus size={16} /> Add registration</button></div></header>
      <div className="demo-warning"><CircleAlert size={17} /><div><b>Prototype:</b> {m ? `${m.simulated} of ${m.total} records are fictional simulated seed data; ${m.real} were entered by demo users.` : "Includes fictional simulated seed data."} {memory ? "Storage is in-memory: data resets when the API restarts. " : ""}Please use a test email, not a real student's personal data.</div></div>
      {notice && <div className={`toast ${notice.type}`} role="status"><span>{notice.type === "success" ? <Check size={17} /> : <CircleAlert size={17} />}</span>{notice.text}<button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      {loading && !data ? <div className="loading">Loading campaign metrics… (free servers can take up to a minute to wake up)</div>
        : !data ? <div className="empty-state"><CircleAlert size={22} /><p><b>API unavailable.</b> {down}</p><button className="button button-primary" onClick={() => load()}>Try again</button></div>
        : <>
          {down && <div className="toast error"><span><CircleAlert size={17} /></span>Showing last loaded data. {down}</div>}
          {tab === "overview" && <Overview data={data} setTab={setTab} />}
          {tab === "registrations" && <Registrations {...{ reg, setReg, register, busy, recent: data.registrations, exportFile }} />}
          {tab === "ambassadors" && <Ambassadors {...{ ambassadors, amb, setAmb, addAmbassador, busy, copy }} />}
          {tab === "acquisition" && <Acquisition m={m} exportFile={exportFile} />}
          <footer><span><span className="footer-dot" /> API {health ? "connected" : "unavailable"} · storage: {data.persistence}</span><span>Built for the NxtWave Growth Intern Challenge · <b>Demo</b></span></footer>
        </>}
    </main>
  </div>;
}

function Overview({ data, setTab }) {
  const { measured: m, plan: p } = data.summary;
  const maxSource = Math.max(1, ...Object.values(m.bySource).map(c => c.total));
  const cards = [
    { label: "TOTAL REGISTRATIONS", value: fmt(m.total), meta: `${m.simulated} simulated + ${m.real} new demo entries`, icon: Users, color: "purple" },
    { label: "TARGET PROGRESS", value: `${m.progress}%`, meta: `${fmt(m.remaining)} remaining to ${fmt(m.target)} (incl. simulated)`, icon: Target, color: "blue" },
    { label: "CHANNELS ACTIVE", value: `${m.channelsActive} / ${CHANNELS.length}`, meta: "Channels with ≥1 registration", icon: Activity, color: "green" },
    { label: "PLANNED VISIT→SIGNUP", value: `${Math.round(p.visitToRegistrationRate * 100)}%`, meta: "Planning assumption, not measured", icon: ArrowUpRight, color: "orange" }
  ];
  const plan = [
    { label: "Reach needed (assumed)", value: p.requiredReach, pct: 100 },
    { label: "Landing visits needed (assumed)", value: p.requiredVisits, pct: p.requiredVisits / p.requiredReach * 100 },
    { label: "Registrations target", value: p.target, pct: p.target / p.requiredReach * 100 }
  ];
  return <>
    <section className="metric-grid">{cards.map(c => <div className="metric-card" key={c.label}><div className="metric-top"><span>{c.label}</span><div className={`metric-icon ${c.color}`}><c.icon size={18} /></div></div><div className="metric-value">{c.value}</div><div className="metric-meta">{c.meta}</div></div>)}</section>
    <section className="content-grid">
      <div className="panel funnel-panel"><div className="panel-head"><div><h2>Registration funnel</h2><p>Planned stages vs. measured registrations</p></div><span className="tag">PLAN VS MEASURED</span></div>
        <div className="funnel-list">{plan.map((f, i) => <div className="funnel-row" key={f.label}><div className="funnel-label"><span>{f.label} <small>PLAN</small></span><b>{fmt(f.value)}</b></div><div className="funnel-track"><i className={`funnel-fill f${i}`} style={{ width: `${Math.max(3, f.pct)}%` }} /></div></div>)}
          <div className="funnel-row"><div className="funnel-label"><span>Registrations recorded <small>MEASURED</small></span><b>{fmt(m.total)}</b></div><div className="funnel-track"><i className="funnel-fill f2" style={{ width: `${Math.max(3, m.total / p.requiredReach * 100)}%` }} /></div></div></div>
        <div className="funnel-note"><CircleAlert size={15} /><span>Reach ({p.reachToVisitRate * 100}% visit rate) and visits are not tracked, so no measured conversion is shown. Only registrations are measured; {m.simulated} of them are simulated.</span></div></div>
      <div className="panel target-panel"><div className="panel-head"><div><h2>Target tracker</h2><p>Campaign goal</p></div><Target size={19} className="muted-icon" /></div><div className="target-number">{fmt(m.total)}<span> / {fmt(m.target)}</span></div><div className="big-progress"><i style={{ width: `${m.progress}%` }} /></div><div className="target-footer"><span>{m.progress}% complete</span><b>{fmt(m.remaining)} to go</b></div><div className="target-callout"><div className="callout-icon"><BadgeCheck size={18} /></div><div><b>Real progress: {fmt(m.real)}</b><p>Excluding simulated seed data, {fmt(m.real)} registrations have been recorded.</p></div></div><button className="button button-primary full" onClick={() => setTab("ambassadors")}>Manage ambassadors <ChevronRight size={16} /></button></div>
    </section>
    <section className="content-grid lower-grid">
      <div className="panel"><div className="panel-head"><div><h2>Registrations by channel</h2><p>Recorded registrations (simulated + new)</p></div><button className="text-button" onClick={() => setTab("acquisition")}>View details <ChevronRight size={14} /></button></div><div className="channel-bars">{Object.entries(m.bySource).map(([name, c], i) => <div className="channel-row" key={name}><div className="channel-label"><span className={`channel-dot c${i}`} />{name}<b>{c.total}</b></div><div className="bar-track"><i style={{ width: `${c.total / maxSource * 100}%` }} /></div></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><h2>Next actions</h2><p>Suggested campaign priorities</p></div></div><div className="action-list"><div><span className="action-num">01</span><p><b>Activate college clubs</b><small>Give coordinators ready-to-share creative.</small></p><ArrowUpRight size={16} /></div><div><span className="action-num">02</span><p><b>Scale top ambassadors</b><small>Track referrals by unique code.</small></p><ArrowUpRight size={16} /></div><div><span className="action-num">03</span><p><b>Test message variants</b><small>Compare click and registration rates.</small></p><ArrowUpRight size={16} /></div></div></div>
    </section>
  </>;
}

function Registrations({ reg, setReg, register, busy, recent, exportFile }) {
  const [search, setSearch] = useState("");
  const filtered = recent.filter(r => `${r.name} ${r.email} ${r.college} ${r.source}`.toLowerCase().includes(search.toLowerCase()));
  const hasCode = reg.referralCode.trim().length > 0;
  return <section className="panel page-panel"><div className="panel-head"><div><h2>Register a student</h2><p>Duplicate emails are rejected; referral codes attribute the signup to an ambassador</p></div><span className="tag">DEMO FORM</span></div>
    <form className="register-form" onSubmit={register}>
      <label>Full name<input required minLength="2" maxLength="80" value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} placeholder="e.g. Aanya Rao" autoComplete="name" /></label>
      <label>Email address<input required type="email" maxLength="254" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} placeholder="student@example.com" autoComplete="email" /></label>
      <label>College / university<input required minLength="2" maxLength="120" value={reg.college} onChange={e => setReg({ ...reg, college: e.target.value })} placeholder="Your college name" /></label>
      <label>How did you hear about us?<select value={hasCode ? "Student Ambassadors" : reg.source} disabled={hasCode} onChange={e => setReg({ ...reg, source: e.target.value })}>{(hasCode ? CHANNELS : FORM_SOURCES).map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="full-field">Referral code (optional)<input maxLength="20" value={reg.referralCode} onChange={e => setReg({ ...reg, referralCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="e.g. AARAV10" /><small>A valid code attributes this registration to the ambassador automatically.</small></label>
      <label className="full-field consent"><span><input type="checkbox" required checked={reg.consent} onChange={e => setReg({ ...reg, consent: e.target.checked })} /> I agree that my name, email and college are stored for this workshop demo and may be deleted on request.</span></label>
      <div className="form-bottom"><span><CircleAlert size={15} /> Only name, email and college are collected.</span><button className="button button-primary" disabled={busy}>{busy ? "Recording…" : <><UserPlus size={16} /> Record registration</>}</button></div>
    </form>
    <div className="table-heading"><div><h2>Recent registrations</h2><p>Latest 20 records · emails masked · seed data marked simulated</p></div><button className="button button-outline" onClick={() => exportFile("registrations")}><ArrowDownToLine size={16} /> Export CSV (admin)</button></div>
    <div className="search-wrap"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the latest 20 records…" aria-label="Search recent registrations" /></div>
    <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>COLLEGE</th><th>SOURCE</th><th>STATUS</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id}><td><b>{r.name}</b><small>{r.email}</small></td><td>{r.college}</td><td><span className="source-tag">{r.source}</span></td><td><span className={`record-status ${r.simulated ? "sim" : "new"}`}>{r.simulated ? "SIMULATED" : "NEW ENTRY"}</span></td></tr>)}{!filtered.length && <tr><td colSpan="4" className="empty-cell">{recent.length ? "No matches in the latest 20 records." : "No registrations yet. Add the first one above."}</td></tr>}</tbody></table></div>
  </section>;
}

function Ambassadors({ ambassadors, amb, setAmb, addAmbassador, busy, copy }) {
  return <div className="ambassador-layout"><section className="panel"><div className="panel-head"><div><h2>Add an ambassador</h2><p>Generate a unique code for each student promoter</p></div><UserPlus size={19} className="muted-icon" /></div>
    <form className="amb-form" onSubmit={addAmbassador}><label>Student name<input required minLength="2" maxLength="80" value={amb.name} onChange={e => setAmb({ ...amb, name: e.target.value })} placeholder="e.g. Ananya Kumar" /></label><label>College<input required minLength="2" maxLength="120" value={amb.college} onChange={e => setAmb({ ...amb, college: e.target.value })} placeholder="College name" /></label><button className="button button-primary full" disabled={busy}><Plus size={16} /> Generate referral code</button></form>
    <div className="info-box"><Link2 size={17} /><p><b>How referral attribution works</b><br />Share the link: it opens the registration form with the code pre-filled (<code>?ref=CODE</code>). Valid codes credit the ambassador and the Student Ambassadors channel.</p></div></section>
    <section className="panel"><div className="panel-head"><div><h2>Ambassador leaderboard</h2><p>Ranked by attributed registrations (simulated + new)</p></div><Trophy size={19} className="muted-icon" /></div>
      <div className="leader-list">{!ambassadors.length && <div className="empty-state">No ambassadors yet. Generate the first referral code.</div>}{ambassadors.map((a, i) => <div className="leader-row" key={a.id}><div className={`rank rank-${i + 1}`}>{i === 0 ? <Trophy size={17} /> : String(i + 1).padStart(2, "0")}</div><div className="leader-person"><b>{a.name} {a.simulated && <span className="record-status sim">SIMULATED</span>}</b><small>{a.college}</small><div className="code-line"><code>{a.code}</code><button title="Copy referral link" onClick={() => copy(`${window.location.origin}/?ref=${a.code}`)}><Copy size={13} /> Copy link</button></div></div><div className="leader-count"><b>{a.registrations}</b><small>{a.newRegistrations} new</small></div></div>)}</div></section></div>;
}

function Acquisition({ m, exportFile }) {
  const maxSource = Math.max(1, ...Object.values(m.bySource).map(c => c.total));
  return <section className="panel page-panel"><div className="panel-head"><div><h2>Channel performance</h2><p>Measured registrations per channel vs. planning targets</p></div><button className="button button-outline" onClick={() => exportFile("channels")}><ArrowDownToLine size={16} /> Export summary</button></div>
    <div className="channel-detail-list">{Object.entries(m.bySource).map(([name, c], i) => <div className="channel-detail" key={name}><div className="channel-detail-top"><span className={`channel-dot c${i}`} /><b>{name}</b><strong>{c.total}</strong></div><div className="bar-track"><i style={{ width: `${c.total / maxSource * 100}%` }} /></div><div className="channel-detail-foot"><span>{m.total ? Math.round(c.total / m.total * 100) : 0}% of records · {c.simulated} simulated + {c.real} new</span><span>Planning target: {c.target}</span></div></div>)}</div>
    <div className="funnel-note"><CircleAlert size={15} /><span>Counts include fictional simulated seed data. Channel targets are planning allocations, not results.</span></div></section>;
}

createRoot(document.getElementById("root")).render(<App />);

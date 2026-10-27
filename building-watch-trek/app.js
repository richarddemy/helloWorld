/* Building Watch front end. Talks to the Apps Script API, or to an in-browser demo when no API is configured. */
(function () {
"use strict";
const CFG = window.BW_CONFIG || {};
const qs = new URLSearchParams(location.search);
const DEMO = !CFG.SCRIPT_URL || qs.has("demo");
const NS = Core.NS, START = Core.START;
const SLOTS = Array.from({ length: NS }, (_, i) => START + i * 30);
const STATUSES = Core.STATUSES;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = m => String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return iso(x); };
const dayLbl = s => { const d = parse(s); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate(); };
const md = s => s ? (+s.slice(5, 7)) + "/" + (+s.slice(8, 10)) : "";
const span = x => fmt(SLOTS[x.s]) + "-" + fmt(SLOTS[x.e - 1] + 30);
const isOut = l => l.out !== "" && l.out != null;
const ZERO = "0".repeat(NS);

let weekStart = monday(new Date());
const week = () => [0, 1, 2, 3, 4].map(i => addDays(weekStart, i));
let D = null, tab = null, myDays = {}, dirty = false, busy = [], sel = null, chosen = new Set(), mailTo = new Set(), report = null;

/* ---------- small UI helpers ---------- */
function toast(t, kind) { const e = $("toast"); e.textContent = t; e.className = "toast" + (kind === "err" ? " err" : ""); e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, kind === "err" ? 5000 : 2600); }
let pending = 0;
function busyOn() { pending++; $("progress").hidden = false; }
function busyOff() { pending = Math.max(0, pending - 1); if (!pending) $("progress").hidden = true; }
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(typeof ok === "function" ? ok(r) : ok); return r; }
  catch (e) { if (e.code === "auth") { signOut("Your sign-in expired. Please sign in again."); return; } toast(e.message || "Something went wrong.", "err"); }
}
function copy(text, msg) {
  const fb = () => openModal("Copy this text", "Select it and copy.", `<textarea style="min-height:160px" id="cpText">${esc(text)}</textarea>`, `<span></span><button class="btn" data-act="cancel">Close</button>`, () => $("cpText").select());
  try { navigator.clipboard.writeText(text).then(() => toast(msg), fb); } catch (e) { fb(); }
}
function download(name, text) {
  try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast("Downloaded " + name); }
  catch (e) { copy(text, "Copied as CSV"); }
}

/* ---------- API ---------- */
let TOKEN = null;
const API = {
  async call(action, payload = {}) {
    if (DEMO) return Demo.call(action, payload);
    busyOn();
    try {
      const r = await fetch(CFG.SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: TOKEN, action, payload }) });
      if (!r.ok) throw new Error("The server didn't answer (" + r.status + "). Try again.");
      const j = await r.json();
      (j.warn || []).forEach(w => toast(w, "err"));
      if (!j.ok) { const e = new Error(j.error || "Something went wrong."); e.code = j.code; throw e; }
      return j.data;
    } catch (e) {
      if (e instanceof TypeError) { const x = new Error("Can't reach the server. Check your connection."); throw x; }
      throw e;
    } finally { busyOff(); }
  }
};

/* ---------- demo backend: same Core logic, stored in this browser ---------- */
const Demo = {
  key: "bw-star-trek-demo-v1", as: "admin", st: null,
  emails: { admin: "picard@demo.invalid", member: "data@demo.invalid" },
  load() { try { const t = localStorage.getItem(this.key); if (t) { this.st = JSON.parse(t); return; } } catch (e) {} this.st = seed(); },
  save() { try { const s = Object.assign({}, this.st); delete s._dirty; delete s._warn; localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) {} },
  async call(action, payload) {
    if (!this.st) this.load();
    await new Promise(r => setTimeout(r, 120));
    if (action === "admin.test") return { demo: true };
    if (action === "admin.dataSource") throw Object.assign(new Error("Demo mode has no Google Sheet. This works once the app is set up."), { code: "demo" });
    const st = this.st; st._dirty = {}; st._warn = [];
    try {
      const r = Core.handle(st, this.emails[this.as], action, JSON.parse(JSON.stringify(payload)), DH);
      this.save(); st._warn.forEach(w => toast(w, "err"));
      return JSON.parse(JSON.stringify(r));
    } catch (e) { throw e; }
  }
};
const DH = {
  today: () => iso(new Date()), nowMin: () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, nowISO: () => new Date().toISOString(),
  syncAvail: () => [], watchCreate: () => "", eventDelete: () => {}, shareCal: () => {}, testCal: () => "Demo calendar",
  sendInvite: () => {}, sendMail: (st, e) => e.length,
  fetchBusy: (st, cals, wk) => [{ d: 0, s: 0, e: 2, t: "PT" }, { d: 1, s: 11, e: 13, t: "Dentist" }, { d: 3, s: 10, e: 15, t: "Ceremony rehearsal" }, { d: 4, s: 2, e: 6, t: "Teaching" }].map(b => ({ date: wk[b.d], s: b.s, e: b.e, t: b.t }))
};
function seed() {
  const wk = week(), t = iso(new Date()), now = new Date().toISOString();
  const P = (email, name, role, watch) => ({ id: Core.uid(), email, name, role, watch, active: true, phone: "", cals: [], invitedAt: now, joinedAt: now });
  const people = [P("picard@demo.invalid", "Jean-Luc Picard", "Admin", true), P("riker@demo.invalid", "William Riker", "Admin", false), P("worf@demo.invalid", "Worf", "Member", true),
    P("data@demo.invalid", "Data", "Member", true), P("uhura@demo.invalid", "Nyota Uhura", "Member", true), P("sisko@demo.invalid", "Benjamin Sisko", "Member", true),
    P("janeway@demo.invalid", "Kathryn Janeway", "Member", true), P("kira@demo.invalid", "Kira Nerys", "Member", true), P("troi@demo.invalid", "Deanna Troi", "Member", true)];
  people[0].cals = [{ label: "My Google Calendar", url: "demo", on: true }];
  const id = n => people.find(p => p.name === n).id;
  const avail = [];
  const block = (n, d, a, b) => { const date = wk[d]; let r = avail.find(x => x.pid === id(n) && x.date === date); if (!r) { r = { pid: id(n), date, slots: ZERO, ev: [] }; avail.push(r); }
    r.slots = r.slots.split("").map((c, i) => (SLOTS[i] >= a * 60 && SLOTS[i] < b * 60) ? "1" : c).join(""); };
  [[0, 8, 12], [1, 8, 15.5], [3, 9, 13]].forEach(r => block("Jean-Luc Picard", ...r));
  [0, 1, 2, 3, 4].forEach(d => block("Worf", d, 7.5, 15.5));
  [[0, 9, 15], [2, 9, 15], [4, 9, 12]].forEach(r => block("Data", ...r));
  [[1, 7.5, 11], [2, 12, 16], [3, 7.5, 11]].forEach(r => block("Nyota Uhura", ...r));
  [[0, 13, 16], [1, 13, 16], [4, 8, 11]].forEach(r => block("Benjamin Sisko", ...r));
  [[2, 8, 12], [3, 12, 16]].forEach(r => block("Kathryn Janeway", ...r));
  [[0, 7.5, 10], [3, 8, 16], [4, 12, 16]].forEach(r => block("Kira Nerys", ...r));
  [[1, 9, 13], [2, 7.5, 9.5]].forEach(r => block("Deanna Troi", ...r));
  const W = (n, d, s, e, checks) => ({ id: Core.uid(), pid: id(n), date: wk[d], s, e, checks: checks || {}, ev: "" });
  const T = Core.DEF_TMPL, all = {}; T.forEach(x => all[x] = 1);
  const watches = [W("Worf", 0, 0, 8, all), W("Data", 0, 8, 12, { [T[0]]: 1, [T[1]]: 1 }), W("Kira Nerys", 0, 0, 5, all), W("Nyota Uhura", 1, 0, 7, { [T[0]]: 1 }), W("Jean-Luc Picard", 1, 8, 14), W("Worf", 2, 0, 8), W("Data", 2, 4, 12)];
  const R = (days, by, loc, issue, pri, status, wo) => ({ id: Core.uid(), date: addDays(t, -days), by, byId: id(by), loc, issue, pri, status, wo });
  const requests = [R(9, "Data", "Shuttle bay airlock", "Force-field emitter reports an intermittent fault", "Routine", "Closed", "WO-48650"),
    R(3, "Worf", "Engineering Deck", "Warp core coolant manifold requires calibration", "Routine", "In progress", "WO-48812"),
    R(2, "Kira Nerys", "Transporter Room 3", "Transporter pattern buffer showing irregularities", "Routine", "In progress", ""),
    R(1, "Nyota Uhura", "Holodeck 2", "Safety interlock needs inspection", "Urgent", "Open", "")];
  const L = (days, worker, shop, req, task, inn, out, done, fu, ret, prob, by) => ({ id: Core.uid(), date: addDays(t, -days), worker, shop, req, task, in: inn, out, done, fu, ret, prob, newReq: "", by, fuClosed: false });
  const log = [L(3, "Miles O'Brien", "Starfleet Engineering", requests[1].id, "Diagnose thermostat, Engineering Deck", 545, 660, "Partly", "Thermostat needs replacing, part on order", addDays(t, 1), "", "Worf"),
    L(2, "Geordi La Forge", "Jupiter Station Repair Team", requests[2].id, "Repair plasma couplers, Transporter Room 3", 600, 840, "Partly", "Two fixtures need new housings", addDays(t, 0), "Exit sign out by stairwell B", "Data"),
    L(1, "B'Elanna Torres", "Shuttle Operations", "", "Inspect roof drains", 480, 570, "Yes", "", "", "Roof drain by loading dock clogged with leaves", "Nyota Uhura"),
    L(0, "Miles O'Brien", "Starfleet Engineering", requests[1].id, "Install new thermostat, Engineering Deck", 480, "", "", "", "", "", "Worf")];
  return Core.ensure({ people, avail, watches, requests, log, audit: [],
    settings: { calId: "", calName: "Enterprise Crew Calendar", invites: true, remind: 30, manager: id("William Riker"), acting: { pid: "", from: "", to: "" }, tmpl: T.slice(), appUrl: location.href.split("?")[0], mailLog: [] } });
}

/* ---------- sign-in gate ---------- */
function gate(html) { $("app").hidden = true; $("gate").hidden = false; $("gateBody").innerHTML = `<div><div class="eyebrow">Facilities</div><h1>Building Watch</h1></div>` + html; }
function jwt(t) { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return {}; } }
function loadGIS() {
  return new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.id) return res();
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error("Couldn't load Google sign-in. Check your connection or content blocker."));
    document.head.appendChild(s);
  });
}
async function startAuth(msg) {
  try { const t = sessionStorage.getItem("bw-token"); if (t && jwt(t).exp * 1000 > Date.now() + 60000) { TOKEN = t; return afterToken(); } } catch (e) {}
  if (!CFG.GOOGLE_CLIENT_ID) { gate(`<p class="chip warn">Setup isn't finished: GOOGLE_CLIENT_ID is missing in config.js.</p>`); return; }
  const hint = qs.get("invite") || "";
  gate(`${msg ? `<p class="chip warn" style="white-space:normal">${esc(msg)}</p>` : ""}
    <p>Sign in with the Google account your admin approved${hint ? `: <b>${esc(hint)}</b>` : ""}.</p>
    <div id="gbtn" style="min-height:44px"></div>
    <p class="why">Building Watch only receives your verified email address from Google. It never sees your password.</p>`);
  try {
    await loadGIS();
    google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, auto_select: true, login_hint: hint || undefined, cancel_on_tap_outside: false,
      callback: r => { TOKEN = r.credential; try { sessionStorage.setItem("bw-token", TOKEN); } catch (e) {} afterToken(); } });
    google.accounts.id.renderButton($("gbtn"), { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
    google.accounts.id.prompt();
  } catch (e) { gate(`<p class="chip warn">${esc(e.message)}</p>`); }
}
async function afterToken() {
  gate(`<p class="sub">Checking your access…</p>`);
  try {
    const w = await API.call("whoami");
    if (w.status === "denied") return gate(`<p><b>You don't have access yet.</b></p><p>You signed in as <b>${esc(w.email)}</b>. Ask an admin to add this exact address, or sign in with the account they approved.</p><button class="btn" id="swAcct">Use a different account</button>`), $("swAcct").onclick = () => signOut();
    if (w.status === "profile") return profileGate(w.me);
    boot();
  } catch (e) {
    if (e.code === "auth") return signOut(e.message);
    gate(`<p class="chip warn" style="white-space:normal">${esc(e.message)}</p><button class="btn" id="retry">Try again</button>`); $("retry").onclick = afterToken;
  }
}
function profileGate(me) {
  gate(`<h2>Welcome aboard</h2><p class="sub">You're signed in as <b>${esc(me.email)}</b>. Finish your profile to get started.</p>
    <label>Rank and name<input id="pfName" value="${esc(me.name && me.name !== me.email ? me.name : "")}" placeholder="e.g. MU2 Garcia"></label>
    <label>Phone (for the watch roster)<input id="pfPhone" placeholder="Optional"></label>
    <button class="btn primary" id="pfGo">Continue</button>`);
  $("pfGo").onclick = () => act(async () => { await API.call("profile.save", { name: $("pfName").value, phone: $("pfPhone").value }); boot(); });
}
function signOut(msg) {
  TOKEN = null; try { sessionStorage.removeItem("bw-token"); } catch (e) {}
  try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
  startAuth(msg);
}

/* ---------- boot and load ---------- */
async function boot() {
  $("gate").hidden = true; $("app").hidden = false;
  $("demoBar").hidden = !DEMO; $("signOut").hidden = DEMO;
  await loadWeek();
}
async function loadWeek(keepTab) {
  const d = await act(() => API.call("load", { week: week() }));
  if (!d) return;
  D = d;
  myDays = {}; week().forEach(date => { const a = D.avail.find(x => x.pid === D.me.id && x.date === date); myDays[date] = (a ? a.slots : ZERO).split(""); });
  dirty = false; busy = [];
  const tabs = tabList().map(x => x[0]);
  if (!tab || !tabs.includes(tab)) tab = tabs[0];
  render();
  if ((D.me.cals || []).some(c => c.on)) API.call("busy", { week: week() }).then(b => { busy = b || []; if (tab === "week") drawPaint(); }).catch(() => {});
}
function tabList() {
  const t = [["week", "My week"]];
  if (D.admin) t.push(["bill", "Watch bill"]);
  t.push(["log", "Maintenance log"]);
  if (D.admin) t.push(["check", "Watch checklist"]);
  t.push(["reqs", "Service requests"]);
  if (D.admin) t.push(["reports", "Reports"], ["admin", "Admin"]);
  t.push(["mine", "My settings"]);
  return t;
}
const person = id => D.people.find(p => p.id === id);
const pname = id => (person(id) || {}).name || "Unknown";
const watchers = () => D.people.filter(p => p.watch && p.active !== false);
function followups() { return D.log.filter(l => isOut(l) && !l.fuClosed && (l.done === "No" || l.done === "Partly" || l.fu || (l.prob && !l.newReq))); }

function render() {
  const b = { log: followups().length, reqs: D.admin ? D.requests.filter(r => r.status === "Open").length : 0 };
  $("tabs").innerHTML = tabList().map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}${b[k] ? `<span class="badge">${b[k]}</span>` : ""}</button>`).join("");
  const wk = week();
  $("wkLabel").textContent = `Week of ${parse(wk[0]).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`;
  const a = D.settings.acting;
  $("incharge").innerHTML = `Building manager: <b>${esc(D.manager || "not set")}</b>` + (D.inCharge && D.inCharge !== D.manager ? ` · In charge now: <b>${esc(D.inCharge)}</b> (acting${a.to ? " through " + md(a.to) : ""})` : "");
  $("whoChip").textContent = `${D.me.name}${D.admin ? " · Admin" : ""}`;
  ["week", "bill", "log", "check", "reqs", "reports", "admin", "mine"].forEach(k => $("s-" + k).hidden = k !== tab);
  if (DEMO) { $("demoMember").setAttribute("aria-pressed", Demo.as === "member"); $("demoAdmin").setAttribute("aria-pressed", Demo.as === "admin"); }
  ({ week: drawWeek, bill: drawBill, log: drawLog, check: drawCheck, reqs: drawReqs, reports: drawReports, admin: drawAdmin, mine: drawMine })[tab]();
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; if (dirty && tab === "week" && b.dataset.tab !== "week") toast("You have unsaved time on My week.", "err"); tab = b.dataset.tab; render(); });
const leaveWeek = fn => () => { if (dirty) { openModal("Unsaved changes", "You painted time you haven't saved.", "", `<span></span><div class="row" style="gap:8px"><button class="btn" data-act="discard">Discard</button><button class="btn primary" data-act="saveThen">Save</button></div>`); pendingNav = fn; return; } fn(); };
let pendingNav = null;
$("wkPrev").onclick = leaveWeek(() => { weekStart = addDays(weekStart, -7); loadWeek(); });
$("wkNext").onclick = leaveWeek(() => { weekStart = addDays(weekStart, 7); loadWeek(); });
$("wkNow").onclick = leaveWeek(() => { weekStart = monday(new Date()); loadWeek(); });
$("signOut").onclick = () => signOut();
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- modal ---------- */
function openModal(t, sub, body, acts, after) {
  $("dlgT").textContent = t; $("dlgSub").textContent = sub || ""; $("dlgSub").hidden = !sub;
  $("dlgBody").innerHTML = body; $("dlgAct").innerHTML = acts; $("modal").hidden = false;
  if (after) after(); else { const f = $("dlgBody").querySelector("input:not([type=checkbox]):not([type=radio]),textarea,select"); (f || $("dlgAct").querySelector("button") || $("dlgT")).focus(); }
}
function closeModal() { $("modal").hidden = true; if (sel) { sel = null; if (tab === "bill") drawHeat(); } }
$("modal").addEventListener("click", e => { if (e.target.id === "modal" || e.target.dataset.act === "cancel") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
$("dlgAct").addEventListener("click", e => {
  const a = e.target.dataset.act; if (!a) return;
  ({ saveReq, saveWatch, saveCI, saveCO,
    discard: () => { closeModal(); dirty = false; const f = pendingNav; pendingNav = null; f && f(); },
    saveThen: async () => { closeModal(); await saveMyWeek(); const f = pendingNav; pendingNav = null; f && f(); } })[a]?.();
});

/* ---------- My week ---------- */
const mineAt = (date, i) => myDays[date] && myDays[date][i] === "1";
function drawPaint() {
  const wk = week(), t = D.today, hasCal = (D.me.cals || []).some(c => c.on);
  let html = "<tr><th class='t'></th>" + wk.map(d => `<th class="${d === t ? "today" : ""}">${dayLbl(d)}</th>`).join("") + "</tr>";
  SLOTS.forEach((m, i) => {
    html += "<tr><th class='t'>" + (m % 60 ? "" : fmt(m)) + "</th>";
    wk.forEach(date => {
      const on = mineAt(date, i), a = D.watches.some(x => x.pid === D.me.id && x.date === date && i >= x.s && i < x.e);
      const b = busy.find(x => x.date === date && i >= x.s && i < x.e);
      html += `<td data-k="${date}|${i}" class="${on ? "on" : ""} ${a ? "asg" : ""} ${b ? "busy" : ""}" aria-label="${dayLbl(date)} ${fmt(m)}${b ? ", " + esc(b.t) : ""}"${b ? ` title="${esc(b.t)}"` : ""}>${b && b.s === i ? `<span class="ev">${esc(b.t)}</span>` : ""}</td>`;
    });
    html += "</tr>";
  });
  $("paintGrid").innerHTML = html;
  $("dirtyNote").hidden = !dirty;
  $("calNote").textContent = hasCal ? `Showing your own calendar so you can see what you already have. Only you see these titles.` : `Tip: add your own calendar in My settings to see what you already have while you paint.`;
}
function drawWeek() {
  drawPaint();
  const list = D.watches.filter(x => x.pid === D.me.id), T = D.settings.tmpl;
  $("myWatches").innerHTML = list.length ? list.map(w => {
    const n = T.filter(t => w.checks[t]).length, co = [...new Set(D.watches.filter(x => x.id !== w.id && x.date === w.date && x.s < w.e && x.e > w.s).map(x => pname(x.pid)))];
    return `<div class="watchcard"><div class="row"><b>${dayLbl(w.date)} · ${span(w)}</b><span class="chip ${n === T.length ? "ok" : ""}">${n}/${T.length} done</span></div>
      ${co.length ? `<div class="why">With ${esc(co.join(", "))}</div>` : ""}
      ${T.map(t => `<label class="inline"><input type="checkbox" data-w="${w.id}" data-t="${esc(t)}" ${w.checks[t] ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div>`;
  }).join("") : "<div class='empty'>No watches this week.</div>";
}
$("myWatches").addEventListener("change", e => {
  const c = e.target; if (!c.dataset.w) return;
  const w = D.watches.find(x => x.id === c.dataset.w); if (c.checked) w.checks[c.dataset.t] = 1; else delete w.checks[c.dataset.t];
  drawWeek();
  act(() => API.call("check", { wid: c.dataset.w, item: c.dataset.t, on: c.checked }));
});
let painting = null; const pg = $("paintGrid");
const cellAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest ? el.closest("#paintGrid td[data-k]") : null; };
function apply(el) { if (!el) return; const [date, i] = el.dataset.k.split("|"); myDays[date][+i] = painting === "add" ? "1" : "0"; el.classList.toggle("on", painting === "add"); dirty = true; }
pg.addEventListener("pointerdown", e => { const el = cellAt(e); if (!el) return; e.preventDefault(); const [date, i] = el.dataset.k.split("|"); painting = mineAt(date, +i) ? "del" : "add"; pg.setPointerCapture(e.pointerId); apply(el); });
pg.addEventListener("pointermove", e => { if (painting) apply(cellAt(e)); });
const pend = () => { if (painting) { painting = null; drawPaint(); } };
pg.addEventListener("pointerup", pend); pg.addEventListener("pointercancel", pend);
$("clearMe").onclick = () => { week().forEach(d => myDays[d] = ZERO.split("")); dirty = true; drawPaint(); };
$("copyMon").onclick = () => { const mon = myDays[week()[0]].slice(); week().slice(1).forEach(d => myDays[d] = mon.slice()); dirty = true; drawPaint(); toast("Monday copied to the whole week. Save when ready."); };
async function saveMyWeek() {
  const days = {}; week().forEach(d => days[d] = myDays[d].join(""));
  const r = await act(() => API.call("avail.save", { days }), "Saved to the calendar");
  if (r) { dirty = false; await loadWeek(); }
}
$("saveMe").onclick = saveMyWeek;

/* ---------- Watch bill ---------- */
const slotsOf = (pid, date) => { const a = D.avail.find(x => x.pid === pid && x.date === date); return a ? a.slots : ZERO; };
const whoIn = (date, i) => watchers().filter(p => slotsOf(p.id, date)[i] === "1");
const standers = (date, i) => [...new Set(D.watches.filter(x => x.date === date && i >= x.s && i < x.e).map(x => x.pid))];
function drawPick() {
  $("pickRow").innerHTML = `<button class="pk" aria-pressed="${!chosen.size}" data-n="">Suggest for me</button>` + watchers().map(p => `<button class="pk" aria-pressed="${chosen.has(p.id)}" data-n="${p.id}">${esc(p.name)}</button>`).join("");
}
$("pickRow").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; const n = b.dataset.n; if (!n) chosen.clear(); else chosen.has(n) ? chosen.delete(n) : chosen.add(n); drawPick(); });
function drawHeat() {
  const wk = week(), t = D.today;
  let html = "<tr><th class='t'></th>" + wk.map(d => `<th class="${d === t ? "today" : ""}">${dayLbl(d)}</th>`).join("") + "</tr>";
  SLOTS.forEach((m, i) => {
    html += "<tr><th class='t'>" + (m % 60 ? "" : fmt(m)) + "</th>";
    wk.forEach((date, d) => {
      const c = whoIn(date, i).length, w = standers(date, i).length;
      const cls = (c === 0 ? "gap" : "l" + Math.min(c, 4)) + (sel && sel.d === d && i >= sel.s && i < sel.e ? " sel" : "") + (w ? " w" : "") + (w > 1 ? " w2" : "");
      html += `<td class="${cls}" data-d="${d}" data-i="${i}" tabindex="0" aria-label="${dayLbl(date)} ${fmt(m)}, ${c} in building, ${w} on watch">${c}</td>`;
    });
    html += "</tr>";
  });
  $("heatGrid").innerHTML = html;
}
function drawBill() {
  drawPick(); drawHeat();
  $("inviteNote").textContent = D.settings.invites ? "Each person on watch gets a private calendar invitation." : "Calendar invitations are turned off in Admin.";
  const T = D.settings.tmpl.length;
  $("allAsg").innerHTML = D.watches.length ? D.watches.map(x => `<li><span><b>${esc(pname(x.pid))}</b></span><span class="mono">${dayLbl(x.date)} ${span(x)} · ${D.settings.tmpl.filter(t => x.checks[t]).length}/${T}</span></li>`).join("") : "<li class='empty'>No watches this week.</li>";
}
let drag = null; const hg = $("heatGrid");
const hcell = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest ? el.closest("#heatGrid td") : null; };
hg.addEventListener("pointerdown", e => { const td = hcell(e); if (!td) return; e.preventDefault(); hg.setPointerCapture(e.pointerId); const d = +td.dataset.d, i = +td.dataset.i; drag = { d, a: i }; sel = { d, s: i, e: i + 1 }; drawHeat(); });
hg.addEventListener("pointermove", e => { if (!drag) return; const td = hcell(e); if (!td) return; const i = +td.dataset.i, s = Math.min(drag.a, i), en = Math.max(drag.a, i) + 1; if (s !== sel.s || en !== sel.e) { sel = { d: drag.d, s, e: en }; drawHeat(); } });
const hend = () => { if (!drag) return; drag = null; openAssign(); };
hg.addEventListener("pointerup", hend); hg.addEventListener("pointercancel", hend);
hg.addEventListener("keydown", e => { if (e.key === "Enter") { const td = e.target.closest("td"); if (td) { const i = +td.dataset.i; sel = { d: +td.dataset.d, s: i, e: i + 1 }; drawHeat(); openAssign(); } } });
function openAssign() {
  const { d, s, e } = sel, n = e - s, date = week()[d];
  const w = whoIn(date, s).map(p => p.name), st = standers(date, s).map(pname);
  $("slotInfo").innerHTML = `<b>${dayLbl(date)} ${fmt(SLOTS[s])}</b>: ${w.length ? esc(w.join(", ")) : "<span style='color:var(--warn)'>nobody in the building</span>"}<br>Watch: ${st.length ? "<b>" + esc(st.join(", ")) + "</b>" : "<span style='color:var(--warn)'>not assigned</span>"}`;
  const onNow = new Set(D.watches.filter(x => x.date === date && x.s < e && x.e > s).map(x => x.pid));
  const rows = watchers().map(p => { let c = 0; for (let i = s; i < e; i++) if (slotsOf(p.id, date)[i] === "1") c++;
    return { p, c, score: (c === n ? 100 : c / n * 40) - (D.monthCounts[p.id] || 0) * 6 + (onNow.has(p.id) ? 200 : 0) + (chosen.has(p.id) ? 300 : 0) }; })
    .filter(r => r.c > 0 || onNow.has(r.p.id) || chosen.has(r.p.id)).sort((a, b) => b.score - a.score);
  const pre = new Set([...onNow, ...chosen]); if (!pre.size && rows.length && rows[0].c === n) pre.add(rows[0].p.id);
  const body = rows.length ? rows.map(r => {
    const status = r.c === n ? '<span class="chip ok">In the whole time</span>' : r.c ? `<span class="chip warn">In ${r.c} of ${n} half hours</span>` : '<span class="chip warn">Not in the building</span>';
    return `<label class="cand"><input type="checkbox" value="${r.p.id}" ${pre.has(r.p.id) ? "checked" : ""}><div class="item"><b>${esc(r.p.name)}</b><div class="row start" style="gap:6px">${status}${onNow.has(r.p.id) ? '<span class="chip gold">On watch now</span>' : ""}<span class="why">${D.monthCounts[r.p.id] || 0} watches this month</span></div></div></label>`;
  }).join("") : "<div class='empty'>Nobody is in the building then. Tap names above the chart to assign someone anyway.</div>";
  openModal(`Watch: ${dayLbl(date)}, ${fmt(SLOTS[s])}-${fmt(SLOTS[e - 1] + 30)}`, "Check everyone who should stand this watch.", body,
    `<span class="why" id="wCount"></span><div class="row" style="gap:8px"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="saveWatch">Save watch</button></div>`);
  updCount();
}
function updCount() { const k = $("dlgBody").querySelectorAll(".cand input:checked").length; if ($("wCount")) $("wCount").textContent = k ? `${k} on watch` : "Nobody on watch"; }
$("dlgBody").addEventListener("change", e => {
  updCount();
  if (e.target.id === "ciReq" && e.target.value && !$("ciTask").value) { const r = D.requests.find(x => x.id === e.target.value); if (r) $("ciTask").value = r.issue; }
});
$("dlgBody").addEventListener("input", e => { if (e.target.id === "coProb") $("coReqBox").hidden = !e.target.value.trim(); });
async function saveWatch() {
  const { d, s, e } = sel, pids = [...$("dlgBody").querySelectorAll(".cand input:checked")].map(i => i.value);
  closeModal();
  await act(() => API.call("watch.save", { date: week()[d], s, e, pids }), () => pids.length ? `Watch set: ${pids.map(pname).join(", ")}${D.settings.invites ? ". Invitations sent." : ""}` : "Watch cleared");
  await loadWeek();
}

/* ---------- Maintenance log ---------- */
const reqOf = id => D.requests.find(x => x.id === id);
const reqShort = id => { const r = reqOf(id); return r ? (r.wo || "Request") + " · " + r.loc : ""; };
function drawLog() {
  const open = D.log.filter(l => !isOut(l)); $("nowCount").textContent = open.length || "";
  $("nowList").innerHTML = open.length ? open.map(l => `<li><div class="item"><b>${esc(l.worker)}</b><span class="why">${esc(l.shop)}${l.req ? " · " + esc(reqShort(l.req)) : ""}</span><span>${esc(l.task)}</span><span class="mono">In ${fmt(+l.in)}${l.date !== D.today ? " on " + md(l.date) : ""} · logged by ${esc(l.by)}</span></div><button class="btn small primary" data-co="${l.id}">Check out</button></li>`).join("") : "<li class='empty'>No workers in the building.</li>";
  const fu = followups();
  $("fuList").innerHTML = fu.length ? fu.map(l => `<li><div class="item"><b>${esc(l.task)}</b><span class="why">${esc(l.worker)}${l.shop ? ", " + esc(l.shop) : ""} · ${md(l.date)} · finished: ${esc(l.done)}</span>
    ${l.fu ? `<span>Follow-up: ${esc(l.fu)}</span>` : ""}${l.ret ? `<span class="mono">Returning ${md(l.ret)}</span>` : ""}${l.prob && !l.newReq ? `<span>New problem: ${esc(l.prob)}</span>` : ""}</div>
    <div class="row" style="gap:6px">${l.prob && !l.newReq ? `<button class="btn small" data-mk="${l.id}">Open request</button>` : ""}${D.admin ? `<button class="btn small" data-res="${l.id}">Resolved</button>` : ""}</div></li>`).join("") : "<li class='empty'>Nothing waiting.</li>";
  const rows = [...D.log].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.in - a.in);
  $("logTbl").innerHTML = `<tr><th>Date</th><th>Worker</th><th>Job</th><th>In</th><th>Out</th><th>Finished</th><th>Follow-up / new problems</th><th>Logged by</th></tr>` + (rows.length ? rows.map(l => `<tr><td class="mono">${md(l.date)}</td><td>${esc(l.worker)}<div class="why">${esc(l.shop)}</div></td>
    <td>${esc(l.task)}${l.req ? `<div class="why">${esc(reqShort(l.req))}</div>` : ""}</td><td class="mono">${fmt(+l.in)}</td><td class="mono">${isOut(l) ? fmt(+l.out) : '<span class="chip">in now</span>'}</td>
    <td>${l.done ? `<span class="chip ${l.done === "Yes" ? "ok" : "warn"}">${esc(l.done)}</span>` : ""}</td>
    <td>${l.fu ? esc(l.fu) : ""}${l.ret ? `<div class="mono">Back ${md(l.ret)}</div>` : ""}${l.prob ? `<div class="why">New: ${esc(l.prob)}${l.newReq ? " (request opened)" : ""}</div>` : ""}</td><td class="why">${esc(l.by)}</td></tr>`).join("") : `<tr><td colspan="8" class="empty">No entries yet.</td></tr>`);
}
function openCI() {
  const open = D.requests.filter(r => r.status !== "Closed");
  const shops = [...new Set(D.log.map(l => l.shop).filter(Boolean))];
  openModal("Check in a worker", "Log maintenance or contractor personnel when they arrive.", `<div class="form">
    <label>Worker name<input id="ciName" placeholder="e.g. J. Ramos"></label>
    <label>Shop or company<input id="ciShop" placeholder="e.g. PW HVAC shop" list="shops"></label>
    <datalist id="shops">${shops.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
    <label class="full">Service request<select id="ciReq"><option value="">Not tied to a request</option>${open.map(r => `<option value="${r.id}">${esc((r.wo ? r.wo + " · " : "") + r.loc + ": " + r.issue)}</option>`).join("")}</select></label>
    <label class="full">What are they here to do?<input id="ciTask" placeholder="e.g. Replace thermostat, Rm 210"></label></div>`,
    `<span class="why">Logged by ${esc(D.me.name)}</span><div class="row" style="gap:8px"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="saveCI">Check in</button></div>`);
}
async function saveCI() {
  const worker = $("ciName").value.trim(); if (!worker) { $("ciName").focus(); toast("Enter the worker's name", "err"); return; }
  const p = { worker, shop: $("ciShop").value, req: $("ciReq").value, task: $("ciTask").value };
  closeModal();
  await act(() => API.call("log.in", p), `${worker} checked in`); await loadWeek();
}
let coId = null;
function openCO(id) {
  coId = id; const l = D.log.find(x => x.id === id);
  openModal(`Check out ${l.worker}`, `${l.shop ? l.shop + " · " : ""}in since ${fmt(+l.in)} · ${l.task}`, `
    <div><div class="why" style="margin-bottom:4px">Did they finish the job?</div><div class="row start">${["Yes", "Partly", "No"].map(v => `<label class="inline"><input type="radio" name="coDone" value="${v}" ${v === "Yes" ? "checked" : ""}> ${v}</label>`).join("")}</div></div>
    <label>More work or follow-up needed?<textarea id="coFu" placeholder="Parts on order, needs another shop, etc. Leave blank if none"></textarea></label>
    <label>Coming back on<input type="date" id="coRet"></label>
    <label>Did they find any new problems?<textarea id="coProb" placeholder="What and where. Leave blank if none"></textarea></label>
    <div class="form" id="coReqBox" hidden><label class="full">Location of new problem<input id="coLoc" placeholder="e.g. Stairwell B"></label>
      <label class="inline full"><input type="checkbox" id="coMake" checked> Open a service request for it</label></div>
    ${l.req ? `<div class="why">Linked request: ${esc(reqShort(l.req))}. Finished with no follow-up closes it; otherwise it stays in progress.</div>` : ""}`,
    `<span></span><div class="row" style="gap:8px"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="saveCO">Check out</button></div>`);
}
async function saveCO() {
  const p = { id: coId, done: document.querySelector("input[name=coDone]:checked").value, fu: $("coFu").value, ret: $("coRet").value, prob: $("coProb").value, loc: $("coLoc").value, make: $("coMake").checked };
  closeModal();
  await act(() => API.call("log.out", p), r => `${r.worker} checked out${r.newReq ? ". New request opened." : ""}`); await loadWeek();
}
$("s-log").addEventListener("click", async e => {
  const t = e.target.dataset;
  if (t.lg === "in") openCI();
  if (t.co) openCO(t.co);
  if (t.res) { await act(() => API.call("log.resolve", { id: t.res }), "Marked resolved"); await loadWeek(); }
  if (t.mk) { await act(() => API.call("log.makeReq", { id: t.mk }), "Service request opened"); await loadWeek(); }
});

/* ---------- Checklist ---------- */
function drawCheck() {
  const T = D.settings.tmpl;
  $("tmplList").innerHTML = T.map((t, k) => `<li><span>${esc(t)}</span><button class="btn small" data-del="${k}">Remove</button></li>`).join("") || "<li class='empty'>No duties yet.</li>";
  $("compList").innerHTML = D.watches.length ? D.watches.map(w => {
    const n = T.filter(t => w.checks[t]).length, pct = T.length ? Math.round(n / T.length * 100) : 0, past = w.date < D.today;
    return `<div class="item" style="gap:5px"><div class="row"><span><b>${esc(pname(w.pid))}</b> <span class="mono">${dayLbl(w.date)} ${span(w)}</span></span><span class="chip ${n === T.length ? "ok" : past ? "warn" : ""}">${n}/${T.length}${past && n < T.length ? " missed" : ""}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join("") : "<div class='empty'>No watches this week.</div>";
}
async function saveTmpl(T) { const r = await act(() => API.call("tmpl.save", { tmpl: T }), "Duties updated"); if (r) { D.settings.tmpl = r; drawCheck(); } }
$("tmplList").addEventListener("click", e => { const k = e.target.dataset.del; if (k != null) { const T = D.settings.tmpl.slice(); T.splice(+k, 1); saveTmpl(T); } });
const addDuty = () => { const v = $("tmplNew").value.trim(); if (!v) return; $("tmplNew").value = ""; saveTmpl(D.settings.tmpl.concat([v])); };
$("tmplAdd").onclick = addDuty; $("tmplNew").addEventListener("keydown", e => { if (e.key === "Enter") addDuty(); });

/* ---------- Service requests ---------- */
function newReqModal() {
  openModal("New service request", "", `<div class="form"><label class="full">Location<input id="rqLoc" placeholder="Deck, room, or area"></label>
    <label class="full">What's wrong?<textarea id="rqIssue" placeholder="Describe the problem"></textarea></label>
    <label>Priority<select id="rqPri"><option>Routine</option><option>Urgent</option><option>Emergency</option></select></label></div>
    <div class="why">For anything unsafe (flooding, sparking, gas smell) call the base trouble desk first, then log it here.</div>`,
    `<span class="why">From ${esc(D.me.name)}</span><div class="row" style="gap:8px"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="saveReq">Submit</button></div>`);
}
$("quickReq").onclick = newReqModal;
async function saveReq() {
  const issue = $("rqIssue").value.trim(); if (!issue) { $("rqIssue").focus(); toast("Describe the problem first", "err"); return; }
  const p = { loc: $("rqLoc").value, issue, pri: $("rqPri").value }; closeModal();
  await act(() => API.call("req.new", p), "Service request submitted"); await loadWeek();
}
const reqText = r => `SERVICE REQUEST\nLocation: ${r.loc}\nProblem: ${r.issue}\nPriority: ${r.pri}\nReported by: ${r.by}, ${r.date}\nPOC: ${D.inCharge || D.me.name}`;
function drawReqs() {
  const a = D.admin, rs = [...D.requests].sort((x, y) => (x.status === "Closed") - (y.status === "Closed") || (x.date < y.date ? 1 : -1));
  const counts = STATUSES.map(s => `<span class="chip ${s === "Open" ? "warn" : s === "Closed" ? "ok" : ""}">${s}: ${D.requests.filter(r => r.status === s).length}</span>`).join(" ");
  $("s-reqs").innerHTML = `<div class="row"><div><h2>Service requests</h2><div class="row start" style="gap:6px;margin-top:6px">${counts}</div></div><button class="btn primary" data-q="new">+ New request</button></div>
  <div class="scroll"><table class="tbl"><tr><th>Date</th><th>Location</th><th>Problem</th><th>Priority</th><th>By</th><th>Status</th><th>Work order</th>${a ? "<th></th>" : ""}</tr>
  ${rs.length ? rs.map(r => `<tr><td class="mono">${md(r.date)}</td><td>${esc(r.loc)}</td><td>${esc(r.issue)}</td><td>${r.pri === "Routine" ? r.pri : `<span class="chip warn">${esc(r.pri)}</span>`}</td><td>${esc(r.by)}</td>
   <td>${a ? `<select data-st="${r.id}" aria-label="Status">${STATUSES.map(s => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select>` : `<span class="chip ${r.status === "Open" ? "warn" : r.status === "Closed" ? "ok" : ""}">${esc(r.status)}</span>`}</td>
   <td>${a ? `<input data-wo="${r.id}" value="${esc(r.wo)}" placeholder="WO #" style="width:110px" aria-label="Work order">` : (esc(r.wo) || "<span class='why'>none</span>")}</td>
   ${a ? `<td><button class="btn small" data-cp="${r.id}">Copy for trouble call</button></td>` : ""}</tr>`).join("") : `<tr><td colspan="8" class="empty">No requests yet.</td></tr>`}</table></div>
  ${a ? `<div class="why">"Copy for trouble call" copies a formatted request to paste into the official Public Works system or an email. Record their work order number here to track it.</div>` : ""}`;
}
$("s-reqs").addEventListener("click", e => { if (e.target.dataset.q === "new") newReqModal(); const c = e.target.dataset.cp; if (c) copy(reqText(reqOf(c)), "Copied. Paste it into the trouble call system."); });
$("s-reqs").addEventListener("change", async e => {
  const st = e.target.dataset.st, wo = e.target.dataset.wo;
  if (st) { const r = await act(() => API.call("req.update", { id: st, status: e.target.value }), "Status updated"); if (r) Object.assign(reqOf(st), r); drawReqs(); render(); }
  if (wo) { const r = await act(() => API.call("req.update", { id: wo, wo: e.target.value }), "Work order saved"); if (r) Object.assign(reqOf(wo), r); }
});

/* ---------- Reports ---------- */
function drawReports() {
  if (!$("rFrom").value) { $("rFrom").value = week()[0]; $("rTo").value = week()[4]; }
  if (!report) { $("repTbl").innerHTML = `<tr><td class="empty">Pick dates and run the report.</td></tr>`; $("repBtns").hidden = true; return; }
  const m = manpower(), cols = Object.keys(m[0] || { Name: "" });
  const tot = c => m.reduce((a, r) => a + (typeof r[c] === "number" ? r[c] : 0), 0);
  $("repTbl").innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>` + m.map(r => `<tr>${cols.map((c, k) => `<td class="${k ? "n" : ""}">${esc(r[c])}</td>`).join("")}</tr>`).join("") +
    `<tr>${cols.map((c, k) => `<td class="${k ? "n" : ""}"><b>${k === 0 ? "Total" : (c === "Checklist" ? "" : +tot(c).toFixed(1))}</b></td>`).join("")}</tr>`;
  $("repBtns").hidden = false;
}
function manpower() {
  const R = report;
  return R.people.filter(p => p.active || R.avail.some(a => a.pid === p.id) || R.watches.some(w => w.pid === p.id)).map(p => {
    const hrs = R.avail.filter(a => a.pid === p.id).reduce((s, a) => s + a.slots.split("").filter(c => c === "1").length * 0.5, 0);
    const ws = R.watches.filter(w => w.pid === p.id), wh = ws.reduce((s, w) => s + (w.e - w.s) / 2, 0);
    const cd = ws.reduce((s, w) => s + Object.keys(w.checks || {}).length, 0), ct = ws.length * R.tmplLen;
    return { Name: p.name, "Hrs in building": hrs, Watches: ws.length, "Watch hrs": wh, Checklist: ct ? `${Math.min(cd, ct)}/${ct}` : "", "Workers logged": R.log.filter(l => l.by === p.name).length, Requests: R.requests.filter(r => r.byId === p.id).length };
  });
}
$("rRun").onclick = async () => {
  const from = $("rFrom").value, to = $("rTo").value; if (!from || !to || from > to) { toast("Pick a valid date range", "err"); return; }
  const r = await act(() => API.call("range", { from, to })); if (r) { report = r; drawReports(); }
};
const csv = rows => { const cols = Object.keys(rows[0] || {}); return [cols.join(",")].concat(rows.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n"); };
function dataset(k) {
  const R = report;
  if (k === "man") return manpower();
  if (k === "log") return R.log.map(l => ({ Date: l.date, Worker: l.worker, "Shop or company": l.shop, Job: l.task, In: fmt(+l.in), Out: isOut(l) ? fmt(+l.out) : "", Finished: l.done, "Follow-up": l.fu, Returning: l.ret, "New problems": l.prob, "Logged by": l.by }));
  return R.requests.map(r => ({ Date: r.date, Location: r.loc, Problem: r.issue, Priority: r.pri, By: r.by, Status: r.status, "Work order": r.wo }));
}
$("s-reports").addEventListener("click", e => {
  const k = e.target.dataset.csv, c = e.target.dataset.copy; if (!k && !c) return;
  if (!report) { toast("Run the report first", "err"); return; }
  if (k) { const rows = dataset(k); if (!rows.length) { toast("Nothing in that date range", "err"); return; } download(`${{ man: "manpower", log: "maintenance-log", req: "service-requests" }[k]}_${$("rFrom").value}_to_${$("rTo").value}.csv`, csv(rows)); }
  if (c) { const rows = dataset("man"); copy([Object.keys(rows[0]).join("\t")].concat(rows.map(r => Object.values(r).join("\t"))).join("\n"), "Copied. Paste into Excel or Sheets."); }
});

/* ---------- My settings ---------- */
const subLink = () => `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(D.settings.calId || "")}`;
const copyBox = (id, v) => `<div class="copybox"><input id="${id}" value="${esc(v)}" readonly aria-label="Link"><button class="btn small" data-cpv="${id}">Copy</button></div>`;
document.addEventListener("click", e => { const id = e.target.dataset && e.target.dataset.cpv; if (id) copy($(id).value, "Copied"); });
function drawMine() {
  const me = D.me, cals = me.cals || [];
  $("s-mine").innerHTML = `<div class="panel"><h2>My calendars</h2>
    <div class="sub" style="margin-top:-8px">Add your own calendar so its events show as striped blocks while you paint your time. Only you see the titles. Everyone else sees only the time you paint.</div>
    <ul class="list">${cals.length ? cals.map((c, k) => `<li><label class="inline"><input type="checkbox" data-mcal="${k}" ${c.on ? "checked" : ""}> <span class="item"><b>${esc(c.label)}</b><span class="mono" style="word-break:break-all">${esc(c.url.length > 60 ? c.url.slice(0, 57) + "…" : c.url)}</span></span></label><button class="btn small" data-mdel="${k}">Remove</button></li>`).join("") : "<li class='empty'>No calendars added.</li>"}</ul>
    <div class="form"><label>Name<input id="mcLabel" placeholder="e.g. iPhone calendar"></label><label>Calendar address<input id="mcUrl" placeholder="Secret iCal or .ics link"></label></div>
    <button class="btn primary" id="mcAdd" style="align-self:flex-start">Add calendar</button>
    <div class="why"><b>Google:</b> calendar.google.com, Settings, click your calendar, copy "Secret address in iCal format." <b>iPhone (iCloud):</b> Calendar app, Calendars, tap (i) next to the calendar, turn on Public Calendar, Share Link. <b>Outlook:</b> Settings, Calendar, Shared calendars, Publish, copy the ICS link.</div></div>
  <div class="stack"><div class="panel"><h2>Main calendar on your phone</h2>
    <div class="sub" style="margin-top:-8px">${esc(D.settings.calName)} shows who is in the building and the watch bill. It's shared with your Google account when an admin adds you.</div>
    ${D.settings.calId ? `<label>Open in Google Calendar${copyBox("subG", subLink())}</label>` : `<div class="why">An admin hasn't set the main calendar yet.</div>`}
    <div class="why"><b>iPhone:</b> Settings, Calendar, Accounts, Add Account, Google, sign in with ${esc(me.email)}. Then on a computer open calendar.google.com/calendar/syncselect and tick ${esc(D.settings.calName)} so it shows on the phone.</div>
    <div class="why">Your own watches also arrive as calendar invitations${D.settings.invites ? "" : " (turned off by an admin)"}.</div></div>
  <div class="panel"><h2>My profile</h2><div class="sub" style="margin-top:-8px">Signed in as ${esc(me.email)}</div>
    <label>Rank and name<input id="myName" value="${esc(me.name)}"></label><label>Phone<input id="myPhone" value="${esc(me.phone)}"></label>
    <button class="btn small primary" id="mySave" style="align-self:flex-start">Save profile</button></div></div>`;
}
async function saveCals(cals, msg) { const r = await act(() => API.call("cals.save", { cals }), msg); if (r) { D.me.cals = r; drawMine(); busy = []; if (r.some(c => c.on)) API.call("busy", { week: week() }).then(b => busy = b || []).catch(() => {}); } }
$("s-mine").addEventListener("click", async e => {
  const t = e.target, cals = (D.me.cals || []).slice();
  if (t.id === "mcAdd") { const url = $("mcUrl").value.trim(); if (!url) { $("mcUrl").focus(); toast("Paste the calendar address", "err"); return; } cals.push({ label: $("mcLabel").value.trim() || "My calendar", url, on: true }); saveCals(cals, "Calendar added"); }
  if (t.dataset.mdel != null) { cals.splice(+t.dataset.mdel, 1); saveCals(cals, "Calendar removed"); }
  if (t.id === "mySave") { const r = await act(() => API.call("profile.save", { name: $("myName").value, phone: $("myPhone").value }), "Profile saved"); if (r) { Object.assign(D.me, r); render(); } }
});
$("s-mine").addEventListener("change", e => { const k = e.target.dataset.mcal; if (k != null) { const cals = D.me.cals.slice(); cals[+k] = Object.assign({}, cals[+k], { on: e.target.checked }); saveCals(cals, e.target.checked ? "Calendar shown" : "Calendar hidden"); } });

/* ---------- Admin ---------- */
const TEMPLATES = {
  avail: { s: "Building Watch: enter your time for next week", b: "Shipmates,\n\nPlease paint the times you'll be in the building next week by Friday COB.\n\nOpen Building Watch, go to My week, drag over your hours, and press Save.\n{url}\n\nV/r,\n{from}" },
  watch: { s: "Watch bill posted", b: "Shipmates,\n\nNext week's building watch bill is posted. Check your calendar for invitations and accept them.\n{url}\n\nV/r,\n{from}" },
  custom: { s: "", b: "" } };
const opt = (list, v) => list.map(([val, lbl]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(lbl)}</option>`).join("");
function drawAdmin() {
  const st = D.settings, a = st.acting || {}, active = D.people.filter(p => p.active !== false), ppl = active.map(p => [p.id, p.name]);
  $("s-admin").innerHTML = `<div class="cols2">
  <div class="panel"><h2>Who's in charge</h2>
    <label>Building manager<select id="adMgr">${opt(ppl, st.manager)}</select></label>
    <div class="why">When the manager is away, name an acting manager (CIC). They get full admin rights for those dates and show as in charge.</div>
    <div class="form"><label class="full">Acting manager<select id="adActWho"><option value="">None</option>${opt(ppl, a.pid)}</select></label>
      <label>From<input type="date" id="adActFrom" value="${esc(a.from)}"></label><label>Through<input type="date" id="adActTo" value="${esc(a.to)}"></label></div>
    <div class="row start"><button class="btn primary" id="adActSave">Save</button>${a.pid ? `<button class="btn" id="adActClear">End acting</button>` : ""}</div></div>
  <div class="panel"><h2>Main calendar</h2>
    <label>Calendar name<input id="adCalName" value="${esc(st.calName)}"></label>
    <label>Google Calendar ID<input id="adCalId" value="${esc(st.calId)}" placeholder="…@group.calendar.google.com"></label>
    <div class="why">The calendar's owner shares it with the app owner (Make changes and manage sharing). Find the ID in Calendar settings, Integrate calendar.</div>
    <label class="inline"><input type="checkbox" id="adInv" ${st.invites ? "checked" : ""}> Send watch assignments as private calendar invitations</label>
    <label>Invitation reminder<select id="adRem">${opt([["0", "None"], ["15", "15 minutes before"], ["30", "30 minutes before"], ["60", "1 hour before"], ["1440", "1 day before"]], String(st.remind))}</select></label>
    <label>App link used in invitations<input id="adUrl" value="${esc(st.appUrl)}"></label>
    <button class="btn primary" id="adCalSave" style="align-self:flex-start">Save calendar settings</button></div></div>
  <div class="panel"><h2>Data storage</h2>
    <div class="sub" style="margin-top:-8px">Everything is kept in one Google Sheet. It can live in anyone's Drive as long as it's shared with the app owner as Editor.</div>
    <div class="form"><label class="full">Sheet URL or ID<input id="adSheet" placeholder="https://docs.google.com/spreadsheets/d/…"></label></div>
    <div class="row start"><button class="btn" id="adTest">Test connection</button><button class="btn primary" id="adMove">Switch to this Sheet</button></div>
    <div id="adTestOut" class="why">${DEMO ? "Demo mode: no Google Sheet is connected." : "Run a test to see which Sheet and calendar the app is using."}</div>
    <div class="why">Switching to an empty Sheet copies all current data into it. Switching to a Sheet that already has Building Watch data uses that data instead.</div></div>
  <div class="panel"><div class="row"><h2>People and roles</h2><span class="why">Only people on this list can sign in. Admins can assign watches, edit duties and change settings.</span></div>
    <div class="scroll"><table class="tbl"><tr><th>Name</th><th>Google email</th><th>Role</th><th>Stands watch</th><th>Status</th><th></th></tr>
    ${D.people.map(p => `<tr><td><input data-pf="name" data-pid="${p.id}" value="${esc(p.name)}" style="min-width:130px" aria-label="Name">${p.id === st.manager ? ' <span class="chip gold">Manager</span>' : ""}${p.id === a.pid ? ' <span class="chip">Acting</span>' : ""}</td>
      <td><input data-pf="email" data-pid="${p.id}" value="${esc(p.email)}" style="min-width:200px" aria-label="Email"></td>
      <td><select data-pf="role" data-pid="${p.id}" aria-label="Role">${opt([["Admin", "Admin"], ["Member", "Member"]], p.role)}</select></td>
      <td><input type="checkbox" data-pf="watch" data-pid="${p.id}" ${p.watch ? "checked" : ""} aria-label="Stands watch"></td>
      <td>${p.active === false ? '<span class="chip warn">Deactivated</span>' : p.joinedAt ? `<span class="chip ok">Joined</span>${p.calCount ? ' <span class="why">calendar added</span>' : ""}` : `<span class="chip">Invited ${md((p.invitedAt || "").slice(0, 10))}</span>`}</td>
      <td class="row" style="gap:6px;flex-wrap:nowrap">${p.active === false ? `<button class="btn small" data-pa="on" data-pid="${p.id}">Reactivate</button>` : `${p.joinedAt ? "" : `<button class="btn small" data-pinv="${p.id}">Resend invite</button>`}${p.id === D.me.id ? "" : `<button class="btn small" data-pa="off" data-pid="${p.id}">Deactivate</button>`}`}</td></tr>`).join("")}</table></div>
    <h3>Add someone</h3>
    <div class="form addrow"><label>Rank and name<input id="npName" placeholder="e.g. MU2 Garcia"></label><label>Google email<input id="npEmail" placeholder="name@gmail.com"></label>
      <label>Role<select id="npRole"><option>Member</option><option>Admin</option></select></label><button class="btn primary" id="npAdd">Add</button></div>
    <label class="inline"><input type="checkbox" id="npInv" checked> Email them an invitation with the sign-in link</label></div>
  <div class="panel"><h2>Email the shop</h2>
    <div class="pick" id="mailPick"><button class="pk" data-mt="*" aria-pressed="${active.length && mailTo.size === active.length}">Everyone</button>${active.map(p => `<button class="pk" data-mt="${p.id}" aria-pressed="${mailTo.has(p.id)}">${esc(p.name)}</button>`).join("")}</div>
    <div class="form"><label>Template<select id="mlTpl"><option value="avail">Enter your time for next week</option><option value="watch">Watch bill posted</option><option value="custom">Blank</option></select></label>
      <label>Sent by<input value="${esc(D.me.name)} (through the app owner's Gmail)" readonly></label>
      <label class="full">Subject<input id="mlSubj"></label><label class="full">Message<textarea id="mlBody" style="min-height:150px"></textarea></label></div>
    <div class="row"><span class="why" id="mlCount"></span><button class="btn primary" id="mlSend">Send</button></div>
    ${(st.mailLog || []).length ? `<div><h3 style="margin-bottom:6px">Recently sent</h3><ul class="list">${st.mailLog.slice().reverse().map(m => `<li><span>${esc(m.s)}</span><span class="mono">${m.n} people · ${md(m.t)} · ${esc(m.by || "")}</span></li>`).join("")}</ul></div>` : ""}</div>
  <div class="panel"><div class="row"><h2>Activity</h2><button class="btn small" id="adAudit">Show recent admin activity</button></div></div>`;
  fillTpl(); mlCount();
}
function fillTpl() { const t = TEMPLATES[$("mlTpl").value]; $("mlSubj").value = t.s; $("mlBody").value = t.b.replace("{from}", D.me.name).replace("{url}", D.settings.appUrl || ""); }
function mlCount() { $("mlCount").textContent = mailTo.size ? `${mailTo.size} recipient${mailTo.size > 1 ? "s" : ""}` : "Pick recipients above"; }
async function updPerson(id, fields, msg) { const r = await act(() => API.call("person.update", Object.assign({ id }, fields)), msg); if (r) Object.assign(person(id), r); await loadWeek(); }
$("s-admin").addEventListener("change", e => {
  const t = e.target, d = t.dataset;
  if (t.id === "mlTpl") fillTpl();
  if (d.pf) { const v = t.type === "checkbox" ? t.checked : t.value; updPerson(d.pid, { [d.pf]: v }, "Saved"); }
});
$("s-admin").addEventListener("click", async e => {
  const t = e.target, d = t.dataset;
  if (t.id === "adActSave") { await act(() => API.call("settings.save", { manager: $("adMgr").value, acting: { pid: $("adActWho").value, from: $("adActFrom").value, to: $("adActTo").value } }), "Saved"); await loadWeek(); }
  if (t.id === "adActClear") { await act(() => API.call("settings.save", { acting: { pid: "", from: "", to: "" } }), "Acting manager ended"); await loadWeek(); }
  if (t.id === "adCalSave") { await act(() => API.call("settings.save", { calName: $("adCalName").value, calId: $("adCalId").value.trim(), invites: $("adInv").checked, remind: $("adRem").value, appUrl: $("adUrl").value.trim() }), "Calendar settings saved"); await loadWeek(); }
  if (t.id === "adTest") { const r = await act(() => API.call("admin.test")); if (r) $("adTestOut").innerHTML = r.demo ? "Demo mode: no Google Sheet is connected." : `App owner: <b>${esc(r.owner)}</b><br>Sheet: <b>${esc(r.sheet)}</b><br>Calendar: ${r.calendar ? `<b>${esc(r.calendar)}</b>` : `<span style="color:var(--warn)">${esc(r.calendarError)}</span>`}<br>Emails left today: ${r.mailLeft} · Time zone: ${esc(r.timeZone)}`; }
  if (t.id === "adMove") { const v = $("adSheet").value.trim(); if (!v) { toast("Paste the Sheet URL or ID", "err"); return; } const r = await act(() => API.call("admin.dataSource", { sheet: v })); if (r) { toast(r.moved ? `Data copied to ${r.name}` : `Now using ${r.name}`); await loadWeek(); } }
  if (t.id === "npAdd") {
    const email = $("npEmail").value.trim(); if (!email) { $("npEmail").focus(); toast("Enter their Google email", "err"); return; }
    const r = await act(() => API.call("person.add", { email, name: $("npName").value, role: $("npRole").value, invite: $("npInv").checked }), p => `${p.name} added${$("npInv") && $("npInv").checked ? " and invited" : ""}`);
    if (r) await loadWeek();
  }
  if (d.pinv) await act(() => API.call("person.invite", { id: d.pinv }), "Invitation sent");
  if (d.pa) await updPerson(d.pid, { active: d.pa === "on" }, d.pa === "on" ? "Reactivated" : "Deactivated. They can no longer sign in.");
  if (d.mt) {
    const active = D.people.filter(p => p.active !== false);
    if (d.mt === "*") mailTo = mailTo.size === active.length ? new Set() : new Set(active.map(p => p.id)); else mailTo.has(d.mt) ? mailTo.delete(d.mt) : mailTo.add(d.mt);
    $("mailPick").querySelectorAll(".pk").forEach(b => b.setAttribute("aria-pressed", b.dataset.mt === "*" ? mailTo.size === active.length : mailTo.has(b.dataset.mt))); mlCount();
  }
  if (t.id === "mlSend") {
    if (!mailTo.size) { toast("Pick recipients first", "err"); return; }
    const r = await act(() => API.call("mail.send", { pids: [...mailTo], subject: $("mlSubj").value, body: $("mlBody").value }), r => `Sent to ${r.sent}${DEMO ? " (demo, no email went out)" : ""}`);
    if (r) { mailTo = new Set(); await loadWeek(); }
  }
  if (t.id === "adAudit") { const r = await act(() => API.call("audit.list")); if (r) openModal("Recent admin activity", "", r.length ? `<ul class="list">${r.map(x => `<li><div class="item"><b>${esc(x.action)}</b><span class="why">${esc(x.detail)}</span></div><span class="mono">${esc(x.who)} · ${esc(String(x.t).slice(0, 16).replace("T", " "))}</span></li>`).join("")}</ul>` : "<div class='empty'>Nothing yet.</div>", `<span></span><button class="btn" data-act="cancel">Close</button>`); }
});

/* ---------- demo controls ---------- */
$("demoMember").onclick = () => { Demo.as = "member"; tab = null; loadWeek(); };
$("demoAdmin").onclick = () => { Demo.as = "admin"; tab = null; loadWeek(); };
$("demoReset").onclick = () => { Demo.st = seed(); Demo.save(); tab = null; report = null; loadWeek().then(() => toast("Demo data reset")); };

/* ---------- start ---------- */
if (DEMO) boot(); else startAuth();
})();

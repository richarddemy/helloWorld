// =====================================================================
// HOW TO READ THIS FILE (for non-programmers)
// =====================================================================
// Lines that start with two slashes are notes for people. The browser
// ignores them. Everything else is instructions.
//
// This is the FRONT END: everything you see and click. It runs in each
// person's browser and never touches Google Sheets itself. It sends each
// request to the backend (backend/Code.gs) and shows the answer. In demo
// mode a pretend backend in this browser answers instead.
//
//   $("name")    finds the item on the page with that id
//   D            everything loaded for the week on screen
//   toast(...)   shows a short message at the bottom of the screen
//   act(...)     runs a request and shows a message if it fails
// =====================================================================
(function () {
"use strict";
const CFG = window.BW_CONFIG || {};
const qs = new URLSearchParams(location.search);
// Demo mode: no backend connected yet, or ?demo in the address.
const DEMO = !CFG.SCRIPT_URL || qs.has("demo");

// The time grid, shared with the rule book.
const GRID = Core.grid(), NS = GRID.ns, START = GRID.start;
const SLOTS = Array.from({ length: NS }, (_, i) => START + i * 30), ZERO = "0".repeat(NS);

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = m => String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const dayLbl = s => { const d = parse(s); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate(); };
// The Monday to open on. On a weekend the work week just ended, so go to the next one.
const openingMonday = d => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()), wd = x.getDay();
  x.setDate(x.getDate() + (wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd));
  return iso(x);
};
const endLbl = e => { const m = START + e * 30; return m >= 1440 ? "2400" : fmt(m); };
const span = x => fmt(START + x.s * 30) + "-" + endLbl(x.e);

let weekStart = openingMonday(new Date());
const week = () => [0, 1, 2, 3, 4].map(i => addDays(weekStart, i));
// D the week's data, tab the tab showing, myDays my hours while I edit them,
// dirty true when I changed hours but have not submitted, sel the selected
// watch window, calendars the list of Google calendars for the Calendar tab.
let D = null, tab = null, myDays = {}, dirty = false, sel = null, calendars = null;
let extended = false;
try { extended = localStorage.getItem("bws-extended") === "1"; } catch (e) {}

// ---------- small helpers ----------
function toast(t, kind) {
  const e = $("toast"); e.textContent = t; e.className = "toast" + (kind === "err" ? " err" : ""); e.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, kind === "err" ? 7000 : 3500);
}
let pending = 0;
function busyOn() { pending++; $("progress").hidden = false; }
function busyOff() { pending = Math.max(0, pending - 1); if (!pending) $("progress").hidden = true; }
async function act(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(typeof ok === "function" ? ok(r) : ok);
    return r === undefined ? true : r;
  } catch (e) {
    if (e.code === "auth") { signOut(e.message); return null; }
    toast(e.message || "Something went wrong.", "err");
    return null;
  }
}
function copy(text, msg) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg || "Copied"), () => toast("Press and hold the text to copy it.", "err"));
}
const appLink = () => location.origin + location.pathname;

// ---------------------------------------------------------------------
// TALKING TO THE BACKEND
// ---------------------------------------------------------------------
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
      if (e instanceof TypeError) throw new Error("Can't reach the server. Check your connection.");
      throw e;
    } finally { busyOff(); }
  }
};

// ---------------------------------------------------------------------
// DEMO MODE: the same rule book on sample data kept in this browser.
// ---------------------------------------------------------------------
const Demo = {
  key: "bws-demo-v1", as: qs.get("as") === "member" ? "member" : "admin", st: null,
  emails: { admin: "hayes@demo.invalid", member: "baker@demo.invalid" },
  load() { try { const t = localStorage.getItem(this.key); if (t) { this.st = JSON.parse(t); return; } } catch (e) {} this.st = seed(); },
  save() { try { const s = Object.assign({}, this.st); delete s._dirty; delete s._warn; localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) {} },
  reset() { try { localStorage.removeItem(this.key); } catch (e) {} this.st = null; },
  async call(action, payload) {
    if (!this.st) this.load();
    await new Promise(r => setTimeout(r, 80));
    const st = this.st, me = Core.findEmail(st, this.emails[this.as]);
    const needAdmin = () => { if (!Core.isAdmin(me)) throw new Error("Only admins can do that."); };
    if (action === "admin.calendars") { needAdmin(); return st.settings.demoCals; }
    if (action === "admin.calendar.create") {
      needAdmin(); const c = { id: "cal-" + Core.uid(), name: payload.name || "Building Watch", primary: false, owned: true };
      st.settings.demoCals.push(c); this.save(); return c;
    }
    if (action === "admin.publish") {
      needAdmin();
      if (!st.settings.calId) throw new Error("Choose a calendar on the Calendar tab first.");
      const list = Core.drafts(st, DH.today()); list.forEach(w => { w.ev = "demo-" + w.id; });
      this.save(); return { created: list.length, failed: 0, left: 0, calendar: st.settings.calName };
    }
    st._dirty = {}; st._warn = [];
    const r = Core.handle(st, this.emails[this.as], action, JSON.parse(JSON.stringify(payload)), DH);
    this.save(); st._warn.forEach(w => toast(w, "err"));
    return JSON.parse(JSON.stringify(r));
  }
};
const DH = {
  today: () => iso(new Date()), nowISO: () => new Date().toISOString(), eventDelete: () => {},
  testCal: (st, id) => { const c = st.settings.demoCals.find(x => x.id === id); if (!c) throw new Error("Choose a calendar."); return c.name; }
};
// seed: a sample crew and a part-finished week, with fictional names only.
function seed() {
  const now = new Date().toISOString();
  const crew = [["Senior Chief Hayes", "hayes", "Admin", false], ["MU1 Baker", "baker"], ["MU1 Chen", "chen"], ["MU2 Diaz", "diaz"], ["MU2 Evans", "evans"], ["MU2 Flynn", "flynn"], ["MU3 Grant", "grant"]];
  const st = Core.ensure({ settings: { calId: "bw", calName: "Building Watch", invites: true, remind: 30, demoCals: [{ id: "bw", name: "Building Watch", primary: false, owned: true }, { id: "me", name: "Demo account main calendar", primary: true, owned: true }] } });
  st.people = crew.map(([name, u, role, watch]) => {
    const p = Core.newPerson(u + "@demo.invalid", name, role || "Member", now);
    p.joinedAt = now; p.watch = watch !== false; return p;
  });
  const id = u => Core.findEmail(st, u + "@demo.invalid").id;
  const mon = openingMonday(new Date());
  // Hours in the building for each sample sailor, as [from slot, to slot] per weekday.
  const hours = { chen: [[[0, 17]], [[0, 11]], [[0, 17]], [[4, 17]], [[0, 9]]], diaz: [[[1, 13]], [[1, 13]], [], [[1, 13]], [[1, 13]]],
    evans: [[[5, 17]], [[5, 17]], [[5, 17]], [[5, 17]], [[5, 17]]], flynn: [[[1, 17]], [[1, 7]], [[1, 17]], [[9, 17]], [[1, 17]]] };
  Object.keys(hours).forEach(u => hours[u].forEach((runs, d) => {
    const a = ZERO.split(""); runs.forEach(([s, e]) => { for (let i = s; i < e; i++) a[i] = "1"; });
    st.avail.push({ pid: id(u), date: addDays(mon, d), slots: a.join(""), at: now });
  }));
  [["chen", 0, 1, 5, 1], ["evans", 0, 13, 17, 1], ["flynn", 2, 1, 5, 0]].forEach(([u, d, s, e, live]) => {
    const w = { id: Core.uid(), pid: id(u), date: addDays(mon, d), s, e, ev: "" }; if (live) w.ev = "demo-" + w.id; st.watches.push(w);
  });
  // Last week's hours for the sailor view, so "Same as last week" has something to copy.
  for (let d = 0; d < 5; d++) st.avail.push({ pid: id("baker"), date: addDays(mon, d - 7), slots: "0" + "1".repeat(16) + "0".repeat(NS - 17), at: now });
  return st;
}

// ---------------------------------------------------------------------
// SIGN-IN
// ---------------------------------------------------------------------
function gate(html) { $("app").hidden = true; $("gate").hidden = false; $("gateBody").innerHTML = `<h1 class="mark">Building Watch</h1>` + html; }
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
  try { const t = sessionStorage.getItem("bws-token"); if (t && jwt(t).exp * 1000 > Date.now() + 60000) { TOKEN = t; return afterToken(); } } catch (e) {}
  const hint = qs.get("invite") || "";
  gate(`${msg ? `<p class="chip warn" style="white-space:normal">${esc(msg)}</p>` : ""}
    <p>Sign in with the Google account your manager approved${hint ? `: <b>${esc(hint)}</b>` : ""}.</p>
    <div id="gbtn" style="min-height:44px"></div>
    <p class="sub">The app receives only your verified email address from Google, never your password.</p>`);
  try {
    await loadGIS();
    google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, auto_select: true, login_hint: hint || undefined, cancel_on_tap_outside: false,
      callback: r => { TOKEN = r.credential; try { sessionStorage.setItem("bws-token", TOKEN); } catch (e) {} afterToken(); } });
    google.accounts.id.renderButton($("gbtn"), { theme: "outline", size: "large", text: "signin_with", shape: "rectangular" });
    google.accounts.id.prompt();
  } catch (e) { gate(`<p class="chip warn" style="white-space:normal">${esc(e.message)}</p>`); }
}
async function afterToken() {
  gate(`<p class="sub">Checking your access</p>`);
  try {
    const w = await API.call("whoami");
    if (w.status === "denied") {
      gate(`<p><b>You don't have access yet.</b></p><p>You signed in as <b>${esc(w.email)}</b>. Ask your manager to add this exact address, or sign in with the account they approved.</p><button class="btn" id="swap">Use another account</button>`);
      $("swap").onclick = () => signOut();
      return;
    }
    if (w.status === "profile") return profileGate(w.me);
    boot();
  } catch (e) {
    if (e.code === "auth") return signOut(e.message);
    gate(`<p class="chip warn" style="white-space:normal">${esc(e.message)}</p><button class="btn" id="retry">Try again</button>`); $("retry").onclick = afterToken;
  }
}
function profileGate(me) {
  gate(`<h2>Welcome</h2><p class="sub">You're signed in as <b>${esc(me.email)}</b>.</p>
    <label>Rank and name<input id="pfName" type="text" value="${esc(me.name && me.name !== me.email ? me.name : "")}" placeholder="MU2 Smith"></label>
    <button class="btn primary" id="pfGo">Continue</button>`);
  $("pfGo").onclick = () => act(async () => { await API.call("profile.save", { name: $("pfName").value }); boot(); });
}
function signOut(msg) {
  TOKEN = null; try { sessionStorage.removeItem("bws-token"); } catch (e) {}
  try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) {}
  D = null; calendars = null;
  startAuth(msg);
}

// ---------------------------------------------------------------------
// STARTING UP AND LOADING A WEEK
// ---------------------------------------------------------------------
async function boot() {
  $("gate").hidden = true; $("app").hidden = false;
  $("demoBar").hidden = !DEMO; $("signOut").hidden = DEMO;
  await loadWeek();
}
async function loadWeek() {
  const d = await act(() => API.call("load", { week: week() }));
  if (!d) return;
  D = d;
  myDays = {};
  week().forEach(date => { const a = D.avail.find(x => x.pid === D.me.id && x.date === date); myDays[date] = (a ? a.slots : ZERO).split(""); });
  dirty = false;
  const tabs = tabList().map(x => x[0]);
  if (!tab || !tabs.includes(tab)) tab = D.admin ? "set" : "week";
  render();
}
function tabList() {
  const t = [];
  if (D.admin) t.push(["set", "Set the watch"]);
  t.push(["week", "My week"]);
  if (D.admin) t.push(["people", "People"], ["cal", "Calendar"]);
  return t;
}
const person = id => D.people.find(p => p.id === id);
const pname = id => { const p = person(id); return p ? p.name + (p.active === false ? " (inactive)" : "") : "Unknown"; };
const watchers = () => D.people.filter(p => p.watch && p.active !== false);

function render() {
  const n = D.admin ? D.drafts.length : 0;
  $("tabs").innerHTML = tabList().map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}${k === "set" && n ? `<span class="count" title="Draft watches not published">${n}</span>` : ""}</button>`).join("");
  $("wkLabel").textContent = "Week of " + parse(week()[0]).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  $("weekNav").hidden = tab === "people" || tab === "cal";
  $("meBtn").textContent = D.me.name;
  ["week", "set", "people", "cal"].forEach(k => $("s-" + k).hidden = k !== tab);
  if (DEMO) { $("demoMember").setAttribute("aria-pressed", Demo.as === "member"); $("demoAdmin").setAttribute("aria-pressed", Demo.as === "admin"); }
  ({ week: drawWeek, set: drawSet, people: drawPeople, cal: drawCal })[tab]();
}
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  if (dirty && tab === "week" && b.dataset.tab !== "week") toast("Your hours aren't submitted yet.", "err");
  tab = b.dataset.tab; render();
});
let pendingNav = null;
const leaveWeek = fn => () => {
  if (!dirty) return fn();
  pendingNav = fn;
  openModal("Hours not submitted", "You changed your hours this week but haven't submitted them.", "",
    `<span></span><div class="btns"><button class="btn" data-act="discard">Discard</button><button class="btn primary" data-act="saveThen">Submit my hours</button></div>`);
};
$("wkPrev").onclick = leaveWeek(() => { weekStart = addDays(weekStart, -7); loadWeek(); });
$("wkNext").onclick = leaveWeek(() => { weekStart = addDays(weekStart, 7); loadWeek(); });
$("wkNow").onclick = leaveWeek(() => { weekStart = openingMonday(new Date()); loadWeek(); });
$("signOut").onclick = () => signOut();
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
$("meBtn").onclick = () => openModal("Your name", "This is how you appear on the watch.", `<label>Rank and name<input id="meName" type="text" value="${esc(D.me.name)}"></label>`,
  `<span></span><div class="btns"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="saveName">Save name</button></div>`);
async function saveName() {
  const r = await act(() => API.call("profile.save", { name: $("meName").value }), "Name saved");
  if (r) { closeModal(); await loadWeek(); }
}

// ---------------------------------------------------------------------
// POP-UP BOXES
// ---------------------------------------------------------------------
function openModal(t, sub, body, acts) {
  $("dlgT").textContent = t; $("dlgSub").textContent = sub || ""; $("dlgSub").hidden = !sub;
  $("dlgBody").innerHTML = body; $("dlgBody").hidden = !body; $("dlgAct").innerHTML = acts; $("modal").hidden = false;
  const f = $("dlgBody").querySelector("input:not([type=checkbox])");
  (f || $("dlgAct").querySelector("button") || $("dlgT")).focus();
}
function closeModal() { $("modal").hidden = true; if (sel) { sel = null; if (tab === "set") drawHeat(); } }
$("modal").addEventListener("click", e => { if (e.target.id === "modal" || e.target.dataset.act === "cancel") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
$("dlgAct").addEventListener("click", e => {
  const a = e.target.dataset.act; if (!a || a === "cancel") return;
  ({ saveWatch, publish, saveName,
    discard: () => { closeModal(); dirty = false; const f = pendingNav; pendingNav = null; f && f(); },
    saveThen: async () => { closeModal(); const ok = await saveMyWeek(); const f = pendingNav; pendingNav = null; if (ok && f) f(); } })[a]?.();
});

// ---------------------------------------------------------------------
// DUTY DAY AND EXTENDED HOURS
// The grids show 0730 to 1600. Extended hours shows up to 2400. Time
// already scheduled after 1600 stays visible so nothing hides.
// ---------------------------------------------------------------------
const inDuty = i => i >= GRID.duty[0] && i < GRID.duty[1];
const inView = i => i >= GRID.view[0] && i < GRID.view[1];
const inStd = i => GRID.std.some(([a, b]) => i >= a && i < b);
function lateTime(scope) {
  const wk = week(), mine = scope === "mine";
  return D.watches.some(w => wk.includes(w.date) && (!mine || w.pid === D.me.id) && w.e > GRID.view[1]) ||
    (mine ? Object.values(myDays).some(a => a.some((c, i) => c === "1" && !inView(i)))
          : D.avail.some(a => a.slots.split("").some((c, i) => c === "1" && !inView(i))));
}
const showAll = scope => extended || lateTime(scope);
const viewIdx = scope => SLOTS.map((_, i) => i).filter(i => showAll(scope) || inView(i));
const rowCls = i => (inDuty(i) ? "" : "off") + (inStd(i) ? " std" : "");
function drawHoursUI(scope) {
  const sec = scope === "mine" ? "#s-week" : "#s-set", all = showAll(scope), forced = !extended && lateTime(scope);
  document.querySelectorAll(sec + " [data-hrs]").forEach(b => {
    b.textContent = all ? "Duty day only" : "Extended hours";
    b.disabled = forced; b.title = forced ? "Time is scheduled after 1600 this week, so it stays visible." : "";
  });
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-hrs]"); if (!b) return;
  extended = !extended; try { localStorage.setItem("bws-extended", extended ? "1" : "0"); } catch (err) {}
  if (tab === "week") drawPaint(); if (tab === "set") drawHeat();
});
const headRow = () => { const t = D.today; return "<tr><th class='t'></th>" + week().map(d => `<th class="${d === t ? "today" : ""}">${dayLbl(d)}</th>`).join("") + "</tr>"; };

// ---------------------------------------------------------------------
// MY WEEK
// ---------------------------------------------------------------------
const mineAt = (date, i) => myDays[date] && myDays[date][i] === "1";
function drawPaint() {
  let html = headRow();
  viewIdx("mine").forEach(i => {
    const m = SLOTS[i];
    html += `<tr class="${rowCls(i)}"><th class='t'>${m % 60 && i ? "" : fmt(m)}</th>`;
    week().forEach(date => {
      const a = D.watches.some(x => x.pid === D.me.id && x.pub && x.date === date && i >= x.s && i < x.e);
      html += `<td data-k="${date}|${i}" class="${mineAt(date, i) ? "on" : ""} ${a ? "asg" : ""}" aria-label="${dayLbl(date)} ${fmt(m)}"></td>`;
    });
    html += "</tr>";
  });
  $("paintGrid").innerHTML = html;
  drawHoursUI("mine");
  drawSaveState();
}
function drawSaveState() {
  const ats = D.avail.filter(a => a.pid === D.me.id && week().includes(a.date)).map(a => a.at).filter(Boolean).sort();
  const last = ats[ats.length - 1];
  $("saveState").innerHTML = dirty ? `<span class="chip warn">Not submitted</span>` : last ? `<span class="chip ok">Submitted ${esc(dayLbl(iso(new Date(last))))}</span>` : `<span class="chip">Not submitted yet</span>`;
  $("sameLast").disabled = !Object.keys(D.prior || {}).length;
}
function drawWeek() {
  drawPaint();
  const list = D.watches.filter(w => w.pub);
  $("weekBill").innerHTML = list.length ? list.map(w => `<li class="${w.pid === D.me.id ? "mine" : ""}"><span>${dayLbl(w.date)}, ${span(w)}</span><span>${esc(pname(w.pid))}</span></li>`).join("") : "<li class='empty'>The watch for this week isn't published yet.</li>";
}
// Marking time: drag down a day to add, drag over marked time to erase. On
// phones a sideways swipe scrolls the grid instead.
let painting = null, paintTouch = null; const pg = $("paintGrid");
const cellAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest ? el.closest("#paintGrid td[data-k]") : null; };
let lastPaint = null;
function paintCell(date, i) {
  myDays[date][i] = painting === "add" ? "1" : "0";
  const td = pg.querySelector(`td[data-k="${date}|${i}"]`); if (td) td.classList.toggle("on", painting === "add");
}
// A quick drag can jump several cells between updates from the browser, so
// everything between the last cell and this one in the same day is filled too.
function apply(el) {
  if (!el) return;
  const [date, k] = el.dataset.k.split("|"), i = +k;
  const from = lastPaint && lastPaint.date === date ? lastPaint.i : i;
  for (let n = Math.min(from, i); n <= Math.max(from, i); n++) paintCell(date, n);
  lastPaint = { date, i }; dirty = true;
}
function startPaint(el) { const [date, i] = el.dataset.k.split("|"); lastPaint = null; painting = mineAt(date, +i) ? "del" : "add"; apply(el); }
pg.addEventListener("pointerdown", e => {
  const el = cellAt(e); if (!el || (e.pointerType === "mouse" && e.button !== 0)) return;
  if (e.pointerType === "touch") {
    if (paintTouch) { paintTouch = null; painting = null; return; }
    paintTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, el, mode: "pending" };
    return;
  }
  e.preventDefault(); pg.setPointerCapture(e.pointerId); startPaint(el);
});
pg.addEventListener("pointermove", e => {
  if (paintTouch && e.pointerId === paintTouch.id) {
    const t = paintTouch, dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (t.mode === "pending" && Math.hypot(dx, dy) > 9) {
      if (Math.abs(dx) > Math.abs(dy)) { t.mode = "scroll"; return; }
      t.mode = "paint"; startPaint(t.el);
    }
    if (t.mode === "paint") apply(cellAt(e));
    return;
  }
  if (painting) apply(cellAt(e));
});
pg.addEventListener("pointerup", e => {
  if (paintTouch && e.pointerId === paintTouch.id) {
    if (paintTouch.mode === "pending") startPaint(paintTouch.el);
    paintTouch = null;
  }
  if (painting) { painting = null; drawPaint(); }
});
pg.addEventListener("pointercancel", () => { paintTouch = null; if (painting) { painting = null; drawPaint(); } });
// Clear and copy act only on the hours on screen, so hidden evening time is never wiped by surprise.
$("clearMe").onclick = () => { const v = viewIdx("mine"); week().forEach(d => v.forEach(i => myDays[d][i] = "0")); dirty = true; drawPaint(); };
$("copyMon").onclick = () => { const v = viewIdx("mine"), mon = myDays[week()[0]]; week().slice(1).forEach(d => v.forEach(i => myDays[d][i] = mon[i])); dirty = true; drawPaint(); toast("Monday copied. Submit when ready."); };
$("sameLast").onclick = () => { week().forEach(d => { if (D.prior[d]) myDays[d] = D.prior[d].split(""); else myDays[d] = ZERO.split(""); }); dirty = true; drawPaint(); toast("Last week copied. Submit when ready."); };
async function saveMyWeek() {
  const days = {}; week().forEach(d => days[d] = myDays[d].join(""));
  const r = await act(() => API.call("avail.save", { days }), "Hours submitted");
  if (r) { dirty = false; await loadWeek(); return true; }
  return false;
}
$("saveMe").onclick = saveMyWeek;

// ---------------------------------------------------------------------
// SET THE WATCH (admins)
// ---------------------------------------------------------------------
const slotsOf = (pid, date) => { const a = D.avail.find(x => x.pid === pid && x.date === date); return a ? a.slots : ZERO; };
const whoIn = (date, i) => watchers().filter(p => slotsOf(p.id, date)[i] === "1");
const isPast = date => date < D.today;
const coversAll = (pid, date, s, e) => { const a = slotsOf(pid, date); for (let i = s; i < e; i++) if (a[i] !== "1") return false; return true; };

function drawStatus() {
  const wk = week(), people = watchers();
  const missing = people.filter(p => !D.avail.some(a => a.pid === p.id && wk.includes(a.date)));
  const done = people.length - missing.length;
  const mail = missing.filter(p => p.email).map(p => p.email).join(",");
  const body = encodeURIComponent(`Please submit your hours for the week of ${dayLbl(wk[0])}: ${appLink()}`);
  $("subStatus").innerHTML = `<div><div class="tally">${done} of ${people.length} submitted</div>
      <div class="sub">${missing.length ? "Waiting on " + esc(missing.map(p => p.name).join(", ")) : "Everyone has submitted for this week."}</div></div>
    ${missing.length ? `<a class="btn small" href="mailto:${esc(mail)}?subject=${encodeURIComponent("Building watch: submit your hours")}&body=${body}">Email a reminder</a>` : ""}`;
}
function drawHeat() {
  const wk = week();
  let html = headRow();
  viewIdx("all").forEach(i => {
    const m = SLOTS[i];
    html += `<tr class="${rowCls(i)}"><th class='t'>${m % 60 && i ? "" : fmt(m)}</th>`;
    wk.forEach((date, d) => {
      const c = whoIn(date, i).length, w = D.watches.some(x => x.date === date && i >= x.s && i < x.e);
      const cls = (c === 0 ? "gap" : "l" + Math.min(c, 4)) + (sel && sel.d === d && i >= sel.s && i < sel.e ? " sel" : "") + (w ? " w" : "") + (isPast(date) ? " past" : "");
      html += `<td class="${cls}" data-d="${d}" data-i="${i}" tabindex="0" aria-label="${dayLbl(date)} ${fmt(m)}, ${c} in the building${w ? ", on watch" : ""}">${c}</td>`;
    });
    html += "</tr>";
  });
  $("heatGrid").innerHTML = html;
  drawHoursUI("all");
}
const slotBtn = (d, s, e) => {
  const date = week()[d], list = D.watches.filter(w => w.date === date && w.s === s && w.e === e), past = isPast(date);
  if (!list.length) return `<button class="slot" data-d="${d}" data-s="${s}" data-e="${e}" ${past ? "disabled" : ""}>${past ? "Not set" : "Assign"}</button>`;
  const live = list.every(w => w.pub), gone = list.filter(w => !coversAll(w.pid, date, s, e));
  return `<button class="slot ${live ? "set" : "draft"}" data-d="${d}" data-s="${s}" data-e="${e}" ${past ? "disabled" : ""}>
    <span>${esc(list.map(w => pname(w.pid)).join(", "))}</span>${gone.length ? `<small class="out">${esc(gone.map(w => pname(w.pid)).join(", "))} not in the whole time</small>` : ""}</button>`;
};
function drawBill() {
  const wk = week(), [a, b] = GRID.std;
  const head = w => `${fmt(START + w[0] * 30)} to ${fmt(START + w[1] * 30)}`;
  $("bill").innerHTML = `<tr><th></th><th>${head(a)}</th><th>${head(b)}</th></tr>` +
    wk.map((date, d) => `<tr><th class="${date === D.today ? "today" : ""}">${dayLbl(date)}</th><td>${slotBtn(d, a[0], a[1])}</td><td>${slotBtn(d, b[0], b[1])}</td></tr>`).join("");
  // Watches outside the two usual windows are listed underneath.
  const usual = w => GRID.std.some(x => x[0] === w.s && x[1] === w.e);
  const other = D.watches.filter(w => !usual(w));
  $("otherWatches").innerHTML = other.length ? `<h3>Other watches</h3><ul class="list">${other.map(w => `<li><button class="linkbtn" data-d="${wk.indexOf(w.date)}" data-s="${w.s}" data-e="${w.e}">${dayLbl(w.date)}, ${span(w)}</button><span>${esc(pname(w.pid))}${w.pub ? "" : ` <span class="chip">Draft</span>`}</span></li>`).join("")}</ul>` : "";
  const n = D.drafts.length, here = D.drafts.filter(w => wk.includes(w.date)).length;
  const inactive = D.watches.filter(w => !w.pub && w.date >= D.today && (person(w.pid) || {}).active === false).length;
  $("pubBox").innerHTML = `<button class="btn primary" id="pubBtn" ${n ? "" : "disabled"}>${n ? `Publish ${n} ${n === 1 ? "watch" : "watches"} to Google Calendar` : "Everything is published"}</button>
    <p class="sub">${D.settings.calId ? `Publishing to ${esc(D.settings.calName)}.` : "Choose a calendar on the Calendar tab first."}${n > here ? ` ${n - here} of these ${n - here === 1 ? "is" : "are"} in another week.` : ""}${inactive ? ` ${inactive} draft${inactive === 1 ? "" : "s"} for inactive people won't publish.` : ""}</p>`;
  $("pubBtn").onclick = openPublish;
}
function drawSet() { drawStatus(); drawHeat(); drawBill(); }
$("bill").addEventListener("click", e => pickSlot(e.target.closest("button[data-d]")));
$("otherWatches").addEventListener("click", e => pickSlot(e.target.closest("button[data-d]")));
function pickSlot(b) { if (!b || b.disabled) return; sel = { d: +b.dataset.d, s: +b.dataset.s, e: +b.dataset.e }; if (week()[sel.d] && !isPast(week()[sel.d])) openAssign(); else sel = null; }

// Dragging on the chart selects a stretch of time on one day.
let drag = null, heatTouch = null; const hg = $("heatGrid");
const hcell = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.closest ? el.closest("#heatGrid td") : null; };
function beginHeat(td) {
  const d = +td.dataset.d, i = +td.dataset.i;
  if (isPast(week()[d])) { toast("That date has passed."); return; }
  drag = { d, a: i }; sel = { d, s: i, e: i + 1 }; drawHeat();
}
hg.addEventListener("pointerdown", e => {
  const td = hcell(e); if (!td || (e.pointerType === "mouse" && e.button !== 0)) return;
  if (e.pointerType === "touch") {
    if (heatTouch) { heatTouch = null; drag = null; return; }
    heatTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, td, mode: "pending" };
    return;
  }
  e.preventDefault(); hg.setPointerCapture(e.pointerId); beginHeat(td);
});
hg.addEventListener("pointermove", e => {
  if (heatTouch && e.pointerId === heatTouch.id) {
    const t = heatTouch, dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (t.mode === "pending" && Math.hypot(dx, dy) > 9) {
      if (Math.abs(dx) > Math.abs(dy)) { t.mode = "scroll"; return; }
      t.mode = "select"; beginHeat(t.td);
    }
    if (t.mode !== "select") return;
  }
  if (!drag) return;
  const td = hcell(e); if (!td) return;
  const i = +td.dataset.i, s = Math.min(drag.a, i), en = Math.max(drag.a, i) + 1;
  if (s !== sel.s || en !== sel.e) { sel = { d: drag.d, s, e: en }; drawHeat(); }
});
hg.addEventListener("pointerup", e => {
  if (heatTouch && e.pointerId === heatTouch.id) {
    if (heatTouch.mode === "pending") beginHeat(heatTouch.td);
    heatTouch = null;
  }
  if (drag) { drag = null; openAssign(); }
});
hg.addEventListener("pointercancel", () => { heatTouch = null; drag = null; });
hg.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const td = e.target.closest("td"); if (!td) return;
  const i = +td.dataset.i, d = +td.dataset.d;
  if (isPast(week()[d])) return;
  sel = { d, s: i, e: i + 1 }; drawHeat(); openAssign();
});
// openAssign: choose who stands the selected watch. People in the whole time
// and with fewer watches this month rise to the top.
function openAssign() {
  const { d, s, e } = sel, n = e - s, date = week()[d];
  const onNow = new Set(D.watches.filter(x => x.date === date && x.s < e && x.e > s).map(x => x.pid));
  const rows = watchers().concat(D.people.filter(p => onNow.has(p.id) && !watchers().includes(p))).map(p => {
    let c = 0; for (let i = s; i < e; i++) if (slotsOf(p.id, date)[i] === "1") c++;
    return { p, c, count: D.monthCounts[p.id] || 0, score: (c === n ? 100 : c / n * 40) - (D.monthCounts[p.id] || 0) * 6 + (onNow.has(p.id) ? 200 : 0) };
  }).sort((a, b) => b.score - a.score);
  const pre = new Set(onNow); if (!pre.size && rows.length && rows[0].c === n) pre.add(rows[0].p.id);
  const body = rows.length ? rows.map(r => {
    const status = r.c === n ? `<span class="chip ok">In the whole time</span>` : r.c ? `<span class="chip warn">In ${r.c} of ${n} half hours</span>` : `<span class="chip warn">Not in the building</span>`;
    return `<label class="cand"><input type="checkbox" value="${esc(r.p.id)}" ${pre.has(r.p.id) ? "checked" : ""}><div><b>${esc(pname(r.p.id))}</b><div class="meta">${status}<span class="chip">${r.count} this month</span></div></div></label>`;
  }).join("") : "<div class='empty'>Nobody stands watch yet. Add people on the People tab.</div>";
  openModal(`${dayLbl(date)}, ${span({ s, e })}`, "Check who stands this watch. Uncheck everyone to clear it.", body,
    `<span class="sub" id="wCount"></span><div class="btns"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="saveWatch">Save watch</button></div>`);
  updCount();
}
function updCount() { const k = $("dlgBody").querySelectorAll(".cand input:checked").length; if ($("wCount")) $("wCount").textContent = k ? `${k} on watch` : "Nobody on watch"; }
$("dlgBody").addEventListener("change", updCount);
async function saveWatch() {
  const { d, s, e } = sel, pids = [...$("dlgBody").querySelectorAll(".cand input:checked")].map(i => i.value);
  closeModal();
  await act(() => API.call("watch.save", { date: week()[d], s, e, pids }), pids.length ? "Watch saved as a draft" : "Watch cleared");
  await loadWeek();
}
function openPublish() {
  if (!D.settings.calId) { tab = "cal"; render(); toast("Choose a calendar first.", "err"); return; }
  const list = D.drafts.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.s - b.s);
  openModal("Publish to Google Calendar", `These go on ${D.settings.calName}${D.settings.invites ? ", and each person gets an invitation" : ""}.`,
    `<ul class="list">${list.map(w => `<li><span>${dayLbl(w.date)}, ${span(w)}</span><span>${esc(pname(w.pid))}</span></li>`).join("")}</ul>`,
    `<span></span><div class="btns"><button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="publish">Publish ${list.length}</button></div>`);
}
async function publish() {
  closeModal();
  const r = await act(() => API.call("admin.publish"), x => `Published ${x.created} to ${x.calendar}`);
  if (r) await loadWeek();
}

// ---------------------------------------------------------------------
// PEOPLE (admins)
// ---------------------------------------------------------------------
function drawPeople() {
  const list = D.people.slice().sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name));
  $("peopleTbl").innerHTML = `<tr><th>Name</th><th>Google email</th><th>Access</th><th>Stands watch</th><th>Signed in</th><th></th></tr>` + list.map(p => {
    const on = p.active !== false;
    return `<tr class="${on ? "" : "gone"}" data-id="${esc(p.id)}">
      <td><input type="text" data-f="name" value="${esc(p.name)}" aria-label="Name" ${on ? "" : "disabled"}></td>
      <td style="overflow-wrap:anywhere">${esc(p.email)}</td>
      <td><select data-f="role" aria-label="Access" ${on ? "" : "disabled"}><option value="Member" ${p.role === "Member" ? "selected" : ""}>Sailor</option><option value="Admin" ${p.role === "Admin" ? "selected" : ""}>Admin</option></select></td>
      <td><input type="checkbox" data-f="watch" aria-label="Stands watch" ${p.watch ? "checked" : ""} ${on ? "" : "disabled"}></td>
      <td>${p.joinedAt ? "Yes" : "Not yet"}</td>
      <td><div class="btns" style="flex-wrap:nowrap">${on ? `<button class="btn small" data-do="invite">Invite link</button>${p.id !== D.me.id ? `<button class="btn small" data-do="off">Deactivate</button>` : ""}` : `<button class="btn small" data-do="on">Reactivate</button>`}</div></td></tr>`;
  }).join("");
}
function inviteBox(p) {
  const link = appLink() + "?invite=" + encodeURIComponent(p.email);
  const body = encodeURIComponent(`You've been added to Building Watch. Sign in with this Google account and submit your hours:\n\n${link}`);
  openModal(`Invite ${p.name}`, "Send this link. They sign in with Google using this exact address.",
    `<div class="copyrow"><input id="invLink" type="text" readonly value="${esc(link)}"><button class="btn small" id="invCopy">Copy</button></div>`,
    `<span></span><div class="btns"><button class="btn" data-act="cancel">Close</button><a class="btn primary" href="mailto:${esc(p.email)}?subject=${encodeURIComponent("Building Watch: submit your hours")}&body=${body}">Email the link</a></div>`);
  $("invCopy").onclick = () => copy(link, "Link copied");
}
$("addGo").onclick = async () => {
  const r = await act(() => API.call("person.add", { email: $("addEmail").value, name: $("addName").value, role: $("addRole").value }));
  if (!r) return;
  $("addEmail").value = ""; $("addName").value = ""; $("addRole").value = "Member";
  await loadWeek();
  inviteBox(r);
};
$("peopleTbl").addEventListener("change", async e => {
  const f = e.target.dataset.f, id = e.target.closest("tr").dataset.id; if (!f) return;
  const val = f === "watch" ? e.target.checked : e.target.value;
  await act(() => API.call("person.update", { id, [f]: val }), "Saved");
  await loadWeek();
});
$("peopleTbl").addEventListener("click", async e => {
  const b = e.target.closest("[data-do]"); if (!b) return;
  const id = b.closest("tr").dataset.id, p = person(id);
  if (b.dataset.do === "invite") return inviteBox(p);
  await act(() => API.call("person.update", { id, active: b.dataset.do === "on" }), b.dataset.do === "on" ? "Reactivated" : "Deactivated");
  await loadWeek();
});

// ---------------------------------------------------------------------
// CALENDAR (admins)
// ---------------------------------------------------------------------
async function drawCal() {
  const S = D.settings;
  $("calNow").textContent = S.calId ? `The watch publishes to ${S.calName}.` : "Choose where the watch publishes. A calendar just for the watch keeps events off personal calendars.";
  $("calInv").checked = !!S.invites;
  $("calRem").value = String(S.remind);
  if ($("calRem").value === "") $("calRem").value = "30";
  if (!calendars) { calendars = await act(() => API.call("admin.calendars")); if (!calendars) { calendars = null; return; } }
  drawCalPick(S.calId);
}
function drawCalPick(pick) {
  $("calPick").innerHTML = `<option value="">Choose a calendar</option>` + calendars.map(c => `<option value="${esc(c.id)}" ${c.id === pick ? "selected" : ""}>${esc(c.name)}${c.primary ? " (account's main calendar)" : c.owned ? "" : " (shared)"}</option>`).join("");
}
$("calSave").onclick = async () => {
  const id = $("calPick").value;
  if (!id) return toast("Choose a calendar first.", "err");
  const r = await act(() => API.call("settings.save", { calId: id, invites: $("calInv").checked, remind: +$("calRem").value }), x => `Publishing to ${x.calName}`);
  if (r) await loadWeek();
};
$("calNew").onclick = async () => {
  const c = await act(() => API.call("admin.calendar.create", { name: "Building Watch" }), "Calendar created. Save to use it.");
  if (!c) return;
  calendars = (calendars || []).concat([c]);
  drawCalPick(c.id);
};

// ---------------------------------------------------------------------
// GO
// ---------------------------------------------------------------------
if (DEMO) {
  const flip = as => async () => {
    if (Demo.as === as) return;
    Demo.as = as; dirty = false; tab = null; calendars = null;
    await loadWeek();
  };
  $("demoMember").onclick = flip("member");
  $("demoAdmin").onclick = flip("admin");
  $("demoReset").onclick = async () => { Demo.reset(); dirty = false; calendars = null; await loadWeek(); toast("Demo reset"); };
  boot();
} else {
  startAuth();
}
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();

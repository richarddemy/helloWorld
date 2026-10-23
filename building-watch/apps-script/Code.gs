/*
 * Building Watch API (Google Apps Script backend)
 *
 * Files in this script project:
 *   Code.gs          this file
 *   Core.gs          copy of core.js from the repo (shared app logic)
 *   appsscript.json  manifest (scopes, time zone, Calendar advanced service)
 *
 * One-time setup: fill in SETUP below, then run setup() from the editor.
 * See SETUP.md in the repo for the full walkthrough.
 */

var SETUP = {
  // Senior Chief's Google Sheet (shared with you as Editor). Paste the full URL or just the ID.
  SHEET: "PASTE_SHEET_URL_OR_ID",
  // The main calendar ID (Calendar settings > Integrate calendar). Leave blank to use your own primary calendar.
  CALENDAR: "",
  // OAuth Web client ID from Google Cloud console (ends in .apps.googleusercontent.com).
  CLIENT_ID: "PASTE_CLIENT_ID.apps.googleusercontent.com",
  // Where the app is hosted. Invitation emails link here.
  APP_URL: "https://richarddemy.github.io/helloWorld/building-watch/",
  // Your name as it should appear in the app. You become the first admin.
  FIRST_ADMIN_NAME: "MU1 Demy"
};

/* ------------------------------------------------------------------ */
/* Storage layout: one tab per collection, columns read by header name */
/* Types: s text, n number, b yes/no, j JSON                           */
/* ------------------------------------------------------------------ */
var TABS = {
  people:   { id: "s", email: "s", name: "s", role: "s", watch: "b", active: "b", phone: "s", cals: "j", invitedAt: "s", joinedAt: "s" },
  avail:    { pid: "s", date: "s", slots: "s", ev: "j" },
  watches:  { id: "s", pid: "s", date: "s", s: "n", e: "n", checks: "j", ev: "s" },
  requests: { id: "s", date: "s", by: "s", byId: "s", loc: "s", issue: "s", pri: "s", status: "s", wo: "s" },
  log:      { id: "s", date: "s", worker: "s", shop: "s", req: "s", task: "s", "in": "n", out: "n", done: "s", fu: "s", ret: "s", prob: "s", newReq: "s", by: "s", fuClosed: "b" },
  audit:    { t: "s", who: "s", action: "s", detail: "s" }
};
var TAB_NAMES = { people: "People", avail: "Availability", watches: "Watches", requests: "Requests", log: "Maintenance Log", audit: "Audit", settings: "Settings" };

function props_() { return PropertiesService.getScriptProperties(); }
function tz_() { return Session.getScriptTimeZone() || "America/New_York"; }
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }
function sheetId_(v) {
  v = String(v || "").trim();
  var m = v.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : v;
}
function openSheet_() {
  var id = props_().getProperty("SHEET_ID");
  if (!id) throw err_("setup", "The app isn't connected to a Sheet yet. Run setup() in the script editor.");
  try { return SpreadsheetApp.openById(id); }
  catch (e) { throw err_("sheet", "Can't open the data Sheet. Make sure it is still shared with " + Session.getEffectiveUser().getEmail() + " as Editor."); }
}

function readTab_(ss, key) {
  var sh = ss.getSheetByName(TAB_NAMES[key]);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues();
  var head = vals[0], types = TABS[key], out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    if (row.join("") === "") continue;
    var o = {};
    head.forEach(function (h, c) {
      if (!types.hasOwnProperty(h)) return;
      var v = row[c], ty = types[h];
      if (ty === "n") o[h] = v === "" ? "" : Number(v);
      else if (ty === "b") o[h] = /^(yes|true|y|1)$/i.test(v);
      else if (ty === "j") { try { o[h] = v ? JSON.parse(v) : (h === "checks" ? {} : []); } catch (e) { o[h] = h === "checks" ? {} : []; } }
      else o[h] = v;
    });
    out.push(o);
  }
  return out;
}
function writeTab_(ss, key, rows) {
  var name = TAB_NAMES[key], sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var cols = Object.keys(TABS[key]), types = TABS[key];
  var values = [cols].concat(rows.map(function (r) {
    return cols.map(function (c) {
      var v = r[c], ty = types[c];
      if (ty === "b") return v ? "yes" : "no";
      if (ty === "j") return JSON.stringify(v == null ? (c === "checks" ? {} : []) : v);
      return v == null ? "" : String(v);
    });
  }));
  sh.clearContents();
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), values.length), cols.length).setNumberFormat("@");
  sh.getRange(1, 1, values.length, cols.length).setValues(values);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight("bold");
}
function readSettings_(ss) {
  var sh = ss.getSheetByName(TAB_NAMES.settings), o = {};
  if (!sh || sh.getLastRow() < 2) return o;
  sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    try { o[r[0]] = JSON.parse(r[1]); } catch (e) { o[r[0]] = r[1]; }
  });
  return o;
}
function writeSettings_(ss, s) {
  var sh = ss.getSheetByName(TAB_NAMES.settings) || ss.insertSheet(TAB_NAMES.settings);
  var values = [["key", "value"]].concat(Object.keys(s).map(function (k) { return [k, JSON.stringify(s[k])]; }));
  sh.clearContents();
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), values.length), 2).setNumberFormat("@");
  sh.getRange(1, 1, values.length, 2).setValues(values);
  sh.setFrozenRows(1);
}
function readStore_(ss) {
  var st = {};
  Object.keys(TABS).forEach(function (k) { st[k] = readTab_(ss, k); });
  st.settings = readSettings_(ss);
  return Core.ensure(st);
}
function saveStore_(ss, st, all) {
  Object.keys(TABS).forEach(function (k) { if (all || st._dirty[k]) writeTab_(ss, k, st[k]); });
  if (all || st._dirty.settings) writeSettings_(ss, st.settings);
}

/* ------------------------------------------------------------------ */
/* Sign-in: verify the Google ID token the app sends with each request */
/* ------------------------------------------------------------------ */
function verify_(token) {
  if (!token) throw err_("auth", "Please sign in.");
  var cache = CacheService.getScriptCache();
  var key = "t" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return hit;
  var r = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw err_("auth", "Your sign-in expired. Please sign in again.");
  var j = JSON.parse(r.getContentText());
  var cid = props_().getProperty("CLIENT_ID");
  if (!cid || j.aud !== cid) throw err_("auth", "Sign-in is not set up for this app.");
  if (!(j.email_verified === true || j.email_verified === "true")) throw err_("auth", "Your Google email isn't verified.");
  if (!/accounts\.google\.com$/.test(String(j.iss))) throw err_("auth", "Unexpected sign-in issuer.");
  var left = Math.floor(+j.exp - Date.now() / 1000);
  if (left <= 0) throw err_("auth", "Your sign-in expired. Please sign in again.");
  var email = String(j.email).toLowerCase();
  cache.put(key, email, Math.min(600, left));
  return email;
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                               */
/* ------------------------------------------------------------------ */
function doGet() {
  return ContentService.createTextOutput("Building Watch API is running. Open the app to use it.");
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var email = verify_(req.token);
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      var ss = openSheet_();
      var st = readStore_(ss);
      st._dirty = {}; st._warn = [];
      var data;
      if (req.action === "admin.dataSource") data = dataSource_(st, email, req.payload || {});
      else if (req.action === "admin.test") data = testConnection_(st, email, ss);
      else { data = Core.handle(st, email, req.action, req.payload || {}, H); saveStore_(ss, st); }
      out = { ok: true, data: data, warn: st._warn };
    } finally { lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), code: (err && err.code) || "" };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function requireAdmin_(st, email) {
  var me = Core.findEmail(st, email);
  if (!Core.isAdmin(st, me, H.today())) throw err_("forbidden", "Only admins can do that.");
  return me;
}

function dataSource_(st, email, P) {
  var me = requireAdmin_(st, email);
  var id = sheetId_(P.sheet);
  if (!id) throw err_("input", "Paste the Sheet URL or ID.");
  var ss2;
  try { ss2 = SpreadsheetApp.openById(id); }
  catch (e) { throw err_("sheet", "Can't open that Sheet. Share it with " + Session.getEffectiveUser().getEmail() + " as Editor, then try again."); }
  var other = readStore_(ss2), moved = false;
  if (!other.people.length) {
    st.audit.push({ t: H.nowISO(), who: Core.nm(me), action: "data.move", detail: "Moved data to " + ss2.getName() });
    saveStore_(ss2, st, true);
    moved = true;
  } else if (!Core.isAdmin(other, Core.findEmail(other, email), H.today())) {
    throw err_("sheet", "That Sheet already holds Building Watch data and you aren't an admin in it.");
  }
  props_().setProperty("SHEET_ID", id);
  return { name: ss2.getName(), url: ss2.getUrl(), moved: moved };
}

function testConnection_(st, email, ss) {
  requireAdmin_(st, email);
  var cal = null, calErr = "";
  try { cal = st.settings.calId ? CalendarApp.getCalendarById(st.settings.calId) : CalendarApp.getDefaultCalendar(); } catch (e) { calErr = e.message; }
  return {
    owner: Session.getEffectiveUser().getEmail(),
    sheet: ss.getName(), sheetUrl: ss.getUrl(),
    calendar: cal ? cal.getName() : "", calendarError: cal ? "" : (calErr || "Calendar not found or not shared with the app owner."),
    mailLeft: MailApp.getRemainingDailyQuota(),
    timeZone: tz_()
  };
}

/* ------------------------------------------------------------------ */
/* Hooks used by Core: calendar, mail, time                           */
/* ------------------------------------------------------------------ */
var calCache_ = {};
function mainCal_(st) {
  var id = st.settings.calId || "primary";
  if (calCache_.hasOwnProperty(id)) return calCache_[id];
  var c = null;
  try { c = id === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id); } catch (e) {}
  if (!c) st._warn.push("Couldn't open the main calendar. Check the Calendar ID in Admin and that it's shared with the app owner.");
  calCache_[id] = c;
  return c;
}
function at_(date, slot) {
  var p = date.split("-"), m = Core.START + slot * 30;
  return new Date(+p[0], +p[1] - 1, +p[2], Math.floor(m / 60), m % 60);
}
function delEv_(st, cal, id) {
  if (!id) return;
  try { var ev = cal.getEventById(id); if (ev) ev.deleteEvent(); } catch (e) { st._warn.push("Couldn't remove an old calendar event."); }
}
function watchDesc_(st) {
  return "Building watch duties:\n" + st.settings.tmpl.map(function (t) { return "- " + t; }).join("\n") +
    (st.settings.appUrl ? "\n\nCheck them off in Building Watch: " + st.settings.appUrl : "");
}

var H = {
  today: function () { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"); },
  nowMin: function () { var s = Utilities.formatDate(new Date(), tz_(), "HH:mm").split(":"); return +s[0] * 60 + +s[1]; },
  nowISO: function () { return new Date().toISOString(); },

  syncAvail: function (st, p, date, slots, oldIds) {
    var cal = mainCal_(st);
    if (!cal) return [];
    (oldIds || []).forEach(function (id) { delEv_(st, cal, id); });
    var ids = [];
    Core.runs(slots).forEach(function (r) {
      try { ids.push(cal.createEvent("In bldg: " + Core.nm(p), at_(date, r[0]), at_(date, r[1])).getId()); }
      catch (e) { st._warn.push("Calendar: " + e.message); }
    });
    return ids;
  },
  watchCreate: function (st, p, w) {
    var cal = mainCal_(st);
    if (!cal || !p) return "";
    try {
      var invite = !!(st.settings.invites && p.email);
      var opts = { description: watchDesc_(st), sendInvites: invite };
      if (invite) opts.guests = p.email;
      var ev = cal.createEvent("Building watch: " + Core.nm(p), at_(w.date, +w.s), at_(w.date, +w.e), opts);
      ev.removeAllReminders();
      if (+st.settings.remind > 0) ev.addPopupReminder(+st.settings.remind);
      return ev.getId();
    } catch (e) { st._warn.push("Calendar: " + e.message); return ""; }
  },
  eventDelete: function (st, id) { var cal = mainCal_(st); if (cal) delEv_(st, cal, id); },

  shareCal: function (st, email, on) {
    var id = st.settings.calId;
    if (!id || !email) return;
    try {
      if (on) Calendar.Acl.insert({ role: "reader", scope: { type: "user", value: email } }, id, { sendNotifications: false });
      else Calendar.Acl.remove(id, "user:" + email);
    } catch (e) {
      if (!/already|duplicate|not found|notFound/i.test(String(e.message)))
        st._warn.push("Couldn't change calendar sharing for " + email + ". Share the calendar by hand.");
    }
  },
  testCal: function (st, id) {
    var c = null;
    try { c = CalendarApp.getCalendarById(id); } catch (e) {}
    if (!c) throw err_("calendar", "Can't open that calendar. Have its owner share it with " + Session.getEffectiveUser().getEmail() + " (Make changes and manage sharing).");
    return c.getName();
  },

  sendInvite: function (st, p, fromName) {
    var url = st.settings.appUrl ? st.settings.appUrl + (st.settings.appUrl.indexOf("?") < 0 ? "?" : "&") + "invite=" + encodeURIComponent(p.email) : "(ask your admin for the link)";
    try {
      MailApp.sendEmail({
        to: p.email, name: "Building Watch",
        subject: "You're invited to Building Watch",
        body: "Hello" + (p.name ? " " + p.name : "") + ",\n\n" + fromName + " added you to Building Watch, the facilities schedule and maintenance log.\n\n" +
          "1. Open: " + url + "\n2. Sign in with Google using this address: " + p.email + "\n3. Fill in your name and phone, then paint the times you'll be in the building.\n\n" +
          "If this address isn't a Google account, create one free at https://accounts.google.com/signup using \"Use my current email address instead\".\n\nV/r,\n" + fromName
      });
    } catch (e) { st._warn.push("Couldn't email " + p.email + ": " + e.message); }
  },
  sendMail: function (st, emails, subject, body, fromName) {
    var left = MailApp.getRemainingDailyQuota();
    if (left < emails.length) throw err_("quota", "Daily email limit reached (" + left + " left today). Try again tomorrow.");
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), bcc: emails.join(","), subject: subject, body: body, name: "Building Watch (" + fromName + ")" });
    return emails.length;
  },

  fetchBusy: function (st, cals, week) { return fetchBusy_(st, cals, week); }
};

/* ------------------------------------------------------------------ */
/* Reading sailors' own calendars (busy overlay, titles to owner only) */
/* ------------------------------------------------------------------ */
var WIN_TZ = { "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver", "Pacific Standard Time": "America/Los_Angeles", "UTC": "UTC" };

function fetchBusy_(st, cals, week) {
  var out = [];
  var add = function (start, end, title) {
    week.forEach(function (date) {
      var ds = at_(date, 0).getTime(), de = at_(date, Core.NS).getTime();
      var a = Math.max(start.getTime(), ds), b = Math.min(end.getTime(), de);
      if (b <= a) return;
      var s = Math.floor((a - ds) / 1800000), e = Math.ceil((b - ds) / 1800000);
      if (e > s) out.push({ date: date, s: s, e: Math.min(e, Core.NS), t: String(title || "Busy").slice(0, 60) });
    });
  };
  cals.forEach(function (c) {
    try {
      var u = String(c.url).trim();
      if (/^(https?|webcal):/i.test(u)) {
        var res = UrlFetchApp.fetch(u.replace(/^webcal:/i, "https:"), { muteHttpExceptions: true, followRedirects: true });
        if (res.getResponseCode() !== 200) { st._warn.push("Couldn't read " + c.label + " (link returned " + res.getResponseCode() + ")."); return; }
        icsEvents_(res.getContentText(), week).forEach(function (ev) { add(ev.start, ev.end, ev.title); });
      } else {
        var cal = CalendarApp.getCalendarById(u);
        if (!cal) { st._warn.push("Couldn't read " + c.label + ". Use its secret iCal address instead."); return; }
        cal.getEvents(at_(week[0], 0), at_(week[week.length - 1], Core.NS)).forEach(function (ev) {
          add(ev.getStartTime(), ev.getEndTime(), ev.getTitle());
        });
      }
    } catch (e) { st._warn.push("Couldn't read " + c.label + "."); }
  });
  return out;
}

function icsWall_(y, mo, d, h, mi, s, tz) {
  tz = WIN_TZ[tz] || tz;
  var guess = new Date(Date.UTC(y, mo, d, h, mi, s));
  try {
    var p = Utilities.formatDate(guess, tz, "yyyy-MM-dd-HH-mm-ss").split("-").map(Number);
    var asUtc = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
    return new Date(guess.getTime() - (asUtc - guess.getTime()));
  } catch (e) { return new Date(y, mo, d, h, mi, s); }
}
function icsDate_(prop) {
  if (!prop) return null;
  var v = prop.value.trim(), allDay = /VALUE=DATE(;|$)/.test(prop.params) || /^\d{8}$/.test(v);
  var y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
  if (allDay) return { date: new Date(y, mo, d), allDay: true };
  var h = +v.slice(9, 11), mi = +v.slice(11, 13), s = +v.slice(13, 15) || 0;
  if (/Z$/.test(v)) return { date: new Date(Date.UTC(y, mo, d, h, mi, s)) };
  var tzm = prop.params.match(/TZID="?([^;:"]+)"?/);
  if (tzm) return { date: icsWall_(y, mo, d, h, mi, s, tzm[1]) };
  return { date: new Date(y, mo, d, h, mi, s) };
}
function icsEvents_(txt, week) {
  var lines = txt.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  var events = [], cur = null;
  lines.forEach(function (line) {
    if (line === "BEGIN:VEVENT") { cur = {}; return; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; return; }
    if (!cur) return;
    var m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) return;
    var key = m[1];
    if (key === "EXDATE") { (cur.EXDATE = cur.EXDATE || []).push({ params: m[2], value: m[3] }); return; }
    cur[key] = { params: m[2], value: m[3] };
  });
  var out = [];
  var weekStart = at_(week[0], 0), weekEnd = at_(week[week.length - 1], Core.NS);
  var DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  events.forEach(function (ev) {
    if (ev.STATUS && /CANCELLED/i.test(ev.STATUS.value)) return;
    if (ev["RECURRENCE-ID"]) { // a moved single occurrence: treat as a normal event
      delete ev.RRULE;
    }
    var st = icsDate_(ev.DTSTART); if (!st) return;
    var en = icsDate_(ev.DTEND);
    var dur = en ? en.date.getTime() - st.date.getTime() : (st.allDay ? 86400000 : 3600000);
    var title = ev.SUMMARY ? ev.SUMMARY.value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ") : "Busy";
    if (st.allDay) title = "All day: " + title;
    var ex = (ev.EXDATE || []).map(function (x) { return x.value.split(",").map(function (v) { return v.slice(0, 8); }); })
      .reduce(function (a, b) { return a.concat(b); }, []);
    if (!ev.RRULE) {
      if (st.date < weekEnd && st.date.getTime() + dur > weekStart.getTime()) out.push({ start: st.date, end: new Date(st.date.getTime() + dur), title: title });
      return;
    }
    var rule = {};
    ev.RRULE.value.split(";").forEach(function (kv) { var p = kv.split("="); rule[p[0]] = p[1]; });
    if (rule.FREQ !== "WEEKLY" && rule.FREQ !== "DAILY") return;
    var interval = +rule.INTERVAL || 1;
    var until = rule.UNTIL ? icsDate_({ params: "", value: rule.UNTIL }).date : null;
    var byday = rule.BYDAY ? rule.BYDAY.split(",").map(function (x) { return x.replace(/^[+-]?\d+/, ""); }) : [DAYS[st.date.getDay()]];
    var sd = new Date(st.date.getFullYear(), st.date.getMonth(), st.date.getDate());
    week.forEach(function (date) {
      var p = date.split("-"), day = new Date(+p[0], +p[1] - 1, +p[2]);
      if (day < sd) return;
      var diffDays = Math.round((day - sd) / 86400000);
      if (rule.FREQ === "DAILY" && diffDays % interval) return;
      if (rule.FREQ === "WEEKLY") {
        if (byday.indexOf(DAYS[day.getDay()]) < 0) return;
        var w0 = new Date(sd); w0.setDate(sd.getDate() - sd.getDay());
        var w1 = new Date(day); w1.setDate(day.getDate() - day.getDay());
        if (Math.round((w1 - w0) / 604800000) % interval) return;
      }
      if (ex.indexOf(date.replace(/-/g, "")) >= 0) return;
      var start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), st.date.getHours(), st.date.getMinutes());
      if (until && start > until) return;
      out.push({ start: start, end: new Date(start.getTime() + dur), title: title });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* One-time setup: run this from the editor after filling in SETUP     */
/* ------------------------------------------------------------------ */
function setup() {
  if (/PASTE/.test(SETUP.SHEET)) throw new Error("Fill in SETUP.SHEET first.");
  if (/PASTE/.test(SETUP.CLIENT_ID)) throw new Error("Fill in SETUP.CLIENT_ID first.");
  var id = sheetId_(SETUP.SHEET);
  var ss = SpreadsheetApp.openById(id);
  props_().setProperty("SHEET_ID", id);
  props_().setProperty("CLIENT_ID", SETUP.CLIENT_ID.trim());

  var st = readStore_(ss);
  st._dirty = {}; st._warn = [];
  if (SETUP.CALENDAR) {
    var c = CalendarApp.getCalendarById(SETUP.CALENDAR.trim());
    if (!c) throw new Error("Can't open calendar " + SETUP.CALENDAR + ". Have its owner share it with you (Make changes and manage sharing).");
    st.settings.calId = SETUP.CALENDAR.trim();
    if (!st.settings.calName || st.settings.calName === "Building Watch") st.settings.calName = c.getName();
  }
  st.settings.appUrl = SETUP.APP_URL;

  var owner = Session.getEffectiveUser().getEmail();
  var me = Core.findEmail(st, owner);
  if (!me) {
    me = Core.newPerson(owner, SETUP.FIRST_ADMIN_NAME, "Admin", H.nowISO());
    me.joinedAt = H.nowISO();
    st.people.push(me);
  } else { me.role = "Admin"; me.active = true; }
  if (!st.settings.manager) st.settings.manager = me.id;
  saveStore_(ss, st, true);

  MailApp.getRemainingDailyQuota();                       // asks for email permission now
  UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true }); // asks for web permission now
  try { Calendar.CalendarList.list({ maxResults: 1 }); } catch (e) { Logger.log("Calendar advanced service not enabled: " + e.message); }

  Logger.log("Setup complete.");
  Logger.log("Data sheet: " + ss.getName() + " " + ss.getUrl());
  Logger.log("Main calendar: " + (st.settings.calId || "your primary calendar"));
  Logger.log("First admin: " + owner);
  Logger.log("Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Copy the web app URL into config.js.");
}

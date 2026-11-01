// =====================================================================
// HOW TO READ THIS FILE (for non-programmers)
// =====================================================================
// Lines that start with two slashes are notes for people. Google ignores
// them. Everything else is instructions.
//
// This is the BACKEND of the Building Watch schedule. It runs on Google's
// computers under the account that deployed it, and it is the only part
// that touches real data:
//   - reads and writes the Google Sheet (people, hours, watches, audit)
//   - creates watch events on Google Calendar when an admin publishes
//
// The web app never touches the Sheet itself. It sends each request here,
// and this file checks who is asking before doing anything. The rules for
// who may do what live in Core.gs. This file is the plumbing around them.
//
// Names ending in an underscore cannot be reached from the web. Only doGet
// and doPost answer the web.
//
// Set-up steps are in SETUP.md in the same GitHub folder.
// =====================================================================

// The fixed settings for this installation. Change them if the app moves.
var SETUP = {
  // The Google sign-in client ID. Public by design, not a password.
  CLIENT_ID: "173552030795-7c7rvjm88ul8is68thpbfj6uhrd89s43.apps.googleusercontent.com",
  // The address of the web app, written on each calendar event.
  APP_URL: "https://richarddemy.github.io/helloWorld/building-watch-schedule/",
  // The building's time zone. All watch times use this, whatever the
  // account's own setting is.
  TIME_ZONE: "America/New_York"
};

// How data is stored. Each list is one tab; row 1 holds the column names.
// The letter after each column says how a cell is read:
//   s = text, n = number, b = yes/no
var TABS = {
  people:  { id: "s", email: "s", name: "s", role: "s", watch: "b", active: "b", invitedAt: "s", joinedAt: "s" },
  avail:   { pid: "s", date: "s", slots: "s", at: "s" },
  watches: { id: "s", pid: "s", date: "s", s: "n", e: "n", ev: "s" },
  audit:   { t: "s", who: "s", action: "s", detail: "s" }
};
var TAB_NAMES = { people: "People", avail: "Hours", watches: "Watches", audit: "Audit", settings: "Settings" };

function props_() { return PropertiesService.getScriptProperties(); }
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }

// ---------------------------------------------------------------------
// READING AND WRITING THE SHEET
// ---------------------------------------------------------------------
var book_ = null;
function book() {
  if (book_) return book_;
  var id = props_().getProperty("SHEET_ID");
  if (!id) throw err_("setup", "Setup isn't finished. Run setup() in the script editor.");
  book_ = SpreadsheetApp.openById(id);
  return book_;
}
// readTab_: reads one tab into records. Columns are found by their heading,
// so their order does not matter. Columns added by hand travel with the row.
function readTab_(key) {
  var sh = book().getSheetByName(TAB_NAMES[key]);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues(), head = vals[0], types = TABS[key], out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    if (row.join("") === "") continue;
    var o = {}, extra = null;
    head.forEach(function (h, c) {
      if (!types.hasOwnProperty(h)) { if (h) { extra = extra || {}; extra[h] = row[c]; } return; }
      var v = row[c], ty = types[h];
      if (ty === "n") o[h] = v === "" ? "" : Number(v);
      else if (ty === "b") o[h] = /^(yes|true|y|1)$/i.test(v);
      else o[h] = v;
    });
    if (extra) o._x = extra;
    out.push(o);
  }
  return out;
}
function rowValues_(key, rows, header) {
  var types = TABS[key];
  return rows.map(function (r) {
    return header.map(function (c) {
      if (!types.hasOwnProperty(c)) return r._x && r._x[c] != null ? String(r._x[c]) : "";
      var v = r[c];
      if (types[c] === "b") return v ? "yes" : "no";
      return v == null ? "" : String(v);
    });
  });
}
function headerFor_(sh, key) {
  var cols = Object.keys(TABS[key]), lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  return cols.concat(existing.filter(function (h) { return h && cols.indexOf(h) < 0; }));
}
// putValues_: overwrites rows in place, then blanks leftovers below, so a
// tab is never empty mid-save. "@" keeps cells as plain text, so Sheets
// never reformats dates, and a name can never run as a formula.
function putValues_(sh, values) {
  var width = values[0].length;
  sh.getRange(1, 1, values.length, width).setNumberFormat("@").setValues(values);
  var last = sh.getLastRow();
  if (last > values.length) sh.getRange(values.length + 1, 1, last - values.length, Math.max(width, sh.getLastColumn())).clearContent();
  if (sh.getFrozenRows() !== 1) sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight("bold");
}
function tabSheet_(name) { return book().getSheetByName(name) || book().insertSheet(name); }
function writeTab_(key, rows) {
  var sh = tabSheet_(TAB_NAMES[key]), header = headerFor_(sh, key);
  putValues_(sh, [header].concat(rowValues_(key, rows, header)));
}
function readSettings_() {
  var sh = book().getSheetByName(TAB_NAMES.settings), o = {};
  if (!sh || sh.getLastRow() < 2) return o;
  sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    try { o[r[0]] = JSON.parse(r[1]); } catch (e) { o[r[0]] = r[1]; }
  });
  return o;
}
function writeSettings_(s) {
  putValues_(tabSheet_(TAB_NAMES.settings), [["key", "value"]].concat(Object.keys(s).map(function (k) { return [k, JSON.stringify(s[k])]; })));
}
function readStore_() {
  var st = {};
  Object.keys(TABS).forEach(function (k) { st[k] = readTab_(k); });
  st.settings = readSettings_();
  return Core.ensure(st);
}
// saveStore_: saves only the lists that changed (or all when "all" is true).
function saveStore_(st, all) {
  Object.keys(TABS).forEach(function (k) { if (all || st._dirty[k]) writeTab_(k, st[k]); });
  if (all || st._dirty.settings) writeSettings_(st.settings);
  st._dirty = {};
}

// ---------------------------------------------------------------------
// SIGN-IN CHECK
// Every request carries a pass issued by Google. This asks Google whether
// it is genuine, unexpired and issued to this app, and returns the verified
// email. A missing or fake pass is refused before anything else happens.
// ---------------------------------------------------------------------
function verify_(token) {
  if (!token) throw err_("auth", "Please sign in.");
  var cache = CacheService.getScriptCache();
  // Remember the answer briefly, keyed by a scrambled fingerprint of the pass.
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

// ---------------------------------------------------------------------
// WEB ENTRY POINTS
// ---------------------------------------------------------------------
// doGet: opening the backend's address in a browser just confirms it is up.
function doGet() {
  return ContentService.createTextOutput("The Building Watch schedule backend is running.");
}
// Requests that only read data. They skip the line, so a load never waits
// behind someone saving.
var READ_ONLY = { whoami: 1, load: 1, "admin.calendars": 1 };

// doPost: everything the app sends comes through here.
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var email = verify_(req.token);
    var lock = null;
    if (!READ_ONLY[req.action]) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) throw err_("busy", "Several people are saving right now. Try again in a moment.");
    }
    try {
      var st = readStore_();
      st._dirty = {}; st._warn = [];
      var data;
      if (req.action === "admin.calendars") data = calendars_(st, email);
      else if (req.action === "admin.calendar.create") data = createCalendar_(st, email, req.payload || {});
      else if (req.action === "admin.publish") data = publish_(st, email);
      else {
        data = Core.handle(st, email, req.action, req.payload || {}, H);
        saveStore_(st);
      }
      out = { ok: true, data: data, warn: st._warn };
    } finally { if (lock) lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), code: (err && err.code) || "" };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// GOOGLE CALENDAR
// ---------------------------------------------------------------------
function requireAdmin_(st, email) {
  var me = Core.findEmail(st, email);
  if (!Core.isAdmin(me)) throw err_("forbidden", "Only admins can do that.");
  return me;
}
// calendars_: the calendars an admin can choose from. Holiday and other
// read-only Google calendars are left out.
function calendars_(st, email) {
  requireAdmin_(st, email);
  return CalendarApp.getAllCalendars().filter(function (c) {
    return !/@group\.v\.calendar\.google\.com$/.test(c.getId());
  }).map(function (c) {
    return { id: c.getId(), name: c.getName(), primary: c.isMyPrimaryCalendar(), owned: c.isOwnedByMe() };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}
// createCalendar_: makes a calendar just for the watch, so events never
// land on anyone's personal calendar by accident.
function createCalendar_(st, email, P) {
  var me = requireAdmin_(st, email);
  var name = String(P.name || "Building Watch").trim().slice(0, 100) || "Building Watch";
  var cal = CalendarApp.createCalendar(name, { timeZone: SETUP.TIME_ZONE });
  Core.audit(st, me, "calendar.create", name, H);
  saveStore_(st);
  return { id: cal.getId(), name: name, primary: false, owned: true };
}
// at_: a date and slot number as an exact moment in the building's time zone.
function at_(date, slot) {
  var m = Core.START + slot * 30;
  // Slot 33 is the end of the 2330 block: midnight, the next day.
  if (m >= 1440) { date = Core.addDays(date, 1); m -= 1440; }
  var hhmm = ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2);
  return Utilities.parseDate(date + " " + hhmm, SETUP.TIME_ZONE, "yyyy-MM-dd HH:mm");
}
function createEvent_(st, cal, person, w) {
  var invite = !!st.settings.invites;
  var opts = { description: "Building watch for " + Core.nm(person) + ".\n\nSchedule: " + SETUP.APP_URL, sendInvites: invite };
  if (invite) opts.guests = person.email;
  var ev = cal.createEvent("Building watch: " + Core.nm(person), at_(w.date, +w.s), at_(w.date, +w.e), opts);
  ev.removeAllReminders();
  if (+st.settings.remind > 0) ev.addPopupReminder(+st.settings.remind);
  return ev.getId();
}
// publish_: puts every draft watch on the chosen calendar. Each event's code
// is recorded as it is made, and the list is saved even if something fails
// partway, so publishing again can never create duplicates.
function publish_(st, email) {
  var me = requireAdmin_(st, email);
  if (!st.settings.calId) throw err_("calendar", "Choose a calendar on the Calendar tab first.");
  var cal = CalendarApp.getCalendarById(st.settings.calId);
  if (!cal) throw err_("calendar", "This account can no longer open the chosen calendar. Choose another on the Calendar tab.");
  var pending = Core.drafts(st, H.today()), created = 0, failed = 0, left = 0, began = Date.now();
  try {
    pending.forEach(function (w) {
      // Google stops a script at six minutes. Stop early and report the rest.
      if (Date.now() - began > 270000) { left++; return; }
      var person = st.people.filter(function (p) { return p.id === w.pid; })[0];
      try {
        w.ev = createEvent_(st, cal, person, w);
        if (!w.ev) throw new Error("Calendar returned no event.");
        created++;
        st._dirty.watches = 1;
      } catch (ex) {
        st._warn.push("Couldn't publish " + w.date + " for " + Core.nm(person) + ": " + ex.message);
        failed++;
      }
      Utilities.sleep(150); // a short pause so Google doesn't throttle the batch
    });
  } finally {
    Core.audit(st, me, "calendar.publish", created + " published, " + failed + " failed, calendar " + cal.getName(), H);
    saveStore_(st);
  }
  if (left) st._warn.push(left + " watches are still waiting. Press Publish again.");
  return { created: created, failed: failed, left: left, calendar: cal.getName() };
}

// H: the helpers Core.gs uses to reach the outside world.
var H = {
  today: function () { return Utilities.formatDate(new Date(), SETUP.TIME_ZONE, "yyyy-MM-dd"); },
  nowISO: function () { return new Date().toISOString(); },
  // Removes a published watch's event, if it still exists.
  eventDelete: function (st, id) {
    if (!id || !st.settings.calId) return;
    try {
      var cal = CalendarApp.getCalendarById(st.settings.calId);
      var ev = cal && cal.getEventById(id);
      if (ev) ev.deleteEvent();
    } catch (e) { st._warn.push("Couldn't remove an old calendar event. Check the calendar by hand."); }
  },
  // Checks a calendar opens before an admin selects it.
  testCal: function (st, id) {
    var c = null;
    try { c = CalendarApp.getCalendarById(id); } catch (e) {}
    if (!c) throw err_("calendar", "This account can't open that calendar.");
    var today = H.today();
    if (st.settings.calId && st.settings.calId !== id && st.watches.some(function (w) { return !!w.ev && w.date >= today; }))
      throw err_("calendar", "Upcoming watches are published on the current calendar. Clear them before switching.");
    return c.getName();
  }
};

// ---------------------------------------------------------------------
// ONE-TIME SET-UP: run this once from the script editor. It is safe to run
// again later; it never removes anything. Whoever runs it becomes the
// first admin.
// ---------------------------------------------------------------------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create("Building Watch Schedule");
  props_().setProperty("SHEET_ID", ss.getId());
  props_().setProperty("CLIENT_ID", SETUP.CLIENT_ID.trim());
  book_ = ss;
  var st = readStore_();
  st._dirty = {}; st._warn = [];
  var owner = Session.getEffectiveUser().getEmail();
  var me = Core.findEmail(st, owner);
  if (!me) { me = Core.newPerson(owner, "", "Admin", H.nowISO()); st.people.push(me); }
  else { me.role = "Admin"; me.active = true; }
  saveStore_(st, true);
  // Remove the blank starter tab a new spreadsheet comes with.
  var blank = ss.getSheetByName("Sheet1");
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  Logger.log("Setup complete. First admin: " + owner);
  Logger.log("Sheet: " + ss.getUrl());
}

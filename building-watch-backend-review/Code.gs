// =====================================================================
// HOW TO READ THIS FILE (for non-programmers)
// =====================================================================
// Lines that start with two slashes, like this one, are notes for people.
// Google ignores them completely. Everything else is instructions.
//
// This file is the BACKEND of Building Watch. It runs inside Google Apps
// Script, on Google's computers, under the account that deployed it.
// It is the only part of the system that can touch the real data:
//   - reads and writes the Google Sheets (people, schedules, the
//     maintenance log, and so on)
//   - sends email (to the watch, to workers, invitations)
//   - posts pings to the Google Chat pager space
//   - shows the worker's "Need help? / Leaving?" page on their phone
//   - creates watch events in Google Calendar when an admin publishes
//
// The web app people use (index.html and app.js, hosted on GitHub Pages)
// never touches the sheets itself. It sends each request here, and this
// file checks who is asking before doing anything.
//
// The rules (who may do what) live in Core.gs, which is shared with the
// web app's demo mode. This file is the "plumbing" around those rules.
//
// Names ending in an underscore, like readTab_, are private helpers that
// cannot be run from the outside; only doGet and doPost answer the web.
// =====================================================================
/*
 * Building Watch API (Google Apps Script backend)
 *
 * 2026-10-29 update (built from the live "Building Watch, Star Trek Test" script):
 *   - Sheet writes overwrite in place: no moment where a tab is empty, and columns
 *     added by hand (with a header) are kept with their rows.
 *   - archiveOld() moves old rows to "Archive: <tab>" tabs; run installArchiveTrigger() once.
 *   - Busy overlay reads secret iCal links only, never calendars by ID.
 *   - Crew assignments are stored (Crew Assignments / Crew Assignment Activity tabs).
 *   - Extended hours: Core.gs grid now runs 0730 to 2400; existing data is padded, not moved.
 *   - watch.alerts: arrivals, departures and assistance requests for people on watch, in the
 *     building, or admins, naming the responder. Cached briefly and read without the write lock.
 *   - Workers can request assistance (location and message) from their personal check-out link.
 *   - Chat pager: assistance requests ping a Google Chat space and @mention the responder.
 *     The ping holds no names or locations, only a button to open Building Watch. Pressing
 *     Responding in the app replies in the same Chat thread. Webhook URL lives in Script Properties.
 *
 * Files in this script project:
 *   Code.gs          this file
 *   Core.gs          copy of core.js from the repo (shared app logic)
 *   appsscript.json  manifest (scopes, time zone, Calendar advanced service)
 *
 * One-time setup: fill in SETUP below, then run setup() from the editor.
 * See SETUP.md in the repo for the full walkthrough.
 */

// ---------------------------------------------------------------------
// SETUP: the fixed settings for this installation.
// Change these only if the spreadsheets or the app's address change, then
// run setup() once from the editor.
// ---------------------------------------------------------------------
var SETUP = {
  // All five live Google Sheets, created in Building Watch — Star Trek Demo.
  // Which Google Sheet file holds each kind of data. The long codes are the
  // ID part of each spreadsheet's web address. An ID alone does not grant
  // access; each sheet is still protected by its own sharing settings.
  SHEETS: {
    avail: "1KJk8VWF2sgV4iMXSXTfp2LCgVg4Ad0aOIEOU8KqIax8",
    people: "14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ",
    watches: "14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ",
    settings: "14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ",
    audit: "14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ",
    log: "12PM8tTBRM3vJs-jb__-Q2_HDboYm_Vs2e86tcERZC8s",
    requests: "1uYn00bp1XhtO-iv5rrjSUKxFBwSwtSO8TAt6e9dU9pM",
    activity: "12BGPkVsYDbgvPJiRAWNVkpKEkCvM8U7An4heEJ1r8QM",
    // New tabs are created inside these existing workbooks on first save.
    crewAssignments: "1uYn00bp1XhtO-iv5rrjSUKxFBwSwtSO8TAt6e9dU9pM",
    crewActivity: "12BGPkVsYDbgvPJiRAWNVkpKEkCvM8U7An4heEJ1r8QM"
  },
  // Create a Web application OAuth client in Google Cloud and paste its client ID.
  // The sign-in "client ID" from Google Cloud. It tells Google which app is
  // asking people to sign in. It is public by design and is not a password.
  CLIENT_ID: "173552030795-7c7rvjm88ul8is68thpbfj6uhrd89s43.apps.googleusercontent.com",
  // The address of the web app, used in emails and in the Chat button.
  APP_URL: "https://richarddemy.github.io/helloWorld/building-watch-trek/",
  // The name given to whoever runs setup() the first time (they become admin).
  FIRST_ADMIN_NAME: "Jean-Luc Picard (demo operator)",
  // Calendar selection + explicit Publish action required. No automatic changes from user availability.
  // PREVIEW_ONLY true would stop the app from removing calendar events.
  PREVIEW_ONLY: false,      // Publishing is possible ONLY after administrator selects a calendar and clicks Publish
  // SEND_TEST_EMAILS false would stop every email this backend sends.
  SEND_TEST_EMAILS: true,  // Real emails to explicitly entered valid addresses only
  APP_URL_OVERRIDE: '',    // Optional GitHub Pages URL after configured
};

/* ------------------------------------------------------------------ */
/* Storage layout: one tab per collection, columns read by header name */
/* Types: s text, n number, b yes/no, j JSON                           */
/* ------------------------------------------------------------------ */
// ---------------------------------------------------------------------
// HOW DATA IS STORED IN THE SHEETS
// Each list is one tab. Row 1 holds the column names; each later row is one
// record. The letter after each column name says how the cell is read:
//   s = text, n = number, b = yes/no, j = a small structured value (JSON)
// ---------------------------------------------------------------------
var TABS = {
  // People: who is in the system. chatId is the Google account number used
  // for Chat @mentions; it is filled in automatically when they sign in.
  people:   { id: "s", email: "s", name: "s", role: "s", watch: "b", active: "b", phone: "s", cals: "j", invitedAt: "s", joinedAt: "s", chatId: "s" },
  // Availability: one row per person per day; slots is the 33-character
  // string of 1s and 0s (in the building or not, per half hour).
  avail:    { pid: "s", date: "s", slots: "s", ev: "j" },
  // Watches: the watch bill. s and e are the start and end half-hour blocks.
  watches:  { id: "s", pid: "s", date: "s", s: "n", e: "n", checks: "j", ev: "s" },
  // Requests: maintenance (service) requests.
  requests: { id: "s", date: "s", by: "s", byId: "s", loc: "s", issue: "s", pri: "s", status: "s", wo: "s" },
  // Maintenance Log: one row per worker visit, from arrival to departure,
  // including the secret sign-out code, any assistance request, and who
  // responded.
  log:      { id: 's', date: 's', worker: 's', shop: 's', req: 's', task: 's', 'in': 'n', out: 'n', done: 's', fu: 's', ret: 's', prob: 's', newReq: 's', by: 's', fuClosed: 'b', email: 's', emailConsent: 'b', tokenHash: 's', tokenExpiry: 's', workerOutAt: 's', watchOutAt: 's', watchSeenAt: 's', outBy: 's', inAt: 's', helpAt: 's', helpLocation: 's', helpMessage: 's', helpAckBy: 's', helpAckById: 's', helpAckAt: 's', helpAckChat: 's' },
  // Audit: the trail of who did what and when.
  audit:    { t: "s", who: "s", action: "s", detail: "s" },
  // Crew Assignments and their activity history (facilities projects).
  crewAssignments: { id:"s", title:"s", description:"s", location:"s", priority:"s", dueDate:"s", assignees:"j", status:"s", createdBy:"s", createdAt:"s", submittedBy:"s", submittedAt:"s", approvedBy:"s", approvedAt:"s", returnNote:"s", updatedAt:"s" },
  crewActivity: { eventId:"s", assignmentId:"s", personId:"s", action:"s", note:"s", timestamp:"s" }
};
// The tab name in the spreadsheet for each list.
var TAB_NAMES = { people: "People", avail: "Availability", watches: "Watches", requests: "Requests", log: "Maintenance Log", audit: "Audit", settings: "Settings", crewAssignments: "Crew Assignments", crewActivity: "Crew Assignment Activity" };
// Rows older than this many days move to archive tabs (just over a year, so annual reports still work).
var ARCHIVE_DAYS = 400;

// ---------------------------------------------------------------------
// SMALL HELPERS
// ---------------------------------------------------------------------
// props_: the script's private settings store ("Script Properties"),
// visible only to people who can edit this script. The Chat webhook
// address is kept there, never in the sheets or in this code.
function props_() { return PropertiesService.getScriptProperties(); }
// tz_: the time zone the building runs on (Eastern).
function tz_() { return Session.getScriptTimeZone() || "America/New_York"; }
// err_: builds an error with a short code and a readable message.
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }
// sheetId_: pulls the ID out of a pasted spreadsheet web address.
function sheetId_(v) {
  v = String(v || "").trim();
  var m = v.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : v;
}
// wbCache_: remembers spreadsheets already opened during this request,
// so each file is only opened once.
var wbCache_ = {};
// workbookFor_: opens the spreadsheet file that holds a given list.
function workbookFor_(key) {
  var map = JSON.parse(props_().getProperty("SHEET_MAP") || "{}");
  var id = map[key] || SETUP.SHEETS[key];  // new keys work before setup() is rerun
  if (!id) throw err_("setup", "Missing spreadsheet mapping for " + key + ". Run setup().");
  if (!wbCache_[id]) wbCache_[id] = SpreadsheetApp.openById(id);
  return wbCache_[id];
}
// openSheet_: the main spreadsheet (the one holding the watch bill).
function openSheet_() {
  return workbookFor_("watches");
}

// ---------------------------------------------------------------------
// READING AND WRITING THE SHEETS
// ---------------------------------------------------------------------
// readTab_: reads one tab and turns every row into a record. Columns are
// found by their heading, so their order in the sheet does not matter.
function readTab_(ss, key) {
  var sh = workbookFor_(key).getSheetByName(TAB_NAMES[key]);
  // An empty tab (or one with only headings) means an empty list.
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues();
  var head = vals[0], types = TABS[key], out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    // Skip completely blank rows.
    if (row.join("") === "") continue;
    var o = {}, extra = null;
    head.forEach(function (h, c) {
      if (!types.hasOwnProperty(h)) {
        // A column someone added by hand: carry it with the row so it survives the next save.
        if (h) { extra = extra || {}; extra[h] = row[c]; }
        return;
      }
      var v = row[c], ty = types[h];
      // Turn each cell into the right kind of value (number, yes/no, structured).
      if (ty === "n") o[h] = v === "" ? "" : Number(v);
      else if (ty === "b") o[h] = /^(yes|true|y|1)$/i.test(v);
      else if (ty === "j") { try { o[h] = v ? JSON.parse(v) : (h === "checks" ? {} : []); } catch (e) { o[h] = h === "checks" ? {} : []; } }
      else o[h] = v;
    });
    if (extra) o._x = extra;
    out.push(o);
  }
  return out;
}
// rowValues_: the reverse of readTab_: turns records back into rows of
// cells, in the column order given by the header.
function rowValues_(key, rows, header) {
  var types = TABS[key];
  return rows.map(function (r) {
    return header.map(function (c) {
      if (!types.hasOwnProperty(c)) return r._x && r._x[c] != null ? String(r._x[c]) : "";
      var v = r[c], ty = types[c];
      if (ty === "b") return v ? "yes" : "no";
      if (ty === "j") return JSON.stringify(v == null ? (c === "checks" ? {} : []) : v);
      return v == null ? "" : String(v);
    });
  });
}
// headerFor_: the column headings to write: the app's own columns first,
// then any extra columns someone added by hand, so those are kept.
function headerFor_(sh, key) {
  var cols = Object.keys(TABS[key]), lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  return cols.concat(existing.filter(function (h) { return h && cols.indexOf(h) < 0; }));
}
// Overwrite in place, then clear only the leftover rows below. The tab is never empty mid-save,
// and formatting, notes and hand-added columns (with a header) are kept.
// putValues_: writes all the rows starting at the top-left cell, then
// blanks out any old rows left below. Rows are overwritten in place, so the
// tab is never empty, even for a moment, and formatting is kept.
function putValues_(sh, values) {
  var width = values[0].length;
  // "@" sets cells to plain text, so Sheets never reformats dates or numbers.
  sh.getRange(1, 1, values.length, width).setNumberFormat("@").setValues(values);
  var last = sh.getLastRow();
  if (last > values.length) sh.getRange(values.length + 1, 1, last - values.length, Math.max(width, sh.getLastColumn())).clearContent();
  // Keep the heading row frozen and bold.
  if (sh.getFrozenRows() !== 1) sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight("bold");
}
// tabSheet_: finds a tab by name, creating it if it does not exist yet.
function tabSheet_(key, name) {
  var wb = workbookFor_(key);
  return wb.getSheetByName(name) || wb.insertSheet(name);
}
// writeTab_: saves a whole list back to its tab.
function writeTab_(ss, key, rows) {
  var sh = tabSheet_(key, TAB_NAMES[key]), header = headerFor_(sh, key);
  putValues_(sh, [header].concat(rowValues_(key, rows, header)));
}
// readSettings_: settings are stored as two columns, key and value.
function readSettings_(ss) {
  var sh = workbookFor_("settings").getSheetByName(TAB_NAMES.settings), o = {};
  if (!sh || sh.getLastRow() < 2) return o;
  sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    try { o[r[0]] = JSON.parse(r[1]); } catch (e) { o[r[0]] = r[1]; }
  });
  return o;
}
// writeSettings_: saves all settings back to the Settings tab.
function writeSettings_(ss, s) {
  var wb = workbookFor_("settings"), sh = wb.getSheetByName(TAB_NAMES.settings) || wb.insertSheet(TAB_NAMES.settings);
  var values = [["key", "value"]].concat(Object.keys(s).map(function (k) { return [k, JSON.stringify(s[k])]; }));
  putValues_(sh, values);
}
// readStore_: loads every list from every tab into one "store" and makes
// sure nothing is missing (Core.ensure).
function readStore_(ss) {
  var st = {};
  Object.keys(TABS).forEach(function (k) { st[k] = readTab_(ss, k); });
  st.settings = readSettings_(ss);
  return Core.ensure(st);
}
// saveStore_: saves only the lists that changed during this request
// (or all of them when "all" is true). If anything the alerts depend on
// changed, the short-term alert copy is thrown away so alerts are fresh.
function saveStore_(ss, st, all) {
  Object.keys(TABS).forEach(function (k) { if (all || st._dirty[k]) writeTab_(ss, k, st[k]); });
  if (all || st._dirty.settings) writeSettings_(ss, st.settings);
  if (all || st._dirty.log || st._dirty.watches || st._dirty.avail || st._dirty.people || st._dirty.settings) alertsChanged_();
}

// ---------------------------------------------------------------------
// SIGN-IN CHECK
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Sign-in: verify the Google ID token the app sends with each request */
/* ------------------------------------------------------------------ */
// The Google account number of whoever signed in, used for Chat @mentions.
var signinSub_ = '';   // Google account id from the last verified sign-in; equals the Chat user id
// verify_: every request from the app carries a sign-in "token" issued by
// Google. This asks Google whether the token is genuine, unexpired, and
// issued to this app, then returns the person's verified email address.
// A request with a missing or fake token is refused before anything else.
function verify_(token) {
  if (!token) throw err_("auth", "Please sign in.");
  var cache = CacheService.getScriptCache();
  // Remember answers for up to 10 minutes, so Google is not asked again on
  // every click. The token itself is not stored, only a scrambled fingerprint.
  var key = "t" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) {
    if (hit.charAt(0) === "{") { try { var c = JSON.parse(hit); signinSub_ = c.sub || ''; return c.email; } catch (e) {} }
    signinSub_ = ''; return hit;   // entry cached by an older version
  }
  // Ask Google about the token.
  var r = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw err_("auth", "Your sign-in expired. Please sign in again.");
  var j = JSON.parse(r.getContentText());
  // The token must have been issued for this app...
  var cid = props_().getProperty("CLIENT_ID");
  if (!cid || j.aud !== cid) throw err_("auth", "Sign-in is not set up for this app.");
  // ...for a verified email address...
  if (!(j.email_verified === true || j.email_verified === "true")) throw err_("auth", "Your Google email isn't verified.");
  // ...by Google's own sign-in service...
  if (!/accounts\.google\.com$/.test(String(j.iss))) throw err_("auth", "Unexpected sign-in issuer.");
  // ...and must not have expired.
  var left = Math.floor(+j.exp - Date.now() / 1000);
  if (left <= 0) throw err_("auth", "Your sign-in expired. Please sign in again.");
  var email = String(j.email).toLowerCase();
  // Keep the account number only if it looks like a real one (all digits).
  signinSub_ = /^[0-9]{5,30}$/.test(String(j.sub || '')) ? String(j.sub) : '';
  cache.put(key, JSON.stringify({ email: email, sub: signinSub_ }), Math.min(600, left));
  return email;
}

// ---------------------------------------------------------------------
// WEB ENTRY POINTS: the only two doors into this backend.
//   doGet  answers when someone opens the backend's web address in a
//          browser (the worker's personal link).
//   doPost answers everything the app sends, and the worker's buttons.
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Web app entry points                                               */
/* ------------------------------------------------------------------ */
// doGet: when a worker opens their personal link (it ends in
// "?signout=" plus a long secret code), show the page with two sections:
// "Need help?" and "Leaving?". Just opening the page changes nothing, so
// email security scanners that open links cannot sign anyone out.
function doGet(e) {
  if (e && e.parameter && e.parameter.signout) {
    var token = String(e.parameter.signout);
    // A code with the wrong shape is refused straight away.
    if (!/^[a-zA-Z0-9_-]{32,160}$/.test(token)) return htmlResult_('This sign-out link is invalid.');
    var url = ScriptApp.getService().getUrl();
    // GET only presents the page. Email link scanners cannot sign someone out or raise an alert.
    // Forms and links use target="_top": HtmlService pages run in a frame that cannot show the result otherwise.
    // The watch phone number, shown as a tap-to-call link if one is saved.
    var phone = workerPhoneHtml_();
    // The page itself: plain HTML text, built up piece by piece.
    var html = '<h2>Building Watch</h2>' +
      '<section style="border:2px solid #c0392b;border-radius:10px;padding:16px;margin:18px 0">' +
      '<h3 style="margin-top:0">Need help?</h3><p>This alerts the person on watch right away.</p>' +
      // The help form: location and message, sent back here with the secret code.
      '<form method="post" action="' + htmlSafe_(url) + '" target="_top">' +
      '<input type="hidden" name="helpToken" value="' + htmlSafe_(token) + '">' +
      '<label>Where are you?<br><input name="helpLocation" required maxlength="120" style="font:inherit;width:100%;padding:10px;box-sizing:border-box" placeholder="e.g. Room 210, second floor"></label><br><br>' +
      '<label>What do you need?<br><textarea name="helpMessage" maxlength="500" rows="3" style="font:inherit;width:100%;padding:10px;box-sizing:border-box" placeholder="e.g. Door is locked, need access"></textarea></label><br><br>' +
      '<button style="font:inherit;padding:14px 20px;background:#c0392b;color:#fff;border:0;border-radius:8px" type="submit">Request assistance</button></form>' +
      (phone ? '<p>' + phone + '</p>' : '') + '</section>' +
      '<section style="border:1px solid #bbb;border-radius:10px;padding:16px">' +
      '<h3 style="margin-top:0">Leaving?</h3><p>Only press the button if you have left the facility.</p>' +
      // The departure form: one button, sent back here with the secret code.
      '<form method="post" action="' + htmlSafe_(url) + '" target="_top"><input type="hidden" name="signoutToken" value="' + htmlSafe_(token) + '">' +
      '<button style="font:inherit;padding:14px 20px" type="submit">I have departed, sign me out</button></form>' +
      '<p>Signing out does not count as a watchstander acknowledgment.</p></section>';
    return htmlPage_('Building Watch', html);
  }
  // Opening the backend address without a code just says it is running.
  return ContentService.createTextOutput('Building Watch test API is running.');
}
// htmlSafe_: makes text safe to show on a web page, so a worker typing
// symbols like < or > cannot break or hijack the page.
function htmlSafe_(value) {
  return String(value).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
}
// htmlPage_: wraps content in a simple page that fits a phone screen.
function htmlPage_(title, bodyHtml) {
  return HtmlService.createHtmlOutput('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font:16px system-ui;max-width:460px;margin:6vh auto;padding:20px">' + bodyHtml + '</body></html>')
    .setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// htmlResult_: a page that shows one message, such as "Help is on the way."
function htmlResult_(message, extraHtml) {
  return htmlPage_('Building Watch', '<h2>' + htmlSafe_(message) + '</h2>' + (extraHtml || ''));
}
// watchPhone_: the saved watch phone number, or nothing.
function watchPhone_() {
  try { var s = readSettings_(null); return String(s.watchPhone || '').trim(); } catch (e) { return ''; }
}
// workerPhoneHtml_: "Or call the watch: (number)" as a tap-to-call link.
function workerPhoneHtml_() {
  var p = watchPhone_();
  return p ? 'Or call the watch: <a target="_top" href="tel:' + htmlSafe_(p.replace(/[^0-9+]/g, '')) + '"><b>' + htmlSafe_(p) + '</b></a>' : '';
}
// emailAllowed_: only send email to real-looking addresses. Made-up test
// domains (example.com, .invalid, .test) never receive email.
function emailAllowed_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) return false;
  var host = email.split('@')[1];
  return !(/(^|\.)(invalid|example|test|localhost)$/i.test(host) || /^example\.(com|net|org)$/i.test(host) || host === 'demo.invalid');
}
// tokenDigest_: scrambles a secret code one way. Only the scrambled form
// is stored in the sheet, so even someone reading the sheet cannot rebuild
// a worker's link.
function tokenDigest_(token) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token));
  return Utilities.base64EncodeWebSafe(bytes);
}
// confirmWorkerSignout_: the worker pressed "I have departed".
// The lock makes requests wait their turn, so two saves never collide.
function confirmWorkerSignout_(token) {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var st = readStore_(openSheet_()); st._dirty = {}; st._warn = [];
    var now = new Date(), hash = tokenDigest_(token);
    // Find the visit that matches this link's code.
    var l = st.log.filter(function(x) { return x.tokenHash && x.tokenHash === hash; })[0];
    // Unknown, expired, or already used links are refused.
    if (!l || !l.tokenExpiry || now.getTime() > +l.tokenExpiry) return 'This sign-out link has expired or has already been used.';
    // Record the departure time, then erase the code so the link cannot be used again.
    l.workerOutAt = now.toISOString();
    if (l.out === '' || l.out == null) l.out = H.nowMin();
    l.tokenHash = ''; l.tokenExpiry = '';
    st._dirty.log = true;
    st.audit.push({t: now.toISOString(), who: 'Worker email link', action: 'log.selfSignout', detail: l.id});
    st._dirty.audit = true;
    saveStore_(openSheet_(), st);
    // Tell the watch by email that the worker left.
    notifyDeparture_(st, l, 'Worker reported departure by email link');
    return 'Your departure has been recorded. Thank you.';
  } finally { lock.releaseLock(); }
}
// nowSlot_: which half-hour block of the day it is right now.
function nowSlot_() { return Math.floor((H.nowMin() - Core.START) / 30); }
// onWatchIds_: the people on the watch bill for the current half hour.
function onWatchIds_(st) {
  var date = H.today(), slot = nowSlot_();
  return st.watches.filter(function(x){return x.date === date && +x.s <= slot && +x.e > slot;}).map(function(x){return x.pid;});
}
// The responder is whoever has the watch now; otherwise whoever is in charge (acting or manager).
// responder_: who should respond right now. The person on watch; if nobody
// is on watch, the acting manager; if none, the building manager.
function responder_(st) {
  var byId = function (id) { return st.people.filter(function(p){return p.id === id && p.active !== false;})[0] || null; };
  var ids = onWatchIds_(st);
  for (var i = 0; i < ids.length; i++) { var p = byId(ids[i]); if (p) return p; }
  return byId(Core.inChargeId(st, H.today())) || byId(st.settings.manager);
}
// activeWatchEmail_: the responder's email address.
function activeWatchEmail_(st) {
  var person = responder_(st);
  return person ? person.email : '';
}
// sendTestEmail_: sends one email, but only when email is switched on and
// the address is allowed.
function sendTestEmail_(to, subject, body) {
  if (!SETUP.SEND_TEST_EMAILS || !emailAllowed_(to)) return false;
  MailApp.sendEmail({to:String(to).trim(), subject:subject, body:body, name:'Building Watch Test'});
  return true;
}
// notifyWorkerArrival_: a worker checked in. Email the responder, then
// (if the worker gave an email and agreed) email the worker their personal
// link for asking for help and for signing out.
function notifyWorkerArrival_(st, l) {
  if (!SETUP.SEND_TEST_EMAILS) return;
  var email = activeWatchEmail_(st);
  if (emailAllowed_(email)) sendTestEmail_(email, 'Building Watch test: worker arrived',
    l.worker + ' from ' + l.shop + ' has checked in.\nReason: ' + l.task + '\nPlease acknowledge when seen.');
  if (!l.emailConsent || !emailAllowed_(l.email)) return;
  // Make a long random secret code for the worker's link.
  var token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  var url = ScriptApp.getService().getUrl();
  if (!url) { st._warn.push('Sign-out link unavailable until script is deployed.'); return; }
  var link = url + '?signout=' + encodeURIComponent(token);
  // Store only the scrambled code, valid for 7 days.
  l.tokenHash = tokenDigest_(token); l.tokenExpiry = String(Date.now()+7*24*60*60*1000);
  st._dirty.log = true;
  try {
    sendTestEmail_(l.email, 'Building Watch test: your check-in and sign-out link',
      'Hello '+l.worker+',\n\nYour arrival has been recorded.\n\nKeep this personal link while you are in the building:\n'+link+'\n\n' +
      '- Need help? Open the link and choose Request assistance. The person on watch is alerted right away.\n' +
      '- Leaving? Open the link and confirm your departure.\n' + (st.settings.watchPhone ? '- Call the watch: ' + st.settings.watchPhone + '\n' : '') +
      '\nThe link expires in 7 days. If you did not check in, contact the person running the test.\n\nBuilding Watch (fictional Star Trek test data)');
  // If the email fails, the link is cancelled so a code nobody has can't linger.
  } catch(ex) {l.tokenHash=''; l.tokenExpiry=''; st._warn.push('Worker email was not sent: '+ex.message);}
}
// notifyDeparture_: email the responder that a worker left.
function notifyDeparture_(st, l, source) {
  var email = activeWatchEmail_(st);
  if(emailAllowed_(email)) {
    try {sendTestEmail_(email,'Building Watch test: worker departure',l.worker+' — '+source+'.\n'+l.shop+'\n'+l.task);}catch(ex){st._warn.push('Departure alert failed: '+ex.message);}
  }
}


// =====================================================================
// doPost: EVERY request from the app, and the worker's buttons, comes here.
// =====================================================================
function doPost(e) {
  var out;
  try {
    // The worker pressed "I have departed" on their phone page.
    if (e && e.parameter && e.parameter.signoutToken) {
      return htmlResult_(confirmWorkerSignout_(String(e.parameter.signoutToken)));
    }
    // The worker pressed "Request assistance" on their phone page.
    if (e && e.parameter && e.parameter.helpToken) {
      return htmlResult_(requestAssistance_(String(e.parameter.helpToken), e.parameter.helpLocation, e.parameter.helpMessage), workerPhoneHtml_());
    }
    // Otherwise this is a request from the app: read it, and check the
    // sign-in before anything else.
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var email = verify_(req.token);
    // "watch.alerts": the app asks every 15 seconds whether there is anything
    // new. This is answered from a short-term copy without waiting in line,
    // so constant checking never slows down people saving work.
    if (req.action === 'watch.alerts') {
      // Polled every 15 seconds by every open app: read-only, cached, and never waits on the write lock.
      out = { ok: true, data: watchAlerts_(email), warn: [] };
      return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
    }
    // Everything else waits its turn (up to 25 seconds) so saves never collide.
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      // Load all the data.
      var ss = openSheet_();
      var st = readStore_(ss);
      st._dirty = {}; st._warn = [];
      var data;
      // If this sign-in brought the person's Google account number, remember it
      // for Chat @mentions.
      rememberChatId_(st, email);
      // Admin-only actions handled here in the backend (Chat pager setup,
      // connection test, calendar publishing). Each checks admin rights itself.
      if (req.action === "admin.chat.save") data = chatSave_(st, email, req.payload || {});
      else if (req.action === "admin.chat.test") data = chatTest_(st, email);
      else if (req.action === "admin.chat.clear") data = chatClear_(st, email);
      else if (req.action === "admin.dataSource") data = dataSource_(st, email, req.payload || {});
      else if (req.action === "admin.test") data = testConnection_(st, email, ss);
      else if (req.action === "admin.calendars") data = calendarChoices_(st, email);
      else if (req.action === "admin.previewPublish") data = previewPublish_(st, email);
      else if (req.action === "admin.publish") data = publishWatch_(st, email);
      // Everything else is handled by the rule book (Core.gs).
      else {
        data = Core.handle(st, email, req.action, req.payload || {}, H);
        // After a check-in from the app, send the arrival emails and the worker's
        // link. The secret code is written to the stored visit record, not to the
        // cleaned-up copy the app receives.
        // Core returns a redacted copy; the token must be written to the stored record.
        if (req.action === 'log.in') notifyWorkerArrival_(st, st.log.filter(function(x){return x.id===data.id;})[0] || data);
        // After a check-out from the app, record when and by whom.
        if (req.action === 'log.out') {
          var logged = st.log.filter(function(x){return x.id===data.id;})[0];
          if (logged) { logged.watchOutAt = H.nowISO(); logged.watchSeenAt = H.nowISO(); logged.outBy = email; st._dirty.log = true; }
        }
        // After "I'm responding", reply in the Chat pager thread.
        if (req.action === 'log.ack') pageAckReply_(st, email, data && data.id);
        // Admins loading the app also learn whether the Chat pager is connected.
        if (req.action === 'load' && data && data.admin) data.chatPager = chatStatus_();
        // Save whatever changed.
        saveStore_(ss, st);
        if (req.action === 'log.out') notifyDeparture_(st, data, 'Departure recorded by a test watchstander');
        // Copy maintenance request changes to the separate Task Activity sheet.
        if (req.action === "req.update" || req.action === "req.new") {
          writeTaskActivity_(email, req.action, req.payload || {}, data);
        }
      }
      // Admin actions that don't save on their own still keep a newly learned Chat id.
      if (/^admin\./.test(req.action) && st._dirty.people) saveStore_(ss, st);
      // Send the answer back to the app, with secrets removed.
      out = { ok: true, data: sanitizeClientData_(data), warn: st._warn };
    } finally { lock.releaseLock(); }
  // Any problem becomes a readable error message for the app to show.
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), code: (err && err.code) || "" };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// sanitizeClientData_: a final safety net. Removes secret sign-out codes
// and internal fields from anything sent back to the browser.
function sanitizeClientData_(value) {
  // Never send email sign-out token digests or expiry records to the public frontend.
  if (Array.isArray(value)) return value.map(sanitizeClientData_);
  if (value && typeof value === 'object') {
    var cleaned = {};
    Object.keys(value).forEach(function(k) {
      if (k !== 'tokenHash' && k !== 'tokenExpiry' && k !== '_x') cleaned[k] = sanitizeClientData_(value[k]);
    });
    return cleaned;
  }
  return value;
}

// writeTaskActivity_: adds one line to the "Task Activity" sheet each time
// a maintenance request is created or updated. Failures here never block
// the request itself.
function writeTaskActivity_(email, action, payload, data) {
  try {
    var wb = workbookFor_("activity");
    var sh = wb.getSheetByName("Task Activity");
    if (!sh) return;
    var taskId = action === "req.new" ? (data && data.id || "") : (payload.id || "");
    sh.appendRow([Utilities.getUuid(), taskId, email, action,
      payload.status || payload.issue || "", payload.note || "", new Date().toISOString()]);
  } catch (ex) { Logger.log("Task activity logging failed: " + ex); }
}

// requireAdmin_: stops the request unless the person has admin rights today.
function requireAdmin_(st, email) {
  var me = Core.findEmail(st, email);
  if (!Core.isAdmin(st, me, H.today())) throw err_("forbidden", "Only admins can do that.");
  return me;
}

// calendarChoices_: the calendars an admin can publish the watch bill to.
function calendarChoices_(st, email) {
  requireAdmin_(st, email);
  // Deliberately restrict this test to calendars owned by the Apps Script account.
  // The administrator explicitly selects a calendar. We never silently use primary.
  return CalendarApp.getAllOwnedCalendars().map(function(c) {
    return { id: c.getId(), name: c.getName(), primary: c.isMyPrimaryCalendar() };
  }).sort(function(a,b) { return a.name.localeCompare(b.name); });
}
// publishable_: watches in the next 45 days, for active people, that are
// not on the calendar yet.
function publishable_(st) {
  var today = H.today();
  var max = new Date(); max.setDate(max.getDate() + 45);
  var last = Utilities.formatDate(max, tz_(), 'yyyy-MM-dd');
  return st.watches.filter(function(w) {
    return !w.ev && w.date >= today && w.date <= last &&
      st.people.some(function(p){return p.id === w.pid && p.active !== false;});
  });
}
// previewPublish_: how many watches are ready to publish, before doing it.
function previewPublish_(st, email) {
  requireAdmin_(st, email);
  return { ready: publishable_(st).length,
    published: st.watches.filter(function(w){return !!w.ev;}).length,
    calendarId: st.settings.calId || '', calendarName: st.settings.calName || '' };
}
// publishWatch_: puts the drafted watches on the chosen Google Calendar,
// inviting each person on watch if invitations are on.
function publishWatch_(st, email) {
  requireAdmin_(st, email);
  var selected = st.settings.calId;
  if (!selected) throw err_('calendar', 'Select and save a Google Calendar in Admin first.');
  var cal = CalendarApp.getOwnedCalendarById(selected);
  if (!cal) throw err_('calendar', 'The selected calendar is no longer owned by this test account. Choose another.');
  var pending = publishable_(st), created = 0, failed = 0;
  pending.forEach(function(w) {
    var person = st.people.filter(function(p) {return p.id === w.pid;})[0];
    try {
      // Write the resulting event ID back before continuing, preventing duplicate
      // creation if a later event fails or a later request retries.
      var id = createWatchEvent_(st, cal, person, w);
      if (!id) throw new Error('Calendar returned no event ID');
      w.ev = id;
      st._dirty.watches = true;
      saveStore_(openSheet_(), st);
      created++;
    } catch(ex) {
      st._warn.push('Could not publish ' + w.date + ' for ' + (person && person.name || w.pid) + ': ' + ex.message);
      failed++;
    }
  });
  var who = Core.findEmail(st, email);
  st.audit.push({t:H.nowISO(), who: who && who.name || email, action:'calendar.publish',
    detail: created+' created; '+failed+' failed; calendar '+cal.getName() });
  st._dirty.audit = true;
  saveStore_(openSheet_(), st);
  return { created: created, failed: failed, calendar: cal.getName() };
}
// dataSource_: moving data to a different sheet is not supported in this set-up.
function dataSource_(st, email, P) {
  requireAdmin_(st, email);
  throw err_("readonly", "This demo uses five separate spreadsheet files. Change their IDs in Code.gs instead of moving a single data sheet.");
}

// testConnection_: the admin "Check live connection" button: who owns the
// script, which sheets and calendar are in use, the QR form link, and how
// many emails can still be sent today.
function testConnection_(st, email, ss) {
  requireAdmin_(st, email);
  return {
    owner: Session.getEffectiveUser().getEmail(),
    sheet: "Five separate Star Trek demo spreadsheets",
    sheetUrl: ss.getUrl(),
    calendar: st.settings.calId ? st.settings.calName + ' (admin publish enabled)' : '',
    calendarError: st.settings.calId ? '' : 'No Google Calendar selected yet',
    formUrl: props_().getProperty('WORKER_FORM_URL') || '',
    mailLeft: MailApp.getRemainingDailyQuota(),
    timeZone: tz_()
  };
}

// ---------------------------------------------------------------------
// HELPERS FOR THE RULE BOOK: calendar, mail and time.
// These are the "H" helpers Core.gs uses to reach the outside world.
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Hooks used by Core: calendar, mail, time                           */
/* ------------------------------------------------------------------ */
var calCache_ = {};
// mainCal_: opens the calendar chosen in Admin (once per request).
function mainCal_(st) {
  var id = st.settings.calId;
  if (!id) { st._warn.push('No calendar selected: save one in Admin before publishing.'); return null; }
  if (calCache_.hasOwnProperty(id)) return calCache_[id];
  var c = null;
  try { c = id === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id); } catch (e) {}
  if (!c) st._warn.push("Couldn't open the main calendar. Check the Calendar ID in Admin and that it's shared with the app owner.");
  calCache_[id] = c;
  return c;
}
// at_: turns a date and a half-hour block number into an actual time.
function at_(date, slot) {
  var p = date.split("-"), m = Core.START + slot * 30;
  return new Date(+p[0], +p[1] - 1, +p[2], Math.floor(m / 60), m % 60);
}
// delEv_: removes one calendar event, if it still exists.
function delEv_(st, cal, id) {
  if (!id) return;
  try { var ev = cal.getEventById(id); if (ev) ev.deleteEvent(); } catch (e) { st._warn.push("Couldn't remove an old calendar event."); }
}
// watchDesc_: the description put on each watch calendar event (the checklist).
function watchDesc_(st) {
  return "Building watch duties:\n" + st.settings.tmpl.map(function (t) { return "- " + t; }).join("\n") +
    (st.settings.appUrl ? "\n\nCheck them off in Building Watch: " + st.settings.appUrl : "");
}

// createWatchEvent_: creates one calendar event for a watch, with a
// reminder, and invites the person on watch if invitations are on.
function createWatchEvent_(st, cal, person, w) {
  if (!cal || !person) return '';
  var invite = !!(st.settings.invites && emailAllowed_(person.email));
  var opts = { description: watchDesc_(st), sendInvites: invite };
  if (invite) opts.guests = person.email;
  var ev = cal.createEvent('Building watch: ' + Core.nm(person), at_(w.date,+w.s), at_(w.date,+w.e), opts);
  ev.removeAllReminders();
  if (+st.settings.remind > 0) ev.addPopupReminder(+st.settings.remind);
  return ev.getId();
}
var H = {
  // today: today's date in the building's time zone.
  today: function () { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"); },
  // nowMin: minutes since midnight right now.
  nowMin: function () { var s = Utilities.formatDate(new Date(), tz_(), "HH:mm").split(":"); return +s[0] * 60 + +s[1]; },
  // nowISO: the exact current time, in a standard format.
  nowISO: function () { return new Date().toISOString(); },

  // Availability is never put on any calendar; it is private planning input.
  syncAvail: function (st, p, date, slots, oldIds) {
    // Availability is PRIVATE input to the schedule, never published directly.
    return [];
  },
  // Watches are drafts until an admin presses Publish.
  watchCreate: function (st, p, w) {
    // Changes to the watch bill are drafts until Admin clicks Publish.
    return '';
  },
  eventDelete: function (st, id) {
    if (!id || SETUP.PREVIEW_ONLY) return;
    var cal = mainCal_(st);
    if (cal) delEv_(st, cal, id);
  },

  // Calendars are never shared automatically.
  shareCal: function (st, email, on) {
    // No automatic sharing of test calendar or changes to external users' access.
    // Calendar invitations are sent only by the explicit Publish button.
  },
  // testCal: checks a calendar can be used before an admin selects it.
  testCal: function (st, id) {
    var c = null;
    try { c = CalendarApp.getOwnedCalendarById(id); } catch (e) {}
    if (!c) throw err_('calendar', 'Choose a calendar owned by the Apps Script test account.');
    var hasPublished = st.watches.some(function(w){return !!w.ev;});
    if (hasPublished && st.settings.calId && st.settings.calId !== id)
      throw err_('calendar', 'You already published assignments to another calendar. Remove those published assignments before switching.');
    return c.getName();
  },

  // sendInvite: the "You're invited to Building Watch" email for a new person.
  sendInvite: function (st, p, fromName) {
    if (!SETUP.SEND_TEST_EMAILS || !emailAllowed_(p.email)) { st._warn.push('Fictional/invalid address: invitation email skipped.'); return; }
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
  // sendMail: the admin's group email, one copy per allowed address.
  sendMail: function (st, emails, subject, body, fromName) {
    var valid = emails.filter(emailAllowed_);
    if (!SETUP.SEND_TEST_EMAILS || !valid.length) return 0;
    var left = MailApp.getRemainingDailyQuota();
    if (left < valid.length) throw err_('quota', 'Not enough remaining daily email quota.');
    valid.forEach(function(email) {sendTestEmail_(email, subject, body);});
    return valid.length;
  },

  // fetchBusy: reads a person's own calendar links (below).
  fetchBusy: function (st, cals, week) { return fetchBusy_(st, cals, week); }
};

// ---------------------------------------------------------------------
// PERSONAL CALENDARS: show a person their own busy times while they fill
// in their week. Only their own secret iCal links are read, and only they
// see the event titles.
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Reading sailors' own calendars (busy overlay, titles to owner only) */
/* ------------------------------------------------------------------ */
// Some calendars (such as Outlook) use Windows time zone names; these are
// the equivalents Google understands.
var WIN_TZ = { "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver", "Pacific Standard Time": "America/Los_Angeles", "UTC": "UTC" };

// fetchBusy_: for each of the person's calendar links, download the
// calendar and turn its events into busy half-hour blocks for this week.
function fetchBusy_(st, cals, week) {
  var out = [];
  // add: marks the half-hour blocks one event covers on each day it touches.
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
      // Secret iCal links only. Reading a calendar by ID would use the app owner's access,
      // letting any member see calendars shared with the owner.
      // Anything that is not a web link is skipped (calendar IDs are refused,
      // because they would be read with the script owner's access).
      if (!/^(https|webcal):\/\//i.test(u)) { st._warn.push("Skipped " + c.label + ": add it again using its secret iCal address."); return; }
      // Download the calendar.
      var res = UrlFetchApp.fetch(u.replace(/^webcal:/i, "https:"), { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) { st._warn.push("Couldn't read " + c.label + " (link returned " + res.getResponseCode() + ")."); return; }
      icsEvents_(res.getContentText(), week).forEach(function (ev) { add(ev.start, ev.end, ev.title); });
    } catch (e) { st._warn.push("Couldn't read " + c.label + "."); }
  });
  return out;
}

// icsWall_: converts a "wall clock" time in some time zone to the exact moment.
function icsWall_(y, mo, d, h, mi, s, tz) {
  tz = WIN_TZ[tz] || tz;
  var guess = new Date(Date.UTC(y, mo, d, h, mi, s));
  try {
    var p = Utilities.formatDate(guess, tz, "yyyy-MM-dd-HH-mm-ss").split("-").map(Number);
    var asUtc = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
    return new Date(guess.getTime() - (asUtc - guess.getTime()));
  } catch (e) { return new Date(y, mo, d, h, mi, s); }
}
// icsDate_: reads one date or date-time from a calendar file.
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
// icsEvents_: reads a calendar file (.ics) and lists the events in this
// week, including repeating events (daily or weekly) and skipping
// cancelled ones and dates removed from a series.
function icsEvents_(txt, week) {
  // Long lines in calendar files are folded; unfold them first.
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
  // Turn each event into start and end times within this week.
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
    // A one-off event: include it if it falls in this week.
    if (!ev.RRULE) {
      if (st.date < weekEnd && st.date.getTime() + dur > weekStart.getTime()) out.push({ start: st.date, end: new Date(st.date.getTime() + dur), title: title });
      return;
    }
    // A repeating event: work out each day of this week it falls on.
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


// ---------------------------------------------------------------------
// QR CHECK-IN: maintenance workers do not sign in to the app. They scan a
// QR code that opens a Google Form. Submitting the form checks them in.
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Optional QR check-in Google Form: separate from the Sailor PWA.     */
/* Setup creates a form and its one installable submit trigger.         */
/* ------------------------------------------------------------------ */
// setupWorkerForm: run once from the editor. Creates the check-in Google
// Form and connects it to onWorkerFormSubmit_ below. If the form already
// exists, it just shows its address.
function setupWorkerForm() {
  var existing = props_().getProperty('WORKER_FORM_ID');
  if (existing) {
    var prior = FormApp.openById(existing);
    Logger.log('Worker check-in Form: ' + prior.getPublishedUrl());
    return prior.getPublishedUrl();
  }
  var form = FormApp.create('Building Watch — Star Trek Worker Check-In (TEST)');
  form.setDescription('Fictional test building, not an official check-in. Use a real email only with the recipient\'s permission.')
    .setConfirmationMessage('Check-in recorded. If you provided a consenting real email address, check your inbox for a sign-out link.')
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false);
  if (typeof form.setPublished === 'function') form.setPublished(true);
  // The questions on the form.
  form.addTextItem().setTitle('Full name').setRequired(true);
  form.addTextItem().setTitle('Organization').setRequired(true);
  form.addParagraphTextItem().setTitle('Purpose of visit').setRequired(true);
  form.addTextItem().setTitle('Email for sign-out link (optional)').setRequired(false);
  form.addCheckboxItem().setTitle('Email permission')
    .setChoiceValues(['I agree to receive the test sign-out email'])
    .setRequired(false);
  // No separate form-response spreadsheet: code writes to Maintenance Log directly.
  // Each time the form is submitted, run onWorkerFormSubmit_.
  ScriptApp.newTrigger('onWorkerFormSubmit_').forForm(form).onFormSubmit().create();
  props_().setProperty('WORKER_FORM_ID', form.getId());
  props_().setProperty('WORKER_FORM_URL', form.getPublishedUrl());
  Logger.log('Worker check-in Form for QR: ' + form.getPublishedUrl());
  return form.getPublishedUrl();
}
// onWorkerFormSubmit_: runs automatically each time a worker submits the
// QR form. Adds them to the Maintenance Log, then emails the watch and,
// if they agreed, sends the worker their personal link.
function onWorkerFormSubmit_(event) {
  if (!event || !event.response) throw new Error('Run this only from the installed Form trigger.');
  var input = {};
  // Collect the answers by question title.
  event.response.getItemResponses().forEach(function(a){ input[a.getItem().getTitle()] = a.getResponse(); });
  var worker = String(input['Full name'] || '').trim().slice(0,100);
  var shop = String(input['Organization'] || '').trim().slice(0,120);
  var task = String(input['Purpose of visit'] || '').trim().slice(0,300);
  var email = String(input['Email for sign-out link (optional)'] || '').trim().toLowerCase();
  var permission = input['Email permission'] || [];
  var consent = Array.isArray(permission) && permission.indexOf('I agree to receive the test sign-out email') !== -1;
  if (!worker || !shop || !task) throw new Error('Required check-in information is missing.');
  var responseId = String(event.response.getId());
  var id = 'form-' + responseId;
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var st = readStore_(openSheet_()); st._dirty={}; st._warn=[];
    // Never record the same form submission twice.
    if (st.log.some(function(l){return l.id===id;})) return;
    var l = {id:id,date:H.today(),worker:worker,shop:shop,req:'',task:task,
      'in':H.nowMin(),out:'',done:'',fu:'',ret:'',prob:'',newReq:'',
      by:'QR Google Form',fuClosed:false,email:email,emailConsent:consent,
      tokenHash:'',tokenExpiry:'',workerOutAt:'',watchOutAt:'',watchSeenAt:'',outBy:'',
      inAt:H.nowISO(),helpAt:'',helpLocation:'',helpMessage:'',helpAckBy:'',helpAckById:'',helpAckAt:'',helpAckChat:''};
    st.log.push(l);st._dirty.log=true;
    st.audit.push({t:H.nowISO(),who:'QR Google Form',action:'log.in',detail:id});st._dirty.audit=true;
    // Save the check-in first, so it is recorded even if an email fails.
    // Persist first: if email fails, the check-in itself is still recorded.
    saveStore_(openSheet_(), st);
    try {notifyWorkerArrival_(st,l); if(st._dirty.log) saveStore_(openSheet_(),st);}
    catch(ex){Logger.log('QR check-in notification failed: '+String(ex));}
  } finally {lock.releaseLock();}
}

// ---------------------------------------------------------------------
// IN-APP ALERTS
// These are the on-screen cards ("Maintenance worker checked in",
// "Worker needs assistance", ...) that appear while the app is open.
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Watch alerts: arrivals, departures and assistance requests.         */
/* Built from the Maintenance Log, so there is nothing extra to store. */
/* ------------------------------------------------------------------ */
// The name of the short-term copy of the alert list.
var ALERT_CACHE_KEY = 'watchAlerts:v1';
// Alerts older than 15 minutes are no longer sent.
var ALERT_WINDOW_MS = 15 * 60 * 1000;   // the app shows alerts up to 10 minutes old
// The alert list is rebuilt at most every 15 seconds, however many phones ask.
var ALERT_CACHE_SECONDS = 15;
// A worker can raise a new help request at most every 2 minutes.
var HELP_REPEAT_MS = 2 * 60 * 1000;     // one assistance alert per worker every 2 minutes

// alertsChanged_: throw away the short-term copy so the next check is fresh.
function alertsChanged_() {
  try { CacheService.getScriptCache().remove(ALERT_CACHE_KEY); } catch (e) {}
}
// alertSnapshot_: builds (or reuses) the current list of alerts, plus who
// is allowed to see them and who the responder is.
function alertSnapshot_() {
  var cache = CacheService.getScriptCache(), hit = cache.get(ALERT_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  // Only the tabs alerts need, read without the lock (writes are in place, so a tab is never empty).
  // Read only the four tabs alerts need.
  var st = Core.ensure({ people: readTab_(null, 'people'), watches: readTab_(null, 'watches'),
    avail: readTab_(null, 'avail'), log: readTab_(null, 'log'), settings: readSettings_(null) });
  var today = H.today(), slot = nowSlot_(), now = Date.now();
  // Who may see alerts: anyone in the building right now (by their painted
  // availability), anyone on watch, and admins.
  var onWatch = onWatchIds_(st), resp = responder_(st), eligible = {};
  st.people.forEach(function (p) {
    if (p.active === false || !p.email) return;
    var inBldg = slot >= 0 && st.avail.some(function (a) { return a.pid === p.id && a.date === today && String(a.slots).charAt(slot) === '1'; });
    if (inBldg || onWatch.indexOf(p.id) >= 0 || Core.isAdmin(st, p, today)) eligible[Core.lc(p.email)] = Core.nm(p);
  });
  // Build the alerts from recent maintenance log activity: arrivals,
  // assistance requests, who responded, and departures.
  var alerts = [];
  var push = function (kind, id, at, l, extra) {
    var t = Date.parse(at);
    if (!t || now - t > ALERT_WINDOW_MS || t - now > 60000) return;
    var a = { id: id, kind: kind, at: new Date(t).toISOString(), log: l.id, worker: l.worker || '', shop: l.shop || '', location: '', message: '', by: '', outBy: '', ackBy: '' };
    Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k] || ''; });
    alerts.push(a);
  };
  st.log.forEach(function (l) {
    push('arrival', l.id + ':in', l.inAt, l, { by: l.by });
    var acked = l.helpAt && l.helpAckAt && l.helpAckAt >= l.helpAt;
    if (l.helpAt) push('assistance', l.id + ':help:' + l.helpAt, l.helpAt, l, { location: l.helpLocation || 'Not specified', message: l.helpMessage || 'I need help', ackBy: acked ? l.helpAckBy : '' });
    if (acked) push('ack', l.id + ':ack:' + l.helpAckAt, l.helpAckAt, l, { message: l.helpAckBy + ' is responding', by: l.helpAckBy, ackBy: l.helpAckBy });
    var outAt = l.workerOutAt || l.watchOutAt;
    if (outAt) push('departure', l.id + ':out', outAt, l, { outBy: Core.lc(l.outBy) });
  });
  alerts.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  var snap = { alerts: alerts, eligible: eligible, responder: resp ? { name: Core.nm(resp), email: Core.lc(resp.email) } : null };
  // Keep this list for 15 seconds.
  try { cache.put(ALERT_CACHE_KEY, JSON.stringify(snap), ALERT_CACHE_SECONDS); } catch (e) {}
  return snap;
}
// watchAlerts_: the alerts for one person, each naming the responder.
// People who are not in the building, on watch, or admins get nothing.
function watchAlerts_(email) {
  var snap = alertSnapshot_(), me = Core.lc(email);
  // Only people on watch, in the building right now, or admins. Anyone else (or a stranger) gets nothing.
  if (!Object.prototype.hasOwnProperty.call(snap.eligible, me)) return [];
  var myName = snap.eligible[me], resp = snap.responder;
  return snap.alerts.filter(function (a) {
    // Don't alert someone about the arrival they just logged or the departure they just recorded.
    // ...or the "is responding" notice for a request they took themselves.
    return !((a.kind === 'arrival' || a.kind === 'ack') && a.by && a.by === myName) && !(a.kind === 'departure' && a.outBy && a.outBy === me);
  }).map(function (a) {
    return { id: a.id, kind: a.kind, at: a.at, log: a.log, worker: a.worker, shop: a.shop, location: a.location, message: a.message,
      ackBy: a.ackBy, responder: resp ? resp.name : '', you: !!resp && resp.email === me };
  });
}
// ---------------------------------------------------------------------
// WORKER ASKS FOR HELP
// ---------------------------------------------------------------------
// requestAssistance_: the worker pressed "Request assistance" on their
// phone page, with where they are and what they need.
function requestAssistance_(token, location, message) {
  // A code with the wrong shape is refused.
  if (!/^[a-zA-Z0-9_-]{32,160}$/.test(token)) return 'This link is invalid.';
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var st = readStore_(openSheet_()); st._dirty = {}; st._warn = [];
    var now = new Date(), hash = tokenDigest_(token);
    // Find the visit that matches this link's code.
    var l = st.log.filter(function (x) { return x.tokenHash && x.tokenHash === hash; })[0];
    // An unknown or expired link cannot raise an alert.
    if (!l || !l.tokenExpiry || now.getTime() > +l.tokenExpiry) return 'This link has expired. Please call or find the person on watch.';
    // A worker who already signed out cannot raise an alert.
    if (l.out !== '' && l.out != null) return 'You are already signed out. If you are still in the building, call or find the person on watch.';
    // Pressing the button again within 2 minutes does not raise a second alarm.
    if (l.helpAt && now.getTime() - Date.parse(l.helpAt) < HELP_REPEAT_MS)
      return 'Your request was already sent at ' + Utilities.formatDate(new Date(l.helpAt), tz_(), 'HHmm') + '. The watch has been alerted.';
    // Record the request: when, where, and what they need.
    l.helpAt = now.toISOString();
    l.helpLocation = String(location || '').trim().slice(0, 120) || 'Not specified';
    l.helpMessage = String(message || '').trim().slice(0, 500) || 'I need help';
    st._dirty.log = true;
    st.audit.push({ t: l.helpAt, who: 'Worker email link', action: 'log.help', detail: l.id + ' at ' + l.helpLocation });
    st._dirty.audit = true;
    // Save it, which also refreshes everyone's alerts.
    saveStore_(openSheet_(), st);
    // Email is the fallback: the in-app alert only reaches people with the app open.
    var to = activeWatchEmail_(st), resp = responder_(st);
    // Ping the Chat pager space (no names or locations go into Chat).
    try { pageAssistance_(st, l); } catch (ex) { Logger.log('Chat ping failed: ' + ex); }
    // Email the responder with the details, as a backup for phones where the
    // app is closed.
    try {
      sendTestEmail_(to, 'Building Watch: worker needs assistance',
        l.worker + (l.shop ? ' (' + l.shop + ')' : '') + ' is asking for help.\n\nLocation: ' + l.helpLocation + '\nMessage: ' + l.helpMessage +
        '\n\nYou are the responder' + (resp ? ' (' + Core.nm(resp) + ')' : '') + '.\nOpen Building Watch: ' + (st.settings.appUrl || SETUP.APP_URL));
    } catch (ex) { Logger.log('Assistance email failed: ' + ex); }
    // What the worker sees on their phone.
    return 'Help is on the way. The watch has been alerted' + (resp ? ' (' + Core.nm(resp) + ')' : '') + '.';
  } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------
// CHAT PAGER
// When a worker asks for help, one message goes to the Google Chat space:
//   "Maintenance assistance requested. @Responder, please check Building Watch."
// with an "Open Building Watch" button. Everyone in the space sees it; only
// the @mentioned responder is notified. No names, locations or worker
// details are ever put in Chat; they stay in Building Watch.
// When someone presses "I'm responding" in the app, a reply goes in the
// same Chat thread: "Name is responding."
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Chat pager: a ping in a Google Chat space, like a pager.            */
/* The message never carries names, locations or worker details.      */
/* ------------------------------------------------------------------ */
// Where the Chat webhook address is kept (Script Properties). That address
// works like a password for posting into the space.
var CHAT_PROP = 'CHAT_WEBHOOK';
// The shape a real Google Chat webhook address must have.
var CHAT_URL_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[A-Za-z0-9_-]+\/messages\?[^\s]*$/;

// Every sign-in carries the Google account id, which is the id Chat uses for @mentions.
// rememberChatId_: stores the person's Google account number when they
// sign in. Chat needs that number to @mention them.
function rememberChatId_(st, email) {
  if (!signinSub_) return;
  var me = Core.findEmail(st, email);
  if (me && me.active !== false && me.chatId !== signinSub_) { me.chatId = signinSub_; st._dirty.people = true; }
}
// chatStatus_: whether the pager is connected, and to which space. The
// secret address itself is never sent anywhere.
function chatStatus_() {
  var url = props_().getProperty(CHAT_PROP) || '';
  var m = url.match(/\/spaces\/([^\/]+)\//);
  return { configured: !!url, space: m ? 'spaces/' + m[1] : '' };
}
// mention_: how to name someone in Chat: a real @mention if their account
// number is known, otherwise their name in plain text.
function mention_(p) {
  if (!p) return 'whoever is on watch';
  return /^[0-9]{5,30}$/.test(String(p.chatId || '')) ? '<users/' + p.chatId + '>' : Core.nm(p);
}
// appLink_: the app's address opened straight to the Maintenance staff tab.
function appLink_(st) {
  var base = st.settings.appUrl || SETUP.APP_URL;
  return base + (base.indexOf('?') < 0 ? '?' : '&') + 'tab=log';
}
// chatPost_: sends one message to the Chat space. A "thread key" keeps a
// request and its "is responding" reply together in one thread.
function chatPost_(text, threadKey, link) {
  var url = props_().getProperty(CHAT_PROP);
  if (!url) return { sent: false, error: 'Chat pager is not connected.' };
  if (threadKey) url += '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD&threadKey=' + encodeURIComponent(threadKey);
  var body = { text: text };
  // The "Open Building Watch" button under the message.
  if (link) body.cardsV2 = [{ cardId: 'bw', card: { sections: [{ widgets: [{ buttonList: { buttons: [
    { text: 'Open Building Watch', onClick: { openLink: { url: link } } }] } }] }] } }];
  var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = r.getResponseCode();
  return code >= 200 && code < 300 ? { sent: true } : { sent: false, code: code, error: String(r.getContentText()).slice(0, 300) };
}
// Post with an @mention; if Chat refuses the mention, post again naming the person in plain text.
// chatPostMention_: sends with an @mention. If Chat refuses the mention,
// sends again with the plain name, so the ping still goes out.
function chatPostMention_(person, build, threadKey, link) {
  var r = chatPost_(build(mention_(person)), threadKey, link);
  if (!r.sent && r.code === 400 && person && person.chatId) r = chatPost_(build(Core.nm(person)), threadKey, link);
  return r;
}
// helpThread_: the thread name for one help request.
function helpThread_(l) { return 'help-' + l.id + '-' + Date.parse(l.helpAt); }
// pageAssistance_: the ping sent when a worker asks for help.
function pageAssistance_(st, l) {
  var r = chatPostMention_(responder_(st), function (who) {
    return '\uD83D\uDD14 Maintenance assistance requested. ' + who + ', please check Building Watch.';
  }, helpThread_(l), appLink_(st));
  if (!r.sent && r.error) Logger.log('Chat ping not sent: ' + r.error);
  return r;
}
// pageAckReply_: the "Name is responding." reply in the same thread.
// Sent once, and only for the person who just pressed the button.
function pageAckReply_(st, email, logId) {
  var l = st.log.filter(function (x) { return x.id === logId; })[0], me = Core.findEmail(st, email);
  // Post once per acknowledgment, and only for the person who just pressed Responding.
  if (!l || !me || !l.helpAckAt || l.helpAckById !== me.id || l.helpAckChat === l.helpAckAt) return;
  l.helpAckChat = l.helpAckAt; st._dirty.log = true;
  try {
    var r = chatPost_('\u2705 ' + Core.nm(me) + ' is responding.', helpThread_(l), '');
    if (!r.sent && r.error && chatStatus_().configured) st._warn.push('Chat space was not updated: ' + r.error);
  } catch (ex) { Logger.log('Chat reply failed: ' + ex); }
}
// chatSave_: an admin pastes the webhook address in the Admin tab. It is
// checked, cleaned, and stored in Script Properties.
function chatSave_(st, email, P) {
  requireAdmin_(st, email);
  var url = String(P.url || '').trim()
    .replace(/&?(messageReplyOption|threadKey)=[^&]*/g, '').replace('?&', '?');
  if (!CHAT_URL_RE.test(url) || !/[?&]key=/.test(url) || !/[?&]token=/.test(url))
    throw err_('input', 'That is not a Google Chat webhook URL. Copy it from the space: Apps & integrations, Webhooks.');
  props_().setProperty(CHAT_PROP, url);
  st.audit.push({ t: H.nowISO(), who: Core.nm(Core.findEmail(st, email)), action: 'chat.connect', detail: chatStatus_().space });
  st._dirty.audit = true; saveStore_(openSheet_(), st);
  return chatStatus_();
}
// chatClear_: an admin disconnects the pager.
function chatClear_(st, email) {
  requireAdmin_(st, email);
  props_().deleteProperty(CHAT_PROP);
  return chatStatus_();
}
// chatTest_: the "Send test ping" button. @mentions the admin who pressed it.
function chatTest_(st, email) {
  var me = requireAdmin_(st, email);
  if (!chatStatus_().configured) throw err_('input', 'Save the webhook URL first.');
  var r = chatPostMention_(me, function (who) {
    return '\uD83D\uDD14 Building Watch pager test. ' + who + ', this space will get a ping when a maintenance worker asks for help.';
  }, 'bw-test-' + Date.now(), appLink_(st));
  if (!r.sent) throw err_('chat', 'Chat did not accept the test ping' + (r.code ? ' (' + r.code + ')' : '') + '. Check the webhook URL and that webhooks are allowed.');
  return { sent: true, mentioned: !!me.chatId, space: chatStatus_().space };
}

// ---------------------------------------------------------------------
// ARCHIVING: keeps the working tabs small so the app stays fast.
// Once a night, rows older than about a year (audit lines older than 90
// days) are moved to "Archive: ..." tabs in the same spreadsheet.
// Nothing is deleted; it is moved.
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Archiving: keeps the live tabs small so every request stays fast.   */
/* Run installArchiveTrigger() once; it schedules archiveOld() nightly. */
/* ------------------------------------------------------------------ */
// archiveOld: runs nightly once installArchiveTrigger has been run.
function archiveOld() {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var st = readStore_(openSheet_()); st._dirty = {}; st._warn = [];
    // cut = the date about 400 days ago; older rows are archived.
    var cut = Utilities.formatDate(new Date(Date.now() - ARCHIVE_DAYS * 86400000), tz_(), "yyyy-MM-dd");
    var auditCut = new Date(Date.now() - 90 * 86400000).toISOString();
    // What counts as old enough to move, for each list. Open maintenance
    // requests and workers still in the building are never moved.
    var rules = {
      avail:    function (a) { return a.date < cut; },
      watches:  function (w) { return w.date < cut; },
      requests: function (r) { return r.date < cut && r.status === "Closed"; },
      log:      function (l) { return l.date < cut && l.out !== "" && l.out != null; },
      audit:    function (a) { return String(a.t) < auditCut; }
    };
    var moved = {};
    Object.keys(rules).forEach(function (key) {
      var old = st[key].filter(rules[key]);
      if (!old.length) return;
      // Copy to the archive first. If anything is interrupted, the worst case is
      // a row in both places, never a row lost.
      // Copy to the archive first: an interruption leaves a duplicate, never a lost row.
      var arch = tabSheet_(key, "Archive: " + TAB_NAMES[key]), header = headerFor_(arch, key);
      st[key].forEach(function (r) { if (r._x) Object.keys(r._x).forEach(function (h) { if (header.indexOf(h) < 0) header.push(h); }); });
      var start = Math.max(arch.getLastRow(), 1) + 1;
      arch.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
      arch.getRange(start, 1, old.length, header.length).setNumberFormat("@").setValues(rowValues_(key, old, header));
      // Then remove the moved rows from the working tab.
      st[key] = st[key].filter(function (r) { return !rules[key](r); });
      writeTab_(null, key, st[key]);
      moved[key] = old.length;
    });
    Logger.log("Archived: " + JSON.stringify(moved));
    return moved;
  } finally { lock.releaseLock(); }
}
// installArchiveTrigger: run once from the editor to schedule archiveOld
// every night around 0200. Running it again does not create a duplicate.
function installArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "archiveOld") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("archiveOld").timeBased().everyDays(1).atHour(2).create();
  Logger.log("archiveOld() will run nightly around 0200.");
}

// ---------------------------------------------------------------------
// ONE-TIME SET-UP
// ---------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* One-time setup: run this from the editor after filling in SETUP     */
/* ------------------------------------------------------------------ */
// setup: run once from the editor after filling in SETUP at the top.
// Connects the spreadsheets, stores the sign-in client ID, sets the app
// address, and makes the person running it the first admin and manager.
// Safe to run again: it does not undo a calendar choice.
function setup() {
  if (/PASTE/.test(SETUP.CLIENT_ID)) throw new Error("Paste your Web OAuth client ID into SETUP.CLIENT_ID first.");
  Object.keys(SETUP.SHEETS).forEach(function (key) {
    SpreadsheetApp.openById(SETUP.SHEETS[key]);
  });
  props_().setProperty("SHEET_MAP", JSON.stringify(SETUP.SHEETS));
  props_().setProperty("CLIENT_ID", SETUP.CLIENT_ID.trim());
  var ss = openSheet_();
  var st = readStore_(ss);
  st._dirty = {}; st._warn = [];
  st.settings.appUrl = SETUP.APP_URL_OVERRIDE || SETUP.APP_URL;
  // Do not overwrite a calendar choice when setup() is rerun for updates.
  if (!st.settings.calId) st.settings.calId = '';
  if (!st.settings.calName) st.settings.calName = 'Choose a Google Calendar';
  if (typeof st.settings.invites !== 'boolean') st.settings.invites = false;
  var owner = Session.getEffectiveUser().getEmail();
  var me = Core.findEmail(st, owner);
  if (!me) {
    me = Core.newPerson(owner, SETUP.FIRST_ADMIN_NAME, "Admin", H.nowISO());
    me.joinedAt = H.nowISO();
    st.people.push(me);
  } else { me.role = "Admin"; me.active = true; }
  st.settings.manager = me.id;
  saveStore_(ss, st, true);
  Logger.log('Test setup complete: five Sheets and test emails enabled; select a calendar in Admin to publish.');
  Logger.log("First admin: " + owner);
}

// =====================================================================
// HOW TO READ THIS FILE (for non-programmers)
// =====================================================================
// Lines that start with two slashes, like this one, are notes for people.
// The computer ignores them completely. Everything else is instructions.
//
// This file is the "rule book" of Building Watch. It decides who is allowed
// to do what, how schedules are stored, and how each request is handled.
// The same rule book runs in two places:
//   1. In Google Apps Script (the backend), as the file Core.gs, where it
//      works on the real Google Sheets.
//   2. In the web browser, when the app runs in demo mode with sample data.
// Because both use the identical file, the demo always behaves like the
// real system.
//
// A few words that appear often:
//   st      the whole "store": every list the app keeps (people, schedules,
//           maintenance log, and so on), loaded from the Google Sheets.
//   me      the person who is signed in and making the request.
//   P       the details sent with a request (for example the date and
//           times of a watch).
//   H       "helpers" supplied by whoever runs this file. In Apps Script
//           they send real email and touch the real calendar; in the demo
//           they only pretend, using sample data and sending nothing.
//           This file never contacts Google directly.
//   slot    one half-hour block of the day. Slot 0 starts at 0730,
//           slot 1 at 0800, and so on, up to slot 32 (2330 to 2400).
// =====================================================================
/*
 * Building Watch core logic.
 * Shared by the Google Apps Script backend (copy this file into the script as Core.gs)
 * and by the in-browser demo. No browser or Google APIs are used here; anything that
 * touches the outside world goes through the hooks object H.
 */
// "Core" is a sealed package: everything defined inside it stays private
// unless it is listed at the very bottom of this file, where it is handed
// out for the rest of the app to use.
var Core = (function () {
  /* Time grid. Slot i covers START + 30*i minutes after midnight.
   * START must never change: every stored availability string and watch index depends on it.
   * NS may grow (extended hours); shorter stored strings are padded on read. */
  // Minutes after midnight when the day's first half-hour starts (450 = 0730).
  var START = 450;      // first slot starts 0730 (minutes after midnight)
  // How many half-hour blocks one day has: 33 blocks covers 0730 to 2400.
  var NS = 33;          // half-hour slots per day: 0730 to 2400
  // How many blocks the day had before "extended hours" existed (0730 to 1600).
  // Older copies of the app may still send schedules this long.
  var LEGACY_NS = 17;   // grid before extended hours (0730 to 1600); older clients still send this
  // The duty day, 0800 to 1600, as block numbers (from block 1 up to, but not
  // including, block 17). Rows outside it are shaded on screen.
  var DUTY = [1, 17];   // duty day 0800 to 1600 (rows outside it are shaded)
  // What the schedule grids show by default: 0730 to 1600.
  var VIEW = [0, 17];   // default view 0730 to 1600, so early arrivals stay visible
  // The usual watch windows, 0800 to 1000 and 1400 to 1600, marked on the
  // watch bill so the scheduler can see them at a glance.
  var STD_WATCH = [[1, 5], [13, 17]]; // usual watches 0800 to 1000 and 1400 to 1600
  // The pattern a personal calendar link must match: it has to be a web
  // address starting with https:// or webcal:// (a "secret iCal" link).
  var ICAL = /^(https|webcal):\/\/[^\s]+$/i;
  // Contractor contact details are for admins only; checkout tokens never leave the server.
  // Fields of the maintenance log that never leave the server: the secret
  // codes behind each worker's personal sign-out link.
  var LOG_SECRET = ["tokenHash", "tokenExpiry"];
  // Fields only admins may see: the worker's email address and the records
  // of which emails were sent.
  var LOG_ADMIN_ONLY = ["email", "emailConsent", "workerEmailSentAt", "watchArrivalAlertTo", "watchDepartureAlertTo"];
  // The stages a maintenance request moves through.
  var STATUSES = ["Open", "Submitted to PW", "In progress", "Closed"];
  // The default checklist a watchstander works through each watch.
  // Admins can change it in the app.
  var DEF_TMPL = [
    "Walk all decks and stairwells",
    "Check exterior doors are secured",
    "Check rehearsal halls: lights, HVAC, thermostats",
    "Check heads for leaks or outages",
    "Turn any problems into service requests"
  ];

  // ---------------------------------------------------------------------
  // SMALL HELPER TOOLS used throughout the file
  // ---------------------------------------------------------------------
  // E: builds an error with a short code ("input", "forbidden", ...) and a
  // message the user will see, such as "Enter your name."
  function E(code, msg) { var e = new Error(msg); e.code = code; return e; }
  // lc: tidies text for comparing, by removing extra spaces and making it
  // lowercase, so "Worf@Navy.mil " and "worf@navy.mil" count as the same.
  function lc(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  // str: tidies text a person typed and cuts it to a maximum length, so
  // nobody can store a huge block of text.
  function str(s, max) { return String(s == null ? "" : s).trim().slice(0, max || 500); }
  // uid: makes a random identification code (like "k3j9x0a2b7c1") for each
  // new record, so records can be found again later.
  function uid() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }
  // byId: looks through a list and returns the record with the given code.
  function byId(a, id) { for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  // uniq: removes duplicates from a list.
  function uniq(a) { var o = [], s = {}; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  // isDate: checks that text looks like a date written YYYY-MM-DD.
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
  // isEmail: checks that text looks like an email address (something@something.something).
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s)); }
  // addDays: moves a YYYY-MM-DD date forward or back by a number of days.
  function addDays(s, n) {
    var p = s.split("-");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  // nm: the name to show for a person (their email if they have no name yet).
  function nm(p) { return p ? (p.name || p.email) : ""; }
  // isOut: true when a maintenance worker has been checked out (has an "out" time).
  function isOut(l) { return l.out !== "" && l.out != null; }
  // zeros: makes a string of that many "0" characters, meaning "not here" blocks.
  function zeros(n) { return n > 0 ? new Array(n + 1).join("0") : ""; }
  // fitSlots: makes a person's day exactly 33 blocks long. Older, shorter days
  // are padded with "not here" at the end, so nothing already saved moves.
  function fitSlots(s) { s = String(s || ""); return s.length >= NS ? s.slice(0, NS) : s + zeros(NS - s.length); }
  // grid: describes the time grid (start, length, duty day, default view,
  // usual watches) so the screen can draw it the same way the server stores it.
  function grid() { return { start: START, ns: NS, duty: DUTY.slice(), view: VIEW.slice(), std: STD_WATCH.map(function (x) { return x.slice(); }) }; }
  // logView: makes a copy of one maintenance log entry that is safe to send
  // to a browser. Secret sign-out codes are always removed; the worker's email
  // is removed unless the viewer is an admin.
  function logView(l, admin) {
    var o = {};
    Object.keys(l).forEach(function (k) {
      // Skip internal fields (names starting with "_") and the secret codes.
      if (k.charAt(0) === "_" || LOG_SECRET.indexOf(k) >= 0) return;
      // Skip the worker's contact details for anyone who is not an admin.
      if (!admin && LOG_ADMIN_ONLY.indexOf(k) >= 0) return;
      o[k] = l[k];
    });
    return o;
  }

  // ---------------------------------------------------------------------
  // SETTINGS AND STORE SET-UP
  // ---------------------------------------------------------------------
  // defaults: the starting settings used whenever a setting has never been saved.
  function defaults() {
    return {
      // calId/calName: which Google Calendar the watch bill is published to.
      // invites: send calendar invitations to the person on watch.
      // remind: minutes before a watch to show a reminder.
      // watchPhone: the phone number workers can call to reach the watch.
      calId: "", calName: "Building Watch", invites: true, remind: 30, watchPhone: "",
      // manager: the building manager. acting: a stand-in manager for set dates.
      manager: "", acting: { pid: "", from: "", to: "" },
      // tmpl: the watch checklist. appUrl: the app's web address, used in emails.
      // mailLog: a short history of group emails sent from the app.
      tmpl: DEF_TMPL.slice(), appUrl: "", mailLog: []
    };
  }
  // ensure: makes sure every list and setting exists before any work starts,
  // so a brand-new or partly empty spreadsheet never causes a crash.
  function ensure(st) {
    // Create any missing list as an empty list.
    ["people", "avail", "watches", "requests", "log", "audit", "crewAssignments", "crewActivity"].forEach(function (k) { st[k] = st[k] || []; });
    var d = defaults(), s = st.settings || {};
    // Fill in any missing setting with its default.
    Object.keys(d).forEach(function (k) { if (s[k] === undefined || s[k] === "") s[k] = d[k]; });
    if (!s.acting || typeof s.acting !== "object") s.acting = { pid: "", from: "", to: "" };
    st.settings = s;
    // Pad any availability saved under the old shorter day to the full day.
    st.avail.forEach(function (a) { if (String(a.slots || "").length !== NS) a.slots = fitSlots(a.slots); });
    // _dirty remembers which lists changed, so only those tabs are saved.
    // _warn collects warnings to show the user (for example "calendar not found").
    st._dirty = st._dirty || {};
    st._warn = st._warn || [];
    return st;
  }
  // touch: marks one or more lists as changed so they get saved to the sheet.
  function touch(st) { for (var i = 1; i < arguments.length; i++) st._dirty[arguments[i]] = 1; }
  // findEmail: finds the person with a given email address, or nothing.
  function findEmail(st, email) {
    email = lc(email);
    for (var i = 0; i < st.people.length; i++) if (lc(st.people[i].email) === email) return st.people[i];
    return null;
  }
  // newPerson: creates a new person record. Everyone starts as a Member
  // (unless made an Admin), able to stand watch, and active.
  function newPerson(email, name, role, nowISO) {
    return { id: uid(), email: lc(email), name: str(name, 80), role: role === "Admin" ? "Admin" : "Member",
      watch: true, active: true, phone: "", cals: [], invitedAt: nowISO, joinedAt: "" };
  }
  // inChargeId: who is in charge on date t. If an acting manager is set and
  // today is within their dates, it is them; otherwise the building manager.
  function inChargeId(st, t) {
    var a = st.settings.acting;
    if (a && a.pid && (!a.from || a.from <= t) && (!a.to || a.to >= t)) return a.pid;
    return st.settings.manager;
  }
  // isAdmin: true for active people who are Admins, the building manager,
  // or whoever is in charge today (an acting manager gets admin rights).
  function isAdmin(st, p, t) {
    return !!p && p.active !== false && (p.role === "Admin" || p.id === st.settings.manager || p.id === inChargeId(st, t));
  }
  // runs: turns a day's blocks (like "0011100110") into time ranges
  // (blocks 2 to 5, and 7 to 9). Used when writing calendar events.
  function runs(slots) {
    var out = [], s = -1;
    for (var i = 0; i <= NS; i++) {
      var on = i < NS && slots.charAt(i) === "1";
      if (on && s < 0) s = i;
      if (!on && s >= 0) { out.push([s, i]); s = -1; }
    }
    return out;
  }
  // pub: the version of a person that is safe to send to a browser.
  // Everyone sees name, role and whether they stand watch.
  // Admins ("full") also see email, phone, status and setup details.
  function pub(p, full) {
    var o = { id: p.id, name: nm(p), role: p.role, watch: p.watch !== false };
    if (full) {
      o.email = p.email; o.phone = p.phone || ""; o.active = p.active !== false;
      o.invitedAt = p.invitedAt || ""; o.joinedAt = p.joinedAt || "";
      o.calCount = (p.cals || []).filter(function (c) { return c.on; }).length;
      // chatReady: whether the Chat pager can @mention this person yet.
      // It becomes true after they sign in once.
      o.chatReady = !!p.chatId;   // can be @mentioned by the Chat pager (learned at sign-in)
    }
    return o;
  }
  // audit: writes one line to the audit trail: when, who, what, and details.
  function audit(st, p, action, detail, H) {
    // Audit rows are never dropped here; the backend's archiveOld() moves old rows to an archive tab.
    st.audit.push({ t: H.nowISO(), who: nm(p), action: action, detail: str(detail, 300) });
    touch(st, "audit");
  }
  // publicSettings: the settings a browser is allowed to see.
  // Admins also see the recent group email history.
  function publicSettings(st, admin) {
    var s = st.settings;
    var o = { calName: s.calName, calId: s.calId, invites: s.invites, remind: s.remind, tmpl: s.tmpl,
      appUrl: s.appUrl, manager: s.manager, acting: s.acting, watchPhone: s.watchPhone || "" };
    if (admin) o.mailLog = (s.mailLog || []).slice(-10);
    return o;
  }
  // newReq: creates a maintenance (service) request and adds it to the list.
  // Priority must be Routine, Urgent or Emergency; anything else becomes Routine.
  function newReq(st, me, t, loc, issue, pri) {
    var r = { id: uid(), date: t, by: nm(me), byId: me.id, loc: str(loc, 120) || "Not given",
      issue: str(issue, 1000), pri: ["Routine", "Urgent", "Emergency"].indexOf(pri) >= 0 ? pri : "Routine",
      status: "Open", wo: "" };
    st.requests.push(r); touch(st, "requests");
    return r;
  }

  // =====================================================================
  // handle: THE MAIN ENTRY POINT. Every request from the app comes here.
  //   st      the store (all the lists)
  //   email   the verified email of the person asking
  //   action  what they want to do, such as "load" or "watch.save"
  //   P       the details of the request
  //   H       the helpers that reach the outside world
  // It checks permission, does the work, and returns the answer.
  // =====================================================================
  function handle(st, email, action, P, H) {
    ensure(st);
    P = P || {};
    // t = today's date (YYYY-MM-DD) in the building's time zone.
    var t = H.today();
    // me = the person making the request, looked up by email.
    var me = findEmail(st, email);

    // "whoami": the first question the app asks after sign-in.
    // Answers "denied" (not on the list), "profile" (needs to fill in name and
    // phone first), or "ok".
    if (action === "whoami") {
      if (!me || me.active === false) return { status: "denied", email: lc(email) };
      return { status: me.joinedAt ? "ok" : "profile", me: pub(me, true) };
    }
    // Everything below requires an active person on the list.
    if (!me || me.active === false) throw E("denied", "You don't have access. Ask an admin to add " + lc(email) + ".");
    // admin = whether this person has admin rights today.
    var admin = isAdmin(st, me, t);
    // need: stops the request unless the person is an admin.
    function need() { if (!admin) throw E("forbidden", "Only admins can do that."); }
    // person: finds someone by code, or stops with "Person not found."
    function person(id) { var p = byId(st.people, id); if (!p) throw E("missing", "Person not found."); return p; }

    // Now do the requested action. Each "case" below is one kind of request.
    switch (action) {

      /* ---------- profile and personal calendars ---------- */
      // Save my name and phone. The first time, also records when I joined,
      // shares the main calendar with me, and notes it in the audit trail.
      case "profile.save": {
        var name = str(P.name, 80);
        if (!name) throw E("input", "Enter your name.");
        me.name = name; me.phone = str(P.phone, 40);
        if (!me.joinedAt) { me.joinedAt = H.nowISO(); H.shareCal(st, me.email, true); audit(st, me, "joined", "", H); }
        touch(st, "people");
        return pub(me, true);
      }
      // Save my personal calendar links (up to 5), shown faintly behind my week
      // so I can see what I already have on.
      case "cals.save": {
        var cals = (P.cals || []).slice(0, 5).map(function (c) {
          return { label: str(c.label, 60) || "My calendar", url: str(c.url, 600), on: !!c.on };
        }).filter(function (c) { return c.url; });
        // Only secret iCal links. A bare calendar ID would be read with the app owner's access.
        // A new bad entry is refused; an old one saved before this rule is dropped so it can't block the save.
        var had = (me.cals || []).map(function (c) { return c.url; });
        cals = cals.filter(function (c) {
          if (ICAL.test(c.url)) return true;
          if (had.indexOf(c.url) < 0) throw E("input", "\"" + c.label + "\" isn't an iCal link. Paste the calendar's secret address in iCal format (it starts with https:// or webcal://).");
          st._warn.push("\"" + c.label + "\" was removed because it isn't an iCal link. Add it again using its secret iCal address.");
          return false;
        });
        me.cals = cals; touch(st, "people");
        return cals;
      }
      // "busy": read my personal calendars for this week and return the busy
      // times. Only secret iCal links are read; anything else is skipped with a
      // warning.
      case "busy": {
        var on = (me.cals || []).filter(function (c) { return c.on; });
        on.forEach(function (c) { if (!ICAL.test(c.url)) st._warn.push("\"" + c.label + "\" was skipped. Remove it and add it again using its secret iCal address."); });
        on = on.filter(function (c) { return ICAL.test(c.url); });
        if (!on.length || !(P.week || []).length) return [];
        return H.fetchBusy(st, on, P.week);
      }

      /* ---------- load a week ---------- */
      // "load": everything the app needs to draw one week, filtered to what this
      // person may see.
      case "load": {
        // wk = the dates of the requested week.
        var wk = (P.week || []).filter(isDate);
        if (!wk.length) throw E("input", "Bad week.");
        var inWk = function (d) { return wk.indexOf(d) >= 0; };
        // counts = how many watches each person has this month (used for fairness
        // when suggesting who should stand the next watch).
        var month = wk[0].slice(0, 7), counts = {};
        st.watches.forEach(function (w) { if (w.date.slice(0, 7) === month) counts[w.pid] = (counts[w.pid] || 0) + 1; });
        // since = 30 days ago (older finished log entries are left out).
        var since = addDays(t, -30);
        var ic = byId(st.people, inChargeId(st, t)), mg = byId(st.people, st.settings.manager);
        var meFull = pub(me, true); meFull.cals = me.cals || [];
        // The answer sent back to the app:
        return {
          me: meFull, admin: admin, today: t, grid: grid(),
          inCharge: nm(ic), manager: nm(mg),
          // people: everyone active (admins also see deactivated people).
          people: st.people.filter(function (p) { return admin || p.active !== false; }).map(function (p) { return pub(p, admin); }),
          // avail: when people are in the building. Admins see everyone's; members
          // see only their own.
          avail: st.avail.filter(function (a) { return inWk(a.date) && (admin || a.pid === me.id); })
            .map(function (a) { return { pid: a.pid, date: a.date, slots: a.slots }; }),
          // watches: the watch bill for this week.
          watches: st.watches.filter(function (w) { return inWk(w.date); })
            .map(function (w) { return { id: w.id, pid: w.pid, date: w.date, s: +w.s, e: +w.e, checks: w.checks || {} }; }),
          // monthCounts: watches per person this month.
          monthCounts: counts,
          // crewAssignments / crewActivity: facilities projects. Admins see all;
          // members see only the ones assigned to them.
          crewAssignments: st.crewAssignments.filter(function (x) { return admin || (x.assignees || []).indexOf(me.id) >= 0; }).map(function (x) { return Object.assign({}, x); }),
          crewActivity: st.crewActivity.filter(function (x) { return admin || st.crewAssignments.some(function (a) { return a.id === x.assignmentId && (a.assignees || []).indexOf(me.id) >= 0; }); }).slice(-500),
          // requests: the most recent maintenance requests.
          requests: st.requests.slice(-400),
          // log: maintenance workers in the building and recent visits, made safe
          // for this viewer by logView.
          log: st.log.filter(function (l) { return !isOut(l) || l.date >= since; }).slice(-400).map(function (l) { return logView(l, admin); }),
          settings: publicSettings(st, admin)
        };
      }

      /* ---------- my time in the building ---------- */
      // "avail.save": save the times I will be in the building, one day at a time.
      // Each day arrives as a string of 33 "1"/"0" characters, one per half hour.
      case "avail.save": {
        var days = P.days || {}, n = 0;
        Object.keys(days).forEach(function (date) {
          if (!isDate(date)) return;
          var slots = String(days[date]);
          // Ignore anything that is not a proper string of 1s and 0s of a known length.
          if (!/^[01]+$/.test(slots) || (slots.length !== NS && slots.length !== LEGACY_NS)) return;
          // Find my existing record for that day, if any.
          var rec = null, idx = -1;
          for (var i = 0; i < st.avail.length; i++) if (st.avail[i].pid === me.id && st.avail[i].date === date) { rec = st.avail[i]; idx = i; }
          // An older client only knows 0730 to 1600: keep whatever evening time is already saved.
          if (slots.length === LEGACY_NS) slots = fitSlots(slots + (rec ? fitSlots(rec.slots).slice(LEGACY_NS) : ""));
          // Nothing changed for this day: skip it.
          if (rec && rec.slots === slots) return;
          // Let the helpers update any calendar entries for this day.
          var ev = H.syncAvail(st, me, date, slots, rec ? (rec.ev || []) : []);
          // A day with no time at all is deleted; otherwise update or add it.
          if (slots.indexOf("1") < 0) { if (idx >= 0) st.avail.splice(idx, 1); }
          else if (rec) { rec.slots = slots; rec.ev = ev; }
          else st.avail.push({ pid: me.id, date: date, slots: slots, ev: ev });
          n++;
        });
        touch(st, "avail");
        return { saved: n };
      }

      /* ---------- watch bill ---------- */
      // "watch.save": an admin sets who stands watch on a date between two blocks.
      // People already on watch in that window who were not chosen are removed,
      // and any longer watch they had is trimmed around the window.
      case "watch.save": {
        need();
        var date = P.date, s = +P.s, e = +P.e;
        // Check the date and that the window makes sense (end after start, within the day).
        if (!isDate(date) || !(s >= 0 && e <= NS && e > s)) throw E("input", "Bad watch window.");
        // pids = the people chosen (unknown codes are ignored).
        var pids = uniq((P.pids || []).filter(function (id) { return byId(st.people, id); }));
        // before = the people who were on watch somewhere in this window already.
        var before = uniq(st.watches.filter(function (w) { return w.date === date && +w.s < e && +w.e > s; }).map(function (w) { return w.pid; }));
        // cut: removes one person's watch time inside this window. If their watch
        // started before or ended after the window, the outside part is kept as a
        // separate, shorter watch.
        var cut = function (pid) {
          var keep = [], who = byId(st.people, pid);
          st.watches.forEach(function (w) {
            if (w.pid !== pid || w.date !== date || +w.e <= s || +w.s >= e) { keep.push(w); return; }
            H.eventDelete(st, w.ev);
            if (+w.s < s) { var a = { id: uid(), pid: pid, date: date, s: +w.s, e: s, checks: w.checks || {}, ev: "" }; a.ev = H.watchCreate(st, who, a); keep.push(a); }
            if (+w.e > e) { var b = { id: uid(), pid: pid, date: date, s: e, e: +w.e, checks: {}, ev: "" }; b.ev = H.watchCreate(st, who, b); keep.push(b); }
          });
          st.watches = keep;
        };
        // Remove people who were on watch here but were not chosen this time.
        before.forEach(function (pid) { if (pids.indexOf(pid) < 0) cut(pid); });
        // Add each chosen person, unless they already have exactly this watch.
        pids.forEach(function (pid) {
          var same = st.watches.filter(function (w) { return w.pid === pid && w.date === date && +w.s === s && +w.e === e; });
          if (same.length) return;
          cut(pid);
          var w = { id: uid(), pid: pid, date: date, s: s, e: e, checks: {}, ev: "" };
          w.ev = H.watchCreate(st, byId(st.people, pid), w);
          st.watches.push(w);
        });
        // Keep the watch bill in date and time order.
        st.watches.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.s - b.s; });
        touch(st, "watches");
        audit(st, me, "watch.save", date + " slots " + s + "-" + e + ": " + pids.map(function (id) { return nm(byId(st.people, id)); }).join(", "), H);
        return { ok: true };
      }
      // "check": tick or untick one checklist item on a watch.
      // Only the person on that watch, or an admin, may do this.
      case "check": {
        var w = byId(st.watches, P.wid);
        if (!w) throw E("missing", "Watch not found.");
        if (w.pid !== me.id && !admin) throw E("forbidden", "That isn't your watch.");
        w.checks = w.checks || {};
        if (P.on) w.checks[str(P.item, 200)] = 1; else delete w.checks[str(P.item, 200)];
        touch(st, "watches");
        return w.checks;
      }
      // "tmpl.save": an admin replaces the watch checklist (up to 40 items).
      case "tmpl.save": {
        need();
        st.settings.tmpl = (P.tmpl || []).map(function (x) { return str(x, 200); }).filter(String).slice(0, 40);
        touch(st, "settings");
        return st.settings.tmpl;
      }

      /* Crew assignments are separate from maintenance requests and watch duties. */
      // "crew.create": an admin creates a facilities project and assigns it to
      // one or more active crew members. It starts as "Assigned".
      case "crew.create": {
        need();
        var title = str(P.title, 150), assignees = uniq((P.assignees || []).filter(function (id) { var p = byId(st.people, id); return p && p.active !== false; }));
        if (!title || !assignees.length) throw E("input", "Enter a title and assign at least one crew member.");
        if (P.dueDate && !isDate(P.dueDate)) throw E("input", "Invalid due date.");
        var a = { id: uid(), title: title, description: str(P.description, 3000), location: str(P.location, 150),
          priority: ["Routine", "Urgent", "Emergency"].indexOf(P.priority) >= 0 ? P.priority : "Routine",
          dueDate: P.dueDate || "", assignees: assignees, status: "Assigned",
          createdBy: me.id, createdAt: H.nowISO(), submittedBy: "", submittedAt: "",
          approvedBy: "", approvedAt: "", returnNote: "", updatedAt: H.nowISO() };
        st.crewAssignments.push(a); touch(st, "crewAssignments");
        st.crewActivity.push({ eventId: uid(), assignmentId: a.id, personId: me.id, action: "Created", note: "", timestamp: H.nowISO() });
        touch(st, "crewActivity"); audit(st, me, "crew.create", a.id, H); return a;
      }
      // "crew.update": an admin edits a project that has not been approved yet.
      // Only the details actually sent are changed.
      case "crew.update": {
        need();
        var a = byId(st.crewAssignments, P.id);
        if (!a) throw E("missing", "Assignment not found.");
        if (a.status === "Approved") throw E("input", "Approved assignments are closed.");
        if (P.title !== undefined) { a.title = str(P.title, 150); if (!a.title) throw E("input", "Title required."); }
        if (P.description !== undefined) a.description = str(P.description, 3000);
        if (P.location !== undefined) a.location = str(P.location, 150);
        if (P.priority !== undefined) a.priority = ["Routine", "Urgent", "Emergency"].indexOf(P.priority) >= 0 ? P.priority : "Routine";
        if (P.dueDate !== undefined) { if (P.dueDate && !isDate(P.dueDate)) throw E("input", "Invalid date."); a.dueDate = P.dueDate; }
        if (P.assignees !== undefined) {
          a.assignees = uniq((P.assignees || []).filter(function (id) { var p = byId(st.people, id); return p && p.active !== false; }));
          if (!a.assignees.length) throw E("input", "Assign at least one person.");
        }
        a.updatedAt = H.nowISO(); touch(st, "crewAssignments");
        st.crewActivity.push({ eventId: uid(), assignmentId: a.id, personId: me.id, action: "Updated", note: str(P.note, 1000), timestamp: H.nowISO() });
        touch(st, "crewActivity"); return a;
      }
      // "crew.progress" adds a progress note; "crew.submit" sends the project to
      // the supervisor for approval. Allowed for the people assigned, or an admin.
      case "crew.progress":
      case "crew.submit": {
        var a = byId(st.crewAssignments, P.id);
        if (!a) throw E("missing", "Assignment not found.");
        if (!admin && (a.assignees || []).indexOf(me.id) < 0) throw E("forbidden", "Not assigned to this project.");
        if (a.status === "Approved") throw E("input", "This project is closed.");
        if (a.status === "Pending approval") throw E("input", "Awaiting supervisor review.");
        var note = str(P.note, 1500);
        if (action === "crew.progress" && !note) throw E("input", "Enter a progress note.");
        if (action === "crew.submit") { a.status = "Pending approval"; a.submittedBy = me.id; a.submittedAt = H.nowISO(); a.returnNote = ""; }
        else if (a.status !== "In progress") a.status = "In progress";
        a.updatedAt = H.nowISO(); touch(st, "crewAssignments");
        st.crewActivity.push({ eventId: uid(), assignmentId: a.id, personId: me.id, action: action === "crew.submit" ? "Submitted" : "Progress", note: note, timestamp: H.nowISO() });
        touch(st, "crewActivity"); return a;
      }
      // "crew.review": an admin approves a submitted project (closing it) or
      // returns it with a note explaining what to fix.
      case "crew.review": {
        need();
        var a = byId(st.crewAssignments, P.id);
        if (!a) throw E("missing", "Assignment not found.");
        if (a.status !== "Pending approval") throw E("input", "Assignment has not been submitted.");
        if (P.decision !== "approve" && P.decision !== "return") throw E("input", "Invalid decision.");
        var note = str(P.note, 1500);
        if (P.decision === "return" && !note) throw E("input", "Explain what needs correction.");
        a.status = P.decision === "approve" ? "Approved" : "Returned";
        a.returnNote = P.decision === "return" ? note : "";
        a.approvedBy = P.decision === "approve" ? me.id : "";
        a.approvedAt = P.decision === "approve" ? H.nowISO() : "";
        a.updatedAt = H.nowISO(); touch(st, "crewAssignments");
        st.crewActivity.push({ eventId: uid(), assignmentId: a.id, personId: me.id, action: P.decision === "approve" ? "Approved" : "Returned", note: note, timestamp: H.nowISO() });
        touch(st, "crewActivity"); audit(st, me, "crew.review", a.id + " " + a.status, H); return a;
      }

      /* ---------- service requests ---------- */
      // "req.new": anyone signed in can report a maintenance problem.
      case "req.new": {
        if (!str(P.issue)) throw E("input", "Describe the problem.");
        var r = newReq(st, me, t, P.loc, P.issue, P.pri);
        return r;
      }
      // "req.update": an admin changes a request's status or work order number.
      case "req.update": {
        need();
        var r2 = byId(st.requests, P.id);
        if (!r2) throw E("missing", "Request not found.");
        if (P.status !== undefined && STATUSES.indexOf(P.status) >= 0) r2.status = P.status;
        if (P.wo !== undefined) r2.wo = str(P.wo, 40);
        touch(st, "requests");
        return r2;
      }

      /* ---------- maintenance log ---------- */
      // "log.in": a watchstander checks a maintenance worker into the building
      // from the app. Records who, which shop, what job, and the arrival time.
      // (Workers who use the QR code are checked in by the backend instead.)
      case "log.in": {
        if (!str(P.worker)) throw E("input", "Enter the worker's name.");
        // If the visit is for an existing request, link it and mark it "In progress".
        var link = P.req ? byId(st.requests, P.req) : null;
        var l = { id: uid(), date: t, worker: str(P.worker, 80), shop: str(P.shop, 80), req: link ? link.id : "",
          task: str(P.task, 300) || (link ? link.loc + ": " + link.issue : ""), in: H.nowMin(), out: "",
          done: '', fu: '', ret: '', prob: '', newReq: '', by: nm(me), fuClosed: false,
          email: str(P.email, 120).toLowerCase(), emailConsent: !!P.emailConsent,
          // Fields filled in later: the worker's personal sign-out link, departure
          // times, an assistance request, and who responded to it.
          tokenHash: '', tokenExpiry: '', workerOutAt: '', watchOutAt: '', watchSeenAt: '', outBy: '',
          inAt: H.nowISO(), helpAt: '', helpLocation: '', helpMessage: '',
          helpAckBy: '', helpAckById: '', helpAckAt: '', helpAckChat: '' };
        st.log.push(l);
        if (link && (link.status === "Open" || link.status === "Submitted to PW")) { link.status = "In progress"; touch(st, "requests"); }
        touch(st, "log");
        return logView(l, admin);
      }
      // "log.out": check a worker out and record whether the job was finished,
      // any follow-up, a return date, and any new problem found.
      case "log.out": {
        var l2 = byId(st.log, P.id);
        if (!l2) throw E("missing", "Log entry not found.");
        // If the watchstander already checked them out, do not do it twice.
        if (l2.watchOutAt) throw E('input', l2.worker + ' has already been checked out by the watchstander.');
        if (!isOut(l2)) l2.out = Math.max(H.nowMin(), +l2.in);
        l2.done = ["Yes", "Partly", "No"].indexOf(P.done) >= 0 ? P.done : "Yes";
        l2.fu = str(P.fu, 1000); l2.ret = isDate(P.ret) ? P.ret : ""; l2.prob = str(P.prob, 1000);
        // A new problem can become a new maintenance request automatically.
        if (l2.prob && P.make) l2.newReq = newReq(st, me, t, P.loc, l2.prob, "Routine").id;
        // A linked request is closed if the job was finished with no follow-up;
        // otherwise it stays "In progress".
        if (l2.req) {
          var lr = byId(st.requests, l2.req);
          if (lr) { lr.status = l2.done === "Yes" && !l2.fu ? "Closed" : "In progress"; touch(st, "requests"); }
        }
        touch(st, "log");
        return logView(l2, admin);
      }
      /* Someone signed in says they are responding to a worker's assistance request. */
      case "log.ack": {
        var la = byId(st.log, P.id);
        if (!la) throw E("missing", "Log entry not found.");
        if (!la.helpAt) throw E("input", "This worker hasn't asked for assistance.");
        // Already acknowledged for this request: first responder stands, nothing changes.
        // Someone already answered this request: keep the first responder.
        if (la.helpAckAt && la.helpAckAt >= la.helpAt) return logView(la, admin);
        // Record who is responding and when. The backend then replies in the Chat
        // pager thread so everyone knows the request is covered.
        la.helpAckBy = nm(me); la.helpAckById = me.id; la.helpAckAt = H.nowISO();
        touch(st, "log"); audit(st, me, "log.ack", la.id, H);
        return logView(la, admin);
      }
      // "log.resolve": an admin marks a visit's follow-up as resolved.
      case "log.resolve": {
        need();
        var l3 = byId(st.log, P.id); if (!l3) throw E("missing", "Log entry not found.");
        l3.fuClosed = true; touch(st, "log");
        return logView(l3, admin);
      }
      // "log.makeReq": turn a problem noted at check-out into a maintenance request.
      case "log.makeReq": {
        var l4 = byId(st.log, P.id); if (!l4) throw E("missing", "Log entry not found.");
        if (!l4.prob || l4.newReq) return logView(l4, admin);
        l4.newReq = newReq(st, me, t, P.loc || "See description", l4.prob, "Routine").id;
        touch(st, "log");
        return logView(l4, admin);
      }

      /* ---------- reports ---------- */
      // "range": an admin pulls everything between two dates for the Reports tab.
      case "range": {
        need();
        if (!isDate(P.from) || !isDate(P.to)) throw E("input", "Pick both dates.");
        var inR = function (d) { return d >= P.from && d <= P.to; };
        return {
          people: st.people.map(function (p) { return pub(p, true); }),
          avail: st.avail.filter(function (a) { return inR(a.date); }).map(function (a) { return { pid: a.pid, date: a.date, slots: a.slots }; }),
          watches: st.watches.filter(function (w) { return inR(w.date); }).map(function (w) { return { id: w.id, pid: w.pid, date: w.date, s: +w.s, e: +w.e, checks: w.checks || {} }; }),
          log: st.log.filter(function (l) { return inR(l.date); }).map(function (l) { return logView(l, true); }),
          requests: st.requests.filter(function (r) { return inR(r.date); }),
          tmplLen: st.settings.tmpl.length
        };
      }

      /* ---------- admin: people ---------- */
      // "person.add": an admin adds someone by email (or re-activates them),
      // shares the calendar with them, and can email them an invitation.
      case "person.add": {
        need();
        var em = lc(P.email);
        if (!isEmail(em)) throw E("input", "Enter a valid email address.");
        var ex = findEmail(st, em);
        if (ex && ex.active !== false) throw E("input", em + " is already on the list.");
        var np;
        if (ex) { np = ex; np.active = true; np.role = P.role === "Admin" ? "Admin" : "Member"; if (P.name) np.name = str(P.name, 80); np.invitedAt = H.nowISO(); }
        else { np = newPerson(em, P.name, P.role, H.nowISO()); st.people.push(np); }
        H.shareCal(st, np.email, true);
        if (P.invite) H.sendInvite(st, np, nm(me));
        touch(st, "people");
        audit(st, me, "person.add", em + " as " + np.role, H);
        return pub(np, true);
      }
      // "person.update": an admin changes someone's details. Safety rules:
      // there must always be at least one admin, and nobody can deactivate themselves.
      case "person.update": {
        need();
        var p = person(P.id);
        var admins = function () { return st.people.filter(function (x) { return x.active !== false && x.role === "Admin"; }); };
        if (P.email !== undefined && lc(P.email) !== lc(p.email)) {
          var ne = lc(P.email);
          if (!isEmail(ne)) throw E("input", "Enter a valid email address.");
          if (findEmail(st, ne)) throw E("input", ne + " is already used by someone else.");
          H.shareCal(st, p.email, false); p.email = ne; H.shareCal(st, ne, true);
          p.chatId = "";  // a new address may be a different Google account; relearned at next sign-in
        }
        if (P.name !== undefined) p.name = str(P.name, 80);
        if (P.phone !== undefined) p.phone = str(P.phone, 40);
        if (P.watch !== undefined) p.watch = !!P.watch;
        if (P.role !== undefined) {
          var role = P.role === "Admin" ? "Admin" : "Member";
          if (role === "Member" && p.role === "Admin" && admins().length <= 1) throw E("input", "Keep at least one admin.");
          p.role = role;
        }
        if (P.active !== undefined) {
          if (!P.active && p.role === "Admin" && admins().length <= 1) throw E("input", "Keep at least one admin.");
          if (!P.active && p.id === me.id) throw E("input", "You can't deactivate yourself.");
          if (!!P.active !== (p.active !== false)) H.shareCal(st, p.email, !!P.active);
          p.active = !!P.active;
        }
        touch(st, "people");
        audit(st, me, "person.update", nm(p), H);
        return pub(p, true);
      }
      // "person.invite": an admin re-sends someone's invitation email.
      case "person.invite": {
        need();
        var pi = person(P.id);
        H.sendInvite(st, pi, nm(me)); pi.invitedAt = H.nowISO();
        touch(st, "people");
        return pub(pi, true);
      }

      /* ---------- admin: settings ---------- */
      // "settings.save": an admin changes settings. Only the settings actually
      // sent are changed. A new calendar is tested before it is accepted.
      case "settings.save": {
        need();
        var S = st.settings;
        if (P.calId !== undefined && str(P.calId) !== S.calId) {
          var newId = str(P.calId, 300);
          var cname = H.testCal(st, newId);
          S.calId = newId;
          if (!P.calName) S.calName = cname;
          st.people.forEach(function (x) { if (x.active !== false) H.shareCal(st, x.email, true); });
        }
        if (P.calName !== undefined && str(P.calName)) S.calName = str(P.calName, 120);
        if (P.invites !== undefined) S.invites = !!P.invites;
        if (P.remind !== undefined) S.remind = +P.remind || 0;
        if (P.appUrl !== undefined) S.appUrl = str(P.appUrl, 300);
        if (P.watchPhone !== undefined) {
          var phone = str(P.watchPhone, 30);
          // A watch phone number may contain digits, spaces, + ( ) . and -.
          if (phone && !/^\+?[0-9().\s-]{7,25}$/.test(phone)) throw E("input", "Enter a valid watch telephone number.");
          S.watchPhone = phone;
        }
        // The manager and acting manager must be people on the list.
        if (P.manager !== undefined && byId(st.people, P.manager)) S.manager = P.manager;
        if (P.acting !== undefined) {
          var a = P.acting || {};
          S.acting = { pid: byId(st.people, a.pid) ? a.pid : "", from: isDate(a.from) ? a.from : "", to: isDate(a.to) ? a.to : "" };
        }
        touch(st, "settings");
        audit(st, me, "settings.save", "", H);
        return publicSettings(st, true);
      }
      // "mail.send": an admin emails chosen people from the app.
      case "mail.send": {
        need();
        var to = (P.pids || []).map(function (id) { return byId(st.people, id); })
          .filter(function (x) { return x && x.active !== false && isEmail(x.email); });
        if (!to.length) throw E("input", "Pick at least one recipient.");
        var subject = str(P.subject, 200) || "(no subject)";
        var n2 = H.sendMail(st, to.map(function (x) { return x.email; }), subject, str(P.body, 10000), nm(me));
        st.settings.mailLog = (st.settings.mailLog || []).concat([{ s: subject, n: n2, t: t, by: nm(me) }]).slice(-50);
        touch(st, "settings");
        audit(st, me, "mail.send", subject + " to " + n2, H);
        return { sent: n2 };
      }
      // "audit.list": an admin views the 200 most recent audit trail lines, newest first.
      case "audit.list": {
        need();
        return st.audit.slice(-200).reverse();
      }
    }
    // Any action name not listed above is refused.
    throw E("input", "Unknown action: " + action);
  }

  // ---------------------------------------------------------------------
  // What this package hands out to the rest of the app. Anything not listed
  // here stays private inside the rule book.
  // ---------------------------------------------------------------------
  return {
    NS: NS, START: START, LEGACY_NS: LEGACY_NS, DUTY: DUTY, STD_WATCH: STD_WATCH, STATUSES: STATUSES, DEF_TMPL: DEF_TMPL,
    grid: grid, fitSlots: fitSlots, logView: logView,
    handle: handle, ensure: ensure, findEmail: findEmail, newPerson: newPerson, isAdmin: isAdmin,
    inChargeId: inChargeId, runs: runs, nm: nm, uid: uid, addDays: addDays, lc: lc, E: E
  };
})();

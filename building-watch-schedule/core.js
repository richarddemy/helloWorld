// =====================================================================
// HOW TO READ THIS FILE (for non-programmers)
// =====================================================================
// Lines that start with two slashes are notes for people. The computer
// ignores them. Everything else is instructions.
//
// This is the RULE BOOK of the Building Watch schedule. It decides who may
// do what and how schedules are stored. The same file runs in two places:
//   1. In Google Apps Script, as backend/Core.gs, on the real Google Sheet.
//   2. In the browser, when the app runs as a demo with sample data.
//
// A few words that appear often:
//   st     the "store": every list the app keeps, loaded from the Sheet.
//   me     the person who is signed in and making the request.
//   P      the details sent with a request.
//   H      helpers supplied by whoever runs this file. In Apps Script they
//          reach the real calendar. In the demo they only pretend.
//   slot   one half-hour block. Slot 0 starts at 0730, slot 1 at 0800, and
//          so on up to slot 32 (2330 to 2400).
//   draft  a watch the manager has set but not yet published to the
//          calendar. Only admins see drafts.
// =====================================================================
var Core = (function () {
  // The time grid. START must never change: saved schedules depend on it.
  var START = 450;                    // first slot starts at 0730
  var NS = 33;                        // 33 half hours, 0730 to 2400
  var DUTY = [1, 17];                 // duty day, 0800 to 1600
  var VIEW = [0, 17];                 // normal view, 0730 to 1600
  var STD_WATCH = [[1, 5], [13, 17]]; // usual watches, 0800-1000 and 1400-1600

  // ---------- small helpers ----------
  function E(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function lc(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function str(s, max) { return String(s == null ? "" : s).trim().slice(0, max || 500); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }
  function byId(a, id) { for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function uniq(a) { var o = [], s = {}; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s)); }
  function addDays(s, n) {
    var p = s.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
  }
  function nm(p) { return p ? (p.name || p.email) : ""; }
  function grid() {
    return { start: START, ns: NS, duty: DUTY.slice(), view: VIEW.slice(), std: STD_WATCH.map(function (x) { return x.slice(); }) };
  }

  // ---------- the store ----------
  function defaults() {
    // calId/calName: the Google Calendar the watch is published to.
    // invites: send each person a calendar invitation when published.
    // remind: minutes before a watch for the calendar reminder (0 = none).
    return { calId: "", calName: "", invites: true, remind: 30 };
  }
  // ensure: makes sure every list and setting exists, so a new or partly
  // empty Sheet never causes a crash.
  function ensure(st) {
    ["people", "avail", "watches", "audit"].forEach(function (k) { st[k] = st[k] || []; });
    var d = defaults(), s = st.settings || {};
    Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
    st.settings = s;
    st._dirty = st._dirty || {};  // which lists changed and need saving
    st._warn = st._warn || [];    // warnings to show the user
    return st;
  }
  function touch(st) { for (var i = 1; i < arguments.length; i++) st._dirty[arguments[i]] = 1; }
  function findEmail(st, email) {
    email = lc(email);
    for (var i = 0; i < st.people.length; i++) if (lc(st.people[i].email) === email) return st.people[i];
    return null;
  }
  function newPerson(email, name, role, nowISO) {
    return { id: uid(), email: lc(email), name: str(name, 80), role: role === "Admin" ? "Admin" : "Member",
      watch: true, active: true, invitedAt: nowISO, joinedAt: "" };
  }
  function isAdmin(p) { return !!p && p.active !== false && p.role === "Admin"; }
  // pub: the version of a person safe to send to a browser. Everyone sees
  // names; only admins ("full") see email addresses and sign-up dates.
  function pub(p, full) {
    var o = { id: p.id, name: nm(p), role: p.role, watch: p.watch !== false, active: p.active !== false };
    if (full) { o.email = p.email; o.invitedAt = p.invitedAt || ""; o.joinedAt = p.joinedAt || ""; }
    return o;
  }
  function audit(st, p, action, detail, H) {
    st.audit.push({ t: H.nowISO(), who: nm(p), action: action, detail: str(detail, 300) });
    touch(st, "audit");
  }
  // watchView: a watch as a browser sees it. The calendar's internal event
  // code stays on the server; the browser only learns whether it is published.
  function watchView(w) { return { id: w.id, pid: w.pid, date: w.date, s: +w.s, e: +w.e, pub: !!w.ev }; }
  // drafts: watches from today on, for active people, not on the calendar yet.
  function drafts(st, today) {
    return st.watches.filter(function (w) {
      var p = byId(st.people, w.pid);
      return !w.ev && w.date >= today && p && p.active !== false;
    });
  }

  // =====================================================================
  // handle: every request from the app comes here.
  // =====================================================================
  function handle(st, email, action, P, H) {
    ensure(st);
    P = P || {};
    var t = H.today();
    var me = findEmail(st, email);

    // The first question the app asks after sign-in.
    if (action === "whoami") {
      if (!me || me.active === false) return { status: "denied", email: lc(email) };
      return { status: me.joinedAt ? "ok" : "profile", me: pub(me, true) };
    }
    // Everything below requires an active person on the list.
    if (!me || me.active === false) throw E("denied", "You don't have access. Ask an admin to add " + lc(email) + ".");
    var admin = isAdmin(me);
    function need() { if (!admin) throw E("forbidden", "Only admins can do that."); }

    switch (action) {
      // Save my name. The first time also records that I joined.
      case "profile.save": {
        var name = str(P.name, 80);
        if (!name) throw E("input", "Enter your rank and name.");
        me.name = name;
        if (!me.joinedAt) { me.joinedAt = H.nowISO(); audit(st, me, "joined", "", H); }
        touch(st, "people");
        return pub(me, true);
      }

      // Everything the app needs to draw one week, filtered to what this
      // person may see. Members see only their own hours and published watches.
      case "load": {
        var wk = (P.week || []).filter(isDate).slice(0, 7);
        if (!wk.length) throw E("input", "Bad week.");
        var inWk = function (d) { return wk.indexOf(d) >= 0; };
        var seen = st.watches.filter(function (w) { return inWk(w.date) && (admin || !!w.ev); });
        // prior: my own hours from the week before, for "Same as last week".
        var prior = {};
        wk.forEach(function (d) {
          var was = addDays(d, -7);
          st.avail.forEach(function (a) { if (a.pid === me.id && a.date === was) prior[d] = a.slots; });
        });
        var out = {
          me: pub(me, true), admin: admin, today: t,
          people: st.people.filter(function (p) { return admin || p.active !== false || seen.some(function (w) { return w.pid === p.id; }); })
            .map(function (p) { return pub(p, admin); }),
          avail: st.avail.filter(function (a) { return inWk(a.date) && (admin || a.pid === me.id); })
            .map(function (a) { return { pid: a.pid, date: a.date, slots: a.slots, at: a.at || "" }; }),
          watches: seen.map(watchView),
          prior: prior,
          settings: { calName: st.settings.calName }
        };
        if (admin) {
          // monthCounts: watches per person this month, to spread them fairly.
          var month = wk[0].slice(0, 7), counts = {};
          st.watches.forEach(function (w) { if (w.date.slice(0, 7) === month) counts[w.pid] = (counts[w.pid] || 0) + 1; });
          out.monthCounts = counts;
          out.drafts = drafts(st, t).map(watchView);
          out.settings = { calId: st.settings.calId, calName: st.settings.calName, invites: st.settings.invites, remind: st.settings.remind };
        }
        return out;
      }

      // Submit my hours. Each day is a 33-character string of 1s and 0s. A day
      // of all 0s is kept on purpose: it tells the manager "I sent my hours and
      // I'm out that day," which is different from not answering at all.
      case "avail.save": {
        var days = P.days || {}, n = 0;
        Object.keys(days).slice(0, 14).forEach(function (date) {
          if (!isDate(date)) return;
          var slots = String(days[date]);
          if (slots.length !== NS || !/^[01]+$/.test(slots)) return;
          var rec = null;
          st.avail.forEach(function (a) { if (a.pid === me.id && a.date === date) rec = a; });
          if (rec) { rec.slots = slots; rec.at = H.nowISO(); }
          else st.avail.push({ pid: me.id, date: date, slots: slots, at: H.nowISO() });
          n++;
        });
        touch(st, "avail");
        return { saved: n };
      }

      // An admin sets who stands watch on a date between two slots. People on
      // watch in that window who were not chosen come off it. Any longer watch
      // they had is trimmed around the window. Nothing reaches the calendar
      // until an admin publishes, but removing a published watch takes its
      // calendar event down right away.
      case "watch.save": {
        need();
        var date = P.date, s = +P.s, e = +P.e;
        if (!isDate(date) || !(s >= 0 && e <= NS && e > s)) throw E("input", "Bad watch window.");
        if (date < t) throw E("input", "That date has passed.");
        var pids = uniq((P.pids || []).filter(function (id) { return byId(st.people, id); }));
        var before = uniq(st.watches.filter(function (w) { return w.date === date && +w.s < e && +w.e > s; }).map(function (w) { return w.pid; }));
        var cut = function (pid) {
          var keep = [];
          st.watches.forEach(function (w) {
            if (w.pid !== pid || w.date !== date || +w.e <= s || +w.s >= e) { keep.push(w); return; }
            H.eventDelete(st, w.ev);
            if (+w.s < s) keep.push({ id: uid(), pid: pid, date: date, s: +w.s, e: s, ev: "" });
            if (+w.e > e) keep.push({ id: uid(), pid: pid, date: date, s: e, e: +w.e, ev: "" });
          });
          st.watches = keep;
        };
        before.forEach(function (pid) { if (pids.indexOf(pid) < 0) cut(pid); });
        pids.forEach(function (pid) {
          var same = st.watches.some(function (w) { return w.pid === pid && w.date === date && +w.s === s && +w.e === e; });
          if (same) return;
          cut(pid);
          st.watches.push({ id: uid(), pid: pid, date: date, s: s, e: e, ev: "" });
        });
        st.watches.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.s - b.s; });
        touch(st, "watches");
        audit(st, me, "watch.save", date + " slots " + s + "-" + e + ": " + pids.map(function (id) { return nm(byId(st.people, id)); }).join(", "), H);
        return { ok: true };
      }

      // An admin adds someone by email, or brings back someone deactivated.
      case "person.add": {
        need();
        var em = lc(P.email);
        if (!isEmail(em)) throw E("input", "Enter a valid email address.");
        var ex = findEmail(st, em);
        if (ex && ex.active !== false) throw E("input", em + " is already on the list.");
        var np = ex;
        if (ex) { ex.active = true; ex.role = P.role === "Admin" ? "Admin" : "Member"; if (P.name) ex.name = str(P.name, 80); ex.invitedAt = H.nowISO(); }
        else { np = newPerson(em, P.name, P.role, H.nowISO()); st.people.push(np); }
        touch(st, "people");
        audit(st, me, "person.add", em + " as " + np.role, H);
        return pub(np, true);
      }

      // An admin changes someone. There must always be at least one admin,
      // and nobody can deactivate themselves.
      case "person.update": {
        need();
        var p = byId(st.people, P.id);
        if (!p) throw E("missing", "Person not found.");
        var admins = st.people.filter(function (x) { return isAdmin(x); });
        if (P.name !== undefined) { if (!str(P.name)) throw E("input", "Enter a name."); p.name = str(P.name, 80); }
        if (P.watch !== undefined) p.watch = !!P.watch;
        if (P.role !== undefined) {
          var role = P.role === "Admin" ? "Admin" : "Member";
          if (role === "Member" && isAdmin(p) && admins.length <= 1) throw E("input", "Keep at least one admin.");
          p.role = role;
        }
        if (P.active !== undefined) {
          if (!P.active && p.id === me.id) throw E("input", "You can't deactivate yourself.");
          if (!P.active && isAdmin(p) && admins.length <= 1) throw E("input", "Keep at least one admin.");
          p.active = !!P.active;
        }
        touch(st, "people");
        audit(st, me, "person.update", nm(p), H);
        return pub(p, true);
      }

      // An admin changes calendar settings. A new calendar is tested first.
      case "settings.save": {
        need();
        var S = st.settings;
        if (P.calId !== undefined && str(P.calId, 300) !== S.calId) {
          var id = str(P.calId, 300);
          S.calName = H.testCal(st, id);
          S.calId = id;
        }
        if (P.invites !== undefined) S.invites = !!P.invites;
        if (P.remind !== undefined) S.remind = Math.max(0, Math.min(1440, +P.remind || 0));
        touch(st, "settings");
        audit(st, me, "settings.save", S.calName, H);
        return { calId: S.calId, calName: S.calName, invites: S.invites, remind: S.remind };
      }
    }
    throw E("input", "Unknown action: " + action);
  }

  // What this rule book hands out to the rest of the app.
  return { NS: NS, START: START, grid: grid, handle: handle, ensure: ensure, findEmail: findEmail,
    newPerson: newPerson, isAdmin: isAdmin, drafts: drafts, nm: nm, addDays: addDays, lc: lc, E: E, uid: uid, audit: audit };
})();

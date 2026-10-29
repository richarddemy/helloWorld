/*
 * Building Watch core logic.
 * Shared by the Google Apps Script backend (copy this file into the script as Core.gs)
 * and by the in-browser demo. No browser or Google APIs are used here; anything that
 * touches the outside world goes through the hooks object H.
 */
var Core = (function () {
  var NS = 17;          // half-hour slots per day
  var START = 450;      // first slot starts 0730 (minutes after midnight)
  var STATUSES = ["Open", "Submitted to PW", "In progress", "Closed"];
  var DEF_TMPL = [
    "Walk all decks and stairwells",
    "Check exterior doors are secured",
    "Check rehearsal halls: lights, HVAC, thermostats",
    "Check heads for leaks or outages",
    "Turn any problems into service requests"
  ];

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
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function nm(p) { return p ? (p.name || p.email) : ""; }
  function isOut(l) { return l.out !== "" && l.out != null; }

  function defaults() {
    return {
      calId: "", calName: "Building Watch", invites: true, remind: 30, watchPhone: "",
      manager: "", acting: { pid: "", from: "", to: "" },
      tmpl: DEF_TMPL.slice(), appUrl: "", mailLog: []
    };
  }
  function ensure(st) {
    ["people", "avail", "watches", "requests", "log", "audit", "crewAssignments", "crewActivity"].forEach(function (k) { st[k] = st[k] || []; });
    var d = defaults(), s = st.settings || {};
    Object.keys(d).forEach(function (k) { if (s[k] === undefined || s[k] === "") s[k] = d[k]; });
    if (!s.acting || typeof s.acting !== "object") s.acting = { pid: "", from: "", to: "" };
    st.settings = s;
    st._dirty = st._dirty || {};
    st._warn = st._warn || [];
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
      watch: true, active: true, phone: "", cals: [], invitedAt: nowISO, joinedAt: "" };
  }
  function inChargeId(st, t) {
    var a = st.settings.acting;
    if (a && a.pid && (!a.from || a.from <= t) && (!a.to || a.to >= t)) return a.pid;
    return st.settings.manager;
  }
  function isAdmin(st, p, t) {
    return !!p && p.active !== false && (p.role === "Admin" || p.id === st.settings.manager || p.id === inChargeId(st, t));
  }
  function runs(slots) {
    var out = [], s = -1;
    for (var i = 0; i <= NS; i++) {
      var on = i < NS && slots.charAt(i) === "1";
      if (on && s < 0) s = i;
      if (!on && s >= 0) { out.push([s, i]); s = -1; }
    }
    return out;
  }
  function pub(p, full) {
    var o = { id: p.id, name: nm(p), role: p.role, watch: p.watch !== false };
    if (full) {
      o.email = p.email; o.phone = p.phone || ""; o.active = p.active !== false;
      o.invitedAt = p.invitedAt || ""; o.joinedAt = p.joinedAt || "";
      o.calCount = (p.cals || []).filter(function (c) { return c.on; }).length;
    }
    return o;
  }
  function audit(st, p, action, detail, H) {
    st.audit.push({ t: H.nowISO(), who: nm(p), action: action, detail: str(detail, 300) });
    if (st.audit.length > 1000) st.audit = st.audit.slice(-1000);
    touch(st, "audit");
  }
  function publicSettings(st, admin) {
    var s = st.settings;
    var o = { calName: s.calName, calId: s.calId, invites: s.invites, remind: s.remind, tmpl: s.tmpl,
      appUrl: s.appUrl, manager: s.manager, acting: s.acting, watchPhone: s.watchPhone || "" };
    if (admin) o.mailLog = (s.mailLog || []).slice(-10);
    return o;
  }
  function newReq(st, me, t, loc, issue, pri) {
    var r = { id: uid(), date: t, by: nm(me), byId: me.id, loc: str(loc, 120) || "Not given",
      issue: str(issue, 1000), pri: ["Routine", "Urgent", "Emergency"].indexOf(pri) >= 0 ? pri : "Routine",
      status: "Open", wo: "" };
    st.requests.push(r); touch(st, "requests");
    return r;
  }

  function handle(st, email, action, P, H) {
    ensure(st);
    P = P || {};
    var t = H.today();
    var me = findEmail(st, email);

    if (action === "whoami") {
      if (!me || me.active === false) return { status: "denied", email: lc(email) };
      return { status: me.joinedAt ? "ok" : "profile", me: pub(me, true) };
    }
    if (!me || me.active === false) throw E("denied", "You don't have access. Ask an admin to add " + lc(email) + ".");
    var admin = isAdmin(st, me, t);
    function need() { if (!admin) throw E("forbidden", "Only admins can do that."); }
    function person(id) { var p = byId(st.people, id); if (!p) throw E("missing", "Person not found."); return p; }

    switch (action) {

      /* ---------- profile and personal calendars ---------- */
      case "profile.save": {
        var name = str(P.name, 80);
        if (!name) throw E("input", "Enter your name.");
        me.name = name; me.phone = str(P.phone, 40);
        if (!me.joinedAt) { me.joinedAt = H.nowISO(); H.shareCal(st, me.email, true); audit(st, me, "joined", "", H); }
        touch(st, "people");
        return pub(me, true);
      }
      case "cals.save": {
        var cals = (P.cals || []).slice(0, 5).map(function (c) {
          return { label: str(c.label, 60) || "My calendar", url: str(c.url, 600), on: !!c.on };
        }).filter(function (c) { return c.url; });
        me.cals = cals; touch(st, "people");
        return cals;
      }
      case "busy": {
        var on = (me.cals || []).filter(function (c) { return c.on; });
        if (!on.length || !(P.week || []).length) return [];
        return H.fetchBusy(st, on, P.week);
      }

      /* ---------- load a week ---------- */
      case "load": {
        var wk = (P.week || []).filter(isDate);
        if (!wk.length) throw E("input", "Bad week.");
        var inWk = function (d) { return wk.indexOf(d) >= 0; };
        var month = wk[0].slice(0, 7), counts = {};
        st.watches.forEach(function (w) { if (w.date.slice(0, 7) === month) counts[w.pid] = (counts[w.pid] || 0) + 1; });
        var since = addDays(t, -30);
        var ic = byId(st.people, inChargeId(st, t)), mg = byId(st.people, st.settings.manager);
        var meFull = pub(me, true); meFull.cals = me.cals || [];
        return {
          me: meFull, admin: admin, today: t,
          inCharge: nm(ic), manager: nm(mg),
          people: st.people.filter(function (p) { return admin || p.active !== false; }).map(function (p) { return pub(p, admin); }),
          avail: st.avail.filter(function (a) { return inWk(a.date) && (admin || a.pid === me.id); })
            .map(function (a) { return { pid: a.pid, date: a.date, slots: a.slots }; }),
          watches: st.watches.filter(function (w) { return inWk(w.date); })
            .map(function (w) { return { id: w.id, pid: w.pid, date: w.date, s: +w.s, e: +w.e, checks: w.checks || {} }; }),
          monthCounts: counts,
          crewAssignments: st.crewAssignments.filter(function (x) { return admin || (x.assignees || []).indexOf(me.id) >= 0; }).map(function (x) { return Object.assign({}, x); }),
          crewActivity: st.crewActivity.filter(function (x) { return admin || st.crewAssignments.some(function (a) { return a.id === x.assignmentId && (a.assignees || []).indexOf(me.id) >= 0; }); }).slice(-500),
          requests: st.requests.slice(-400),
          log: st.log.filter(function (l) { return !isOut(l) || l.date >= since; }).slice(-400),
          settings: publicSettings(st, admin)
        };
      }

      /* ---------- my time in the building ---------- */
      case "avail.save": {
        var days = P.days || {}, n = 0;
        Object.keys(days).forEach(function (date) {
          if (!isDate(date)) return;
          var slots = String(days[date]);
          if (!/^[01]+$/.test(slots) || slots.length !== NS) return;
          var rec = null, idx = -1;
          for (var i = 0; i < st.avail.length; i++) if (st.avail[i].pid === me.id && st.avail[i].date === date) { rec = st.avail[i]; idx = i; }
          if (rec && rec.slots === slots) return;
          var ev = H.syncAvail(st, me, date, slots, rec ? (rec.ev || []) : []);
          if (slots.indexOf("1") < 0) { if (idx >= 0) st.avail.splice(idx, 1); }
          else if (rec) { rec.slots = slots; rec.ev = ev; }
          else st.avail.push({ pid: me.id, date: date, slots: slots, ev: ev });
          n++;
        });
        touch(st, "avail");
        return { saved: n };
      }

      /* ---------- watch bill ---------- */
      case "watch.save": {
        need();
        var date = P.date, s = +P.s, e = +P.e;
        if (!isDate(date) || !(s >= 0 && e <= NS && e > s)) throw E("input", "Bad watch window.");
        var pids = uniq((P.pids || []).filter(function (id) { return byId(st.people, id); }));
        var before = uniq(st.watches.filter(function (w) { return w.date === date && +w.s < e && +w.e > s; }).map(function (w) { return w.pid; }));
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
        before.forEach(function (pid) { if (pids.indexOf(pid) < 0) cut(pid); });
        pids.forEach(function (pid) {
          var same = st.watches.filter(function (w) { return w.pid === pid && w.date === date && +w.s === s && +w.e === e; });
          if (same.length) return;
          cut(pid);
          var w = { id: uid(), pid: pid, date: date, s: s, e: e, checks: {}, ev: "" };
          w.ev = H.watchCreate(st, byId(st.people, pid), w);
          st.watches.push(w);
        });
        st.watches.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.s - b.s; });
        touch(st, "watches");
        audit(st, me, "watch.save", date + " slots " + s + "-" + e + ": " + pids.map(function (id) { return nm(byId(st.people, id)); }).join(", "), H);
        return { ok: true };
      }
      case "check": {
        var w = byId(st.watches, P.wid);
        if (!w) throw E("missing", "Watch not found.");
        if (w.pid !== me.id && !admin) throw E("forbidden", "That isn't your watch.");
        w.checks = w.checks || {};
        if (P.on) w.checks[str(P.item, 200)] = 1; else delete w.checks[str(P.item, 200)];
        touch(st, "watches");
        return w.checks;
      }
      case "tmpl.save": {
        need();
        st.settings.tmpl = (P.tmpl || []).map(function (x) { return str(x, 200); }).filter(String).slice(0, 40);
        touch(st, "settings");
        return st.settings.tmpl;
      }

      /* Crew assignments are separate from maintenance requests and watch duties. */
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
      case "req.new": {
        if (!str(P.issue)) throw E("input", "Describe the problem.");
        var r = newReq(st, me, t, P.loc, P.issue, P.pri);
        return r;
      }
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
      case "log.in": {
        if (!str(P.worker)) throw E("input", "Enter the worker's name.");
        var link = P.req ? byId(st.requests, P.req) : null;
        var l = { id: uid(), date: t, worker: str(P.worker, 80), shop: str(P.shop, 80), req: link ? link.id : "",
          task: str(P.task, 300) || (link ? link.loc + ": " + link.issue : ""), in: H.nowMin(), out: "",
          done: '', fu: '', ret: '', prob: '', newReq: '', by: nm(me), fuClosed: false,
          email: str(P.email, 120).toLowerCase(), emailConsent: !!P.emailConsent,
          tokenHash: '', tokenExpiry: '', workerOutAt: '', watchOutAt: '', watchSeenAt: '', outBy: '' };
        st.log.push(l);
        if (link && (link.status === "Open" || link.status === "Submitted to PW")) { link.status = "In progress"; touch(st, "requests"); }
        touch(st, "log");
        return l;
      }
      case "log.out": {
        var l2 = byId(st.log, P.id);
        if (!l2) throw E("missing", "Log entry not found.");
        if (l2.watchOutAt) throw E('input', l2.worker + ' has already been checked out by the watchstander.');
        if (!isOut(l2)) l2.out = Math.max(H.nowMin(), +l2.in);
        l2.done = ["Yes", "Partly", "No"].indexOf(P.done) >= 0 ? P.done : "Yes";
        l2.fu = str(P.fu, 1000); l2.ret = isDate(P.ret) ? P.ret : ""; l2.prob = str(P.prob, 1000);
        if (l2.prob && P.make) l2.newReq = newReq(st, me, t, P.loc, l2.prob, "Routine").id;
        if (l2.req) {
          var lr = byId(st.requests, l2.req);
          if (lr) { lr.status = l2.done === "Yes" && !l2.fu ? "Closed" : "In progress"; touch(st, "requests"); }
        }
        touch(st, "log");
        return l2;
      }
      case "log.resolve": {
        need();
        var l3 = byId(st.log, P.id); if (!l3) throw E("missing", "Log entry not found.");
        l3.fuClosed = true; touch(st, "log");
        return l3;
      }
      case "log.makeReq": {
        var l4 = byId(st.log, P.id); if (!l4) throw E("missing", "Log entry not found.");
        if (!l4.prob || l4.newReq) return l4;
        l4.newReq = newReq(st, me, t, P.loc || "See description", l4.prob, "Routine").id;
        touch(st, "log");
        return l4;
      }

      /* ---------- reports ---------- */
      case "range": {
        need();
        if (!isDate(P.from) || !isDate(P.to)) throw E("input", "Pick both dates.");
        var inR = function (d) { return d >= P.from && d <= P.to; };
        return {
          people: st.people.map(function (p) { return pub(p, true); }),
          avail: st.avail.filter(function (a) { return inR(a.date); }).map(function (a) { return { pid: a.pid, date: a.date, slots: a.slots }; }),
          watches: st.watches.filter(function (w) { return inR(w.date); }).map(function (w) { return { id: w.id, pid: w.pid, date: w.date, s: +w.s, e: +w.e, checks: w.checks || {} }; }),
          log: st.log.filter(function (l) { return inR(l.date); }),
          requests: st.requests.filter(function (r) { return inR(r.date); }),
          tmplLen: st.settings.tmpl.length
        };
      }

      /* ---------- admin: people ---------- */
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
      case "person.update": {
        need();
        var p = person(P.id);
        var admins = function () { return st.people.filter(function (x) { return x.active !== false && x.role === "Admin"; }); };
        if (P.email !== undefined && lc(P.email) !== lc(p.email)) {
          var ne = lc(P.email);
          if (!isEmail(ne)) throw E("input", "Enter a valid email address.");
          if (findEmail(st, ne)) throw E("input", ne + " is already used by someone else.");
          H.shareCal(st, p.email, false); p.email = ne; H.shareCal(st, ne, true);
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
      case "person.invite": {
        need();
        var pi = person(P.id);
        H.sendInvite(st, pi, nm(me)); pi.invitedAt = H.nowISO();
        touch(st, "people");
        return pub(pi, true);
      }

      /* ---------- admin: settings ---------- */
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
          if (phone && !/^\+?[0-9().\s-]{7,25}$/.test(phone)) throw E("input", "Enter a valid watch telephone number.");
          S.watchPhone = phone;
        }
        if (P.manager !== undefined && byId(st.people, P.manager)) S.manager = P.manager;
        if (P.acting !== undefined) {
          var a = P.acting || {};
          S.acting = { pid: byId(st.people, a.pid) ? a.pid : "", from: isDate(a.from) ? a.from : "", to: isDate(a.to) ? a.to : "" };
        }
        touch(st, "settings");
        audit(st, me, "settings.save", "", H);
        return publicSettings(st, true);
      }
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
      case "audit.list": {
        need();
        return st.audit.slice(-200).reverse();
      }
    }
    throw E("input", "Unknown action: " + action);
  }

  return {
    NS: NS, START: START, STATUSES: STATUSES, DEF_TMPL: DEF_TMPL,
    handle: handle, ensure: ensure, findEmail: findEmail, newPerson: newPerson, isAdmin: isAdmin,
    inChargeId: inChargeId, runs: runs, nm: nm, uid: uid, addDays: addDays, lc: lc, E: E
  };
})();

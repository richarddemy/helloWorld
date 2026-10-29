/*
 * Building Watch — authenticated assistance alerts + worker email requests.
 * Add this file as Assistance.gs to the SAME Google Apps Script project as
 * Code.gs / Core.gs. Integration hooks are documented in ASSISTANCE-SETUP.md.
 *
 * The delivery adapter calls a separately hosted HTTPS Web Push dispatcher.
 * It never sends telephone numbers, locations or messages to lock screens.
 */
var ASSIST_HEADERS_ = {
  alerts: ["id","createdAt","source","visitorId","reporter","reporterId","location","message","assignedTo","status","acknowledgedBy","acknowledgedAt","pushResult"],
  devices: ["id","pid","endpoint","p256dh","auth","createdAt","updatedAt"]
};

function assistSheet_(kind, create) {
  var name = kind === "alerts" ? "Assistance Alerts" : "Push Subscriptions";
  var wb = workbookFor_("watches");
  var sheet = wb.getSheetByName(name);
  if (!sheet && create) sheet = wb.insertSheet(name);
  if (!sheet) throw err_("setup", "Assistance is not configured; run setupAssistance() from the script editor.");
  if (create && sheet.getLastRow() < 1) {
    var headers = ASSIST_HEADERS_[kind];
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function setupAssistance() {
  assistSheet_("alerts", true);
  assistSheet_("devices", true);
  Logger.log("Assistance Alerts and Push Subscriptions tabs are ready.");
}
function assistRows_(kind) {
  var sh = assistSheet_(kind, false);
  if (sh.getLastRow() < 2) return [];
  var rows = sh.getDataRange().getDisplayValues(), keys = ASSIST_HEADERS_[kind];
  return rows.slice(1).map(function(v,i) {
    if (!v[0]) return null;
    var a = { _row: i+2 };
    keys.forEach(function(k,j) {
      if (k === "assignedTo") {
        try { a[k] = JSON.parse(v[j] || "[]"); } catch(e) { a[k] = []; }
      } else a[k] = v[j] || "";
    });
    return a;
  }).filter(Boolean);
}
function assistAppend_(kind, record) {
  assistSheet_(kind, false).appendRow(ASSIST_HEADERS_[kind].map(function(k) {
    return k === "assignedTo" ? JSON.stringify(record[k] || []) : (record[k] == null ? "" : String(record[k]));
  }));
}
function assistSet_(kind, row, fields) {
  var sh = assistSheet_(kind, false), keys = ASSIST_HEADERS_[kind];
  Object.keys(fields).forEach(function(k) {
    var index = keys.indexOf(k);
    if (index < 0) return;
    var v = k === "assignedTo" ? JSON.stringify(fields[k] || []) : String(fields[k] == null ? "" : fields[k]);
    sh.getRange(row, index+1).setValue(v);
  });
}
function assistPerson_(st, id) {
  return st.people.filter(function(p) {return p.id === id && p.active !== false;})[0] || null;
}
function assistRecipients_(st) {
  // The watch bill takes priority. Everyone on an overlapping active shift is notified.
  var day = H.today(), slot = Math.floor((H.nowMin()-Core.START)/30);
  var ids = [], seen = {};
  st.watches.forEach(function(w) {
    var p = assistPerson_(st, w.pid);
    if (p && w.date === day && +w.s <= slot && +w.e > slot && !seen[p.id]) {
      seen[p.id] = true; ids.push(p.id);
    }
  });
  if (ids.length) return ids;
  // No watch: use acting manager, followed by permanent manager if needed.
  var acting = st.settings.acting || {};
  var valid = acting.pid && (!acting.from || acting.from <= day) && (!acting.to || acting.to >= day);
  var fallback = valid ? assistPerson_(st, acting.pid) : null;
  if (!fallback) fallback = assistPerson_(st, st.settings.manager);
  return fallback ? [fallback.id] : [];
}
function assistUser_(st, email) {
  var p = Core.findEmail(st, email);
  if (!p || p.active === false) throw err_("denied","Facilities team account required.");
  return p;
}
function assistAllowedEndpoint_(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  var m = endpoint.match(/^https:\/\/([^/:?#]+)(?::443)?\//i);
  if (!m) return false;
  var host = m[1].toLowerCase();
  return /(^|\.)fcm\.googleapis\.com$|(^|\.)push\.services\.mozilla\.com$|(^|\.)web\.push\.apple\.com$|(^|\.)notify\.windows\.com$/.test(host);
}
function assistRegister_(st, email, P) {
  var user = assistUser_(st,email), sub = P.subscription || {}, keys=sub.keys || {};
  var endpoint = String(sub.endpoint || ""), p256dh = String(keys.p256dh || ""), auth = String(keys.auth || "");
  if (!assistAllowedEndpoint_(endpoint) || !/^[A-Za-z0-9_-]{60,160}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,60}$/.test(auth))
    throw err_("input","Unsupported or invalid browser push subscription.");
  // A browser endpoint may belong to only one signed-in account at a time.
  var rows = assistRows_("devices"), deviceSheet = assistSheet_("devices",false);
  rows.filter(function(r){return r.endpoint===endpoint && r.pid!==user.id;}).reverse()
    .forEach(function(r){deviceSheet.deleteRow(r._row);});
  rows = assistRows_("devices");
  var old = rows.filter(function(r){return r.pid===user.id && r.endpoint===endpoint;})[0];
  if (old) assistSet_("devices",old._row,{p256dh:p256dh,auth:auth,updatedAt:H.nowISO()});
  else assistAppend_("devices",{id:Utilities.getUuid(),pid:user.id,endpoint:endpoint,p256dh:p256dh,auth:auth,createdAt:H.nowISO(),updatedAt:H.nowISO()});
  return {registered:true};
}
function assistUnregister_(st,email,P) {
  var user = assistUser_(st,email), endpoint = String(P.endpoint || "");
  var sh = assistSheet_("devices",false), rows=assistRows_("devices");
  rows.filter(function(r){return r.pid===user.id && r.endpoint===endpoint;}).reverse()
    .forEach(function(r){sh.deleteRow(r._row);});
  return {registered:false};
}
function assistTestStatus_(st,email) {
  var user=assistUser_(st,email), ids=assistRecipients_(st), devices=assistRows_("devices");
  return {
    recipients: ids.map(function(id){var p=assistPerson_(st,id);return {id:id,name:p ? p.name : "Assigned team member",subscribed:devices.some(function(x){return x.pid===id;})};}),
    myDevices: devices.filter(function(x){return x.pid===user.id;}).length,
    pushConfigured: !!(props_().getProperty("PUSH_ENDPOINT_URL") && props_().getProperty("PUSH_SHARED_SECRET"))
  };
}
function assistDispatch_(st,alert) {
  var endpoint=String(props_().getProperty("PUSH_ENDPOINT_URL") || "").trim();
  var secret=String(props_().getProperty("PUSH_SHARED_SECRET") || "");
  var subscriptions=assistRows_("devices").filter(function(x) {
    return alert.assignedTo.indexOf(x.pid) >= 0 && assistPerson_(st,x.pid);
  }).map(function(x) {return {endpoint:x.endpoint,keys:{p256dh:x.p256dh,auth:x.auth}};});
  if (!subscriptions.length) return "No subscribed recipient devices";
  if (!/^https:\/\/[^?#]+\/push\.php$/.test(endpoint) || secret.length < 32) return "Push dispatcher not configured";
  var link=String(SETUP.APP_URL_OVERRIDE || SETUP.APP_URL || "").split("?")[0] + "?assistance=" + encodeURIComponent(alert.id);
  var data={subscriptions:subscriptions,notification:{
    title:"Building Watch — Assistance requested",
    body:"Someone is trying to reach you. Open Building Watch to respond.",
    url:link,tag:"bw-assistance-"+alert.id
  }};
  try {
    var r=UrlFetchApp.fetch(endpoint,{method:"post",contentType:"application/json",payload:JSON.stringify(data),
      headers:{"Authorization":"Bearer "+secret},muteHttpExceptions:true,followRedirects:false});
    if (r.getResponseCode() !== 200) return "Push gateway error ("+r.getResponseCode()+")";
    var body=JSON.parse(r.getContentText());
    return "Dispatched "+Number(body.accepted || 0)+" of "+subscriptions.length+" subscribed devices";
  } catch(e) { Logger.log("Assistance push dispatcher failed: "+String(e));return "Push dispatcher unreachable"; }
}
function assistRaise_(st,opts) {
  var alerts=assistRows_("alerts"), now=new Date(), reporterId=String(opts.reporterId || ""), visitorId=String(opts.visitorId || "");
  var source=String(opts.source || "Facilities team");
  var location=String(opts.location || "").trim().slice(0,140), message=String(opts.message || "").trim().slice(0,750);
  if (!location || !message) throw err_("input","Enter both your location and what help you need.");
  // An emailed worker token must not be able to flood the watch's devices.
  var recent=alerts.filter(function(a) {
    return now.getTime()-new Date(a.createdAt).getTime() < 15*60*1000 &&
      (visitorId ? a.visitorId===visitorId : a.reporterId===reporterId);
  });
  if (recent.length >= 3) throw err_("rate","Please wait before sending another assistance request.");
  var ids=assistRecipients_(st);
  // If the watch has no subscribed device, also alert the available supervisor.
  var subscribed=assistRows_("devices");
  if(ids.length && !ids.some(function(id){return subscribed.some(function(d){return d.pid===id;});})) {
    var acting=st.settings.acting || {}, today=H.today();
    var actingValid=acting.pid && (!acting.from || acting.from<=today) && (!acting.to || acting.to>=today);
    var supervisor=actingValid ? assistPerson_(st,acting.pid) : null;
    if(!supervisor) supervisor=assistPerson_(st,st.settings.manager);
    if(supervisor && ids.indexOf(supervisor.id)<0) ids.push(supervisor.id);
  }
  var record={id:"A-"+Utilities.getUuid(),createdAt:now.toISOString(),source:source,
    visitorId:visitorId,reporter:String(opts.reporter || "Facilities team").slice(0,100),
    reporterId:reporterId,location:location,message:message,
    assignedTo:ids,status:"Open",acknowledgedBy:"",acknowledgedAt:"",pushResult:"Pending"};
  assistAppend_("alerts",record); // Always persist before attempting network notification.
  var result=assistDispatch_(st,record);
  var stored=assistRows_("alerts").filter(function(x){return x.id===record.id;})[0];
  if (stored) assistSet_("alerts",stored._row,{pushResult:result});
  return {id:record.id,createdAt:record.createdAt,status:"Open",recipientCount:ids.length,pushResult:result};
}
function assistList_(st,email) {
  var user=assistUser_(st,email), admin=Core.isAdmin(st,user,H.today());
  return assistRows_("alerts").filter(function(a) {
    return admin || a.assignedTo.indexOf(user.id) >= 0;
  }).slice(-80).reverse().map(function(a) {
    return {id:a.id,createdAt:a.createdAt,source:a.source,reporter:a.reporter,
      location:a.location,message:a.message,status:a.status,assignedTo:a.assignedTo,
      acknowledgedBy:a.acknowledgedBy,acknowledgedAt:a.acknowledgedAt,
      isRecipient:a.assignedTo.indexOf(user.id)>=0,pushResult:admin ? a.pushResult : undefined};
  });
}
function assistAck_(st,email,P) {
  var user=assistUser_(st,email), item=assistRows_("alerts").filter(function(a){return a.id===P.id;})[0];
  if (!item) throw err_("missing","Assistance request not found.");
  if (item.assignedTo.indexOf(user.id) < 0 && !Core.isAdmin(st,user,H.today()))
    throw err_("forbidden","You are not a recipient of this assistance request.");
  if (item.status==="Acknowledged") return {id:item.id,status:item.status};
  assistSet_("alerts",item._row,{status:"Acknowledged",acknowledgedBy:user.id,acknowledgedAt:H.nowISO()});
  return {id:item.id,status:"Acknowledged"};
}
function assistHandle_(st,email,action,P) {
  switch(action) {
    case "assist.list": return assistList_(st,email);
    case "assist.status": return assistTestStatus_(st,email);
    case "assist.register": return assistRegister_(st,email,P);
    case "assist.unregister": return assistUnregister_(st,email,P);
    case "assist.ack": return assistAck_(st,email,P);
    case "assist.create":
      var user=assistUser_(st,email);
      return assistRaise_(st,{source:"Facilities team",reporter:user.name || user.email,reporterId:user.id,
        location:P.location,message:P.message});
  }
  throw err_("input","Unknown assistance action.");
}
function assistWorker_(token) {
  if (!/^[a-zA-Z0-9_-]{32,160}$/.test(String(token || ""))) return null;
  var st=readStore_(openSheet_()), hash=tokenDigest_(token);
  var l=st.log.filter(function(x) {return x.tokenHash && x.tokenHash===hash;})[0];
  if (!l || !l.tokenExpiry || +l.tokenExpiry<Date.now() || l.workerOutAt || (l.out !== "" && l.out != null)) return null;
  return {st:st,worker:l};
}
function assistForm_(token) {
  var worker=assistWorker_(token);
  if (!worker) return htmlResult_("Assistance link expired or already closed. Contact the facility directly if you still need help.");
  var url=ScriptApp.getService().getUrl();
  var html='<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer"><title>Request assistance</title></head>'+
    '<body style="font:16px system-ui,sans-serif;background:#0d1d30;color:white;padding:24px">'+
    '<main style="max-width:480px;margin:6vh auto"><h1>Request Assistance</h1>'+
    '<p>Send a message to the facilities watch. No phone number or sign-in required.</p>'+
    '<form method="post" action="'+htmlSafe_(url)+'">'+
    '<input type="hidden" name="assistToken" value="'+htmlSafe_(token)+'">'+
    '<label style="display:block;margin:18px 0">Where are you?<input name="location" required maxlength="140" autocomplete="off" placeholder="Building, room, or area" style="display:block;width:100%;box-sizing:border-box;padding:12px;margin-top:8px"></label>'+
    '<label style="display:block;margin:18px 0">What help do you need?<textarea name="message" required maxlength="750" rows="5" style="display:block;width:100%;box-sizing:border-box;padding:12px;margin-top:8px"></textarea></label>'+
    '<button type="submit" style="font:inherit;padding:14px 20px;background:#e5a35d;border:0;border-radius:8px">Send assistance request</button></form>'+
    '<p style="font-size:13px;color:#b7c8d6">If there is an immediate threat to life or safety, use established emergency procedures.</p></main></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle("Request Assistance");
}
function assistWorkerSubmit_(P) {
  var lock=LockService.getScriptLock();lock.waitLock(25000);
  try {
    var lookup=assistWorker_(String(P.assistToken || ""));
    if (!lookup) return htmlResult_("This assistance link has expired.");
    var st=lookup.st,worker=lookup.worker;
    var result;
    try {
      result=assistRaise_(st,{source:"Maintenance staff",visitorId:worker.id,reporter:worker.worker,
        location:P.location,message:P.message});
    } catch(e) {
      if(e.code==="rate") return htmlResult_("Your request limit has been reached. Please wait before trying again.");
      if(e.code==="input") return htmlResult_("Enter a location and a message to request assistance.");
      Logger.log("Assistance form request failed: "+String(e));
      return htmlResult_("We could not save the request. Please notify facilities staff directly.");
    }
    return htmlResult_(result.recipientCount ?
      "Assistance request recorded. The facilities watch has been notified where notifications are enabled." :
      "Assistance request recorded, but no watch or manager is currently assigned. Please also use the facility's established emergency procedures if assistance is urgent.");
  } finally {lock.releaseLock();}
}
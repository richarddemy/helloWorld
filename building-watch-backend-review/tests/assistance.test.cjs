const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../Assistance.gs'),'utf8');
const sheets={};
function sheet(name){
  return sheets[name]||(sheets[name]={
    values:[],
    getLastRow(){return this.values.length;},
    getDataRange(){return {getDisplayValues:()=>this.values};},
    getRange(r,c){const sh=this;return{
      setValues(values){values.forEach((v,i)=>sh.values[r+i-1]=v);return this;},
      setFontWeight(){return this;},
      setValue(v){sh.values[r-1][c-1]=v;return this;}
    };},
    setFrozenRows(){},
    appendRow(row){this.values.push(row);},
    deleteRow(i){this.values.splice(i-1,1);}
  });
}
const wb={getSheetByName:n=>sheets[n]||null,insertSheet:n=>sheet(n)};
const people=[
  {id:'w1',name:'Worf',email:'worf@valid.test',active:true},
  {id:'w2',name:'Data',email:'data@valid.test',active:true},
  {id:'m',name:'Picard',email:'picard@valid.test',active:true},
  {id:'u',name:'Geordi',email:'geordi@valid.test',active:true}
];
const st={people,watches:[
  {pid:'w1',date:'2026-10-29',s:0,e:8},
  {pid:'w2',date:'2026-10-29',s:4,e:12}
],settings:{manager:'m',acting:{pid:'',from:'',to:''}},log:[]};
let pushed=[];
const config={PUSH_ENDPOINT_URL:'https://demymusic.com/building-watch-push/push.php',PUSH_SHARED_SECRET:'x'.repeat(64)};
const env={
  workbookFor_:()=>wb,Logger:{log(){}},
  err_:(code,message)=>Object.assign(new Error(message),{code}),
  Core:{START:450,findEmail:(s,email)=>s.people.find(p=>p.email===email),isAdmin:(s,p)=>p&&p.id==='m'},
  H:{today:()=> '2026-10-29',nowMin:()=>600,nowISO:()=>new Date('2026-10-29T14:00:00Z').toISOString()},
  props_:()=>({getProperty:name=>config[name]||''}),
  Utilities:{getUuid:()=>Math.random().toString(36).slice(2)},
  SETUP:{APP_URL:'https://richarddemy.github.io/helloWorld/building-watch-trek/',APP_URL_OVERRIDE:''},
  UrlFetchApp:{fetch:(url,options)=>{pushed.push(JSON.parse(options.payload));return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({accepted:2})};}},
  htmlSafe_:String,htmlResult_:message=>({message}),openSheet_:()=>wb,readStore_:()=>st,
  tokenDigest_:()=> 'digest',LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this;}})},
  ScriptApp:{getService:()=>({getUrl:()=> 'https://script.google.com/macros/s/test/exec'})}
};
const assistance=new Function(...Object.keys(env),src+
  ';return {setupAssistance,assistRecipients_,assistHandle_,assistRaise_,assistWorker_,assistAllowedEndpoint_};'
)(...Object.values(env));
assistance.setupAssistance();
assert.deepEqual(assistance.assistRecipients_(st),['w1','w2'],'overlapping shifts must both be notified');
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/a',keys:{p256dh:'a'.repeat(85),auth:'B'.repeat(22)}};
assert.equal(assistance.assistHandle_(st,'worf@valid.test','assist.register',{subscription}).registered,true);
assistance.assistHandle_(st,'data@valid.test','assist.register',{subscription:{...subscription,endpoint:subscription.endpoint+'2'}});
assert.throws(()=>assistance.assistHandle_(st,'nobody@valid.test','assist.register',{subscription}),/Facilities team account/);
// The same endpoint cannot retain another account's registration.
assistance.assistHandle_(st,'data@valid.test','assist.register',{subscription});
assert.equal(assistance.assistHandle_(st,'worf@valid.test','assist.status',{}).myDevices,0);
assistance.assistHandle_(st,'worf@valid.test','assist.register',{subscription});
const created=assistance.assistHandle_(st,'geordi@valid.test','assist.create',{location:'Engineering',message:'Need a ladder'});
assert.equal(created.recipientCount,2);
assert.equal(pushed.length,1);
assert.equal(pushed[0].subscriptions.length,2);
assert(!JSON.stringify(pushed).includes('Engineering'),'lock-screen push must never carry specific location');
assert.deepEqual(assistance.assistHandle_(st,'worf@valid.test','assist.list',{}).map(a=>a.id),[created.id]);
assert.equal(assistance.assistHandle_(st,'worf@valid.test','assist.ack',{id:created.id}).status,'Acknowledged');
assert.equal(assistance.assistAllowedEndpoint_('https://attacker.example.com/sink'),false);
assert.equal(assistance.assistAllowedEndpoint_('http://fcm.googleapis.com/fcm/send/x'),false);
// No current watch -> acting building manager.
st.watches=[];st.settings.acting={pid:'m',from:'2026-10-29',to:'2026-10-30'};
assert.deepEqual(assistance.assistRecipients_(st),['m']);
// Public emailed visitor link: limited requests and unusable after departure.
st.log=[{id:'l1',tokenHash:'digest',tokenExpiry:String(Date.now()+3600000),workerOutAt:'',out:'',worker:'Geordi'}];
const token='t'.repeat(48);
assert(assistance.assistWorker_(token));
st.log[0].workerOutAt='2026-10-29T14:00:00Z';
assert.equal(assistance.assistWorker_(token),null);
let limited=false;
try{for(let i=0;i<4;i++)assistance.assistRaise_(st,{source:'Maintenance staff',visitorId:'l1',location:'Hall',message:'Need assistance'});}
catch(e){limited=e.code==='rate';}
assert(limited,'assistance email bearer must be rate-limited');
console.log('PASS: watch overlap, manager fallback, push fanout, payload privacy, subscriptions, auth, acknowledgements, worker expiry and rate limit');

(function(){
'use strict';
/* Public leadership preview only: private calendar data stays in this browser tab. */
var sources=[],seq=0,maxSources=5,importMax=1048576;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function localDate(ics){
 var v=String(ics||'').trim(),m;
 if((m=/^(\d{4})(\d{2})(\d{2})$/.exec(v)))return new Date(+m[1],+m[2]-1,+m[3]);
 if((m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v))){
  var args=[+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)];
  return m[7]?new Date(Date.UTC.apply(null,args)):new Date(...args);
 }
 return null;
}
function parseIcs(text){
 if(text.length>importMax)throw Error('The .ics file must be smaller than 1 MB.');
 var unfolded=text.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
 if(!unfolded.includes('BEGIN:VCALENDAR'))throw Error('This is not an iCalendar file.');
 var blocks=unfolded.match(/BEGIN:VEVENT\n[\s\S]*?\nEND:VEVENT/g)||[],events=[];
 blocks.slice(0,600).forEach(function(block){
  var a=null,b=null,title='Busy',rule='',cancel=false;
  block.split('\n').forEach(function(line){
   var m=/^([A-Z-]+)(?:;[^:]*)?:(.*)$/i.exec(line.trim());if(!m)return;
   var key=m[1].toUpperCase(),v=m[2];
   if(key==='DTSTART')a=localDate(v);
   if(key==='DTEND')b=localDate(v);
   if(key==='SUMMARY')title=v.replace(/\\n/gi,' ').slice(0,60);
   if(key==='RRULE')rule=v;
   if(key==='STATUS'&&v.toUpperCase()==='CANCELLED')cancel=true;
  });
  if(!cancel&&a&&b&&b>a)events.push({start:a,end:b,title:title,rule:rule});
 });
 if(!events.length)throw Error('No supported events found in this file.');
 return events;
}
function weekStart(){
 var match=document.querySelector('.availtop h3')?.textContent.match(/\d{4}-\d{2}-\d{2}/);
 if(!match)return null;
 var p=match[0].split('-').map(Number);
 return new Date(p[0],p[1]-1,p[2]);
}
function allEvents(src,day,weekday){
 if(src.kind==='sample'){
  var examples=src.which==='google'?[{d:1,h:10,m:0,len:90,t:'Personal appointment'},{d:3,h:13,m:30,len:60,t:'Appointment'}]:
   [{d:0,h:9,m:0,len:120,t:'Work meeting'},{d:2,h:12,m:0,len:90,t:'Rehearsal'},{d:4,h:14,m:0,len:60,t:'Training'}];
  return examples.filter(function(e){return e.d===weekday;}).map(function(e){
   var a=new Date(day.getFullYear(),day.getMonth(),day.getDate(),e.h,e.m);
   return {start:a,end:new Date(a.getTime()+e.len*60000),title:e.t};
  });
 }
 if(src.kind!=='file')return [];
 var results=[],startDay=new Date(day.getFullYear(),day.getMonth(),day.getDate()),
     finishDay=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1);
 (src.events||[]).forEach(function(e){
  if(!e.rule){if(e.start<finishDay&&e.end>startDay)results.push(e);return;}
  var rule={};e.rule.split(';').forEach(function(part){var p=part.split('=');rule[p[0]]=p[1];});
  if(rule.FREQ!=='WEEKLY'&&rule.FREQ!=='DAILY')return;
  var init=e.start,diff=Math.round((Date.UTC(day.getFullYear(),day.getMonth(),day.getDate())-
   Date.UTC(init.getFullYear(),init.getMonth(),init.getDate()))/86400000),intv=Math.max(1,+rule.INTERVAL||1);
  if(diff<0)return;
  if(rule.FREQ==='DAILY'&&diff%intv)return;
  if(rule.FREQ==='WEEKLY'&&Math.floor(diff/7)%intv)return;
  var dayname=['SU','MO','TU','WE','TH','FR','SA'][day.getDay()];
  if(rule.FREQ==='WEEKLY'&&!(rule.BYDAY?rule.BYDAY.split(',').some(function(x){return x.endsWith(dayname);}):day.getDay()===init.getDay()))return;
  var ymd=day.getFullYear()*10000+(day.getMonth()+1)*100+day.getDate();
  if(rule.UNTIL&&ymd>+rule.UNTIL.slice(0,8))return;
  var start=new Date(day.getFullYear(),day.getMonth(),day.getDate(),init.getHours(),init.getMinutes());
  results.push({start:start,end:new Date(start.getTime()+e.end-e.start),title:e.title});
 });
 return results;
}
function mapBusy(){
 var monday=weekStart(),map=new Map();if(!monday)return map;
 for(var day=0;day<5;day++){
  var date=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+day);
  sources.filter(function(s){return s.on;}).forEach(function(s){
   allEvents(s,date,day).forEach(function(event){
    for(var slot=0;slot<18;slot++){
     var start=new Date(date.getFullYear(),date.getMonth(),date.getDate(),8,slot*30),end=new Date(start.getTime()+1800000);
     if(start<event.end&&end>event.start){
      var key=day+'-'+slot;if(!map.has(key))map.set(key,[]);
      map.get(key).push(s.label+': '+event.title);
     }
    }
   });
  });
 }
 return map;
}
function paintBusy(){
 var grid=document.getElementById('availGrid');if(!grid)return;
 var busy=mapBusy(),conflicts=0;
 grid.querySelectorAll('td[data-day][data-slot]').forEach(function(cell){
  var key=cell.dataset.day+'-'+cell.dataset.slot,list=busy.get(key)||[],
      marked=cell.getAttribute('aria-checked')==='true';
  cell.classList.toggle('other-busy',list.length>0);
  cell.classList.toggle('other-conflict',list.length>0&&marked);
  if(list.length&&marked)conflicts++;
  var original=(cell.getAttribute('aria-label')||'').split(' · Other calendars:')[0];
  cell.setAttribute('aria-label',original+(list.length?' · Other calendars: '+list.join('; '):''));
  cell.title=list.join('; ');
 });
 var line=document.getElementById('otherCalendarStatus');
 if(line)line.textContent=busy.size+' busy half-hour blocks · '+conflicts+
  ' conflict(s) with your marked availability. Imported events do not change your availability.';
}
function feedback(msg,bad){
 var p=document.getElementById('calendarImportStatus');
 if(p){p.textContent=msg;p.style.color=bad?'#aa392c':'#287451';}
}
function listSources(){
 var box=document.getElementById('calSources');if(!box)return;
 box.innerHTML=sources.length?sources.map(function(s){
  var state=s.kind==='sample'?'Illustrative events':s.kind==='file'?'.ics loaded locally, not uploaded':'Production connection required';
  return '<div class="cal-source"><label><input data-source-toggle="'+esc(s.id)+'" type="checkbox" '+(s.on?'checked':'')+
   (s.kind==='remote'?' disabled':'')+'> <span><b>'+esc(s.label)+'</b><small>'+state+
   '</small></span></label><button type="button" class="btn small" data-source-remove="'+esc(s.id)+'">Remove</button></div>';
 }).join(''):'<p class="subtitle">No personal calendars selected yet.</p>';
 box.querySelectorAll('[data-source-toggle]').forEach(function(input){input.onchange=function(){
  var s=sources.find(function(x){return x.id===input.dataset.sourceToggle;});if(s)s.on=input.checked;paintBusy();
 };});
 box.querySelectorAll('[data-source-remove]').forEach(function(btn){btn.onclick=function(){
  var i=sources.findIndex(function(x){return x.id===btn.dataset.sourceRemove;});
  if(i>=0)sources.splice(i,1);listSources();paintBusy();
 };});
}
function insertSample(which){
 if(sources.length>=maxSources){feedback('You can view up to five calendars.',true);return;}
 sources.push({id:'c'+(++seq),kind:'sample',which:which,
 label:which==='google'?'Personal Google Calendar (sample)':'Work Outlook Calendar (sample)',on:true});
 listSources();paintBusy();feedback('Sample calendar added. Diagonal stripes indicate busy times.');
}
async function uploadIcs(input){
 for(var file of Array.from(input.files||[])){
  if(sources.length>=maxSources){feedback('Five-calendar limit reached.',true);break;}
  if(file.size>importMax){feedback('File too large: '+file.name,true);continue;}
  try{
   var events=parseIcs(await file.text());
   sources.push({id:'c'+(++seq),kind:'file',label:file.name.slice(0,80),events:events,on:true});
   feedback('Imported '+events.length+' events from '+file.name+'. Kept only in this browser tab.');
  }catch(e){feedback(file.name+': '+e.message,true);}
 }
 input.value='';listSources();paintBusy();
}
function addUrl(form){
 var url=form.elements.calendarUrl.value.trim(),name=form.elements.calendarName.value.trim()||'Calendar';
 var u;try{u=new URL(url);}catch(e){feedback('Please enter a valid HTTPS iCalendar link.',true);return;}
 if(u.protocol!=='https:'||u.username||u.password||
  !/^(calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com|outlook\.office\.com|[a-z0-9.-]+\.icloud\.com)$/i.test(u.hostname)){
  feedback('Only HTTPS Google, Outlook and iCloud calendar links are supported.',true);return;
 }
 if(sources.length>=maxSources){feedback('Five-calendar limit reached.',true);return;}
 sources.push({id:'c'+(++seq),kind:'remote',label:name,on:false});
 form.reset();listSources();paintBusy();
 feedback('Feed setup illustrated; this static demo does not fetch URLs. Production Hostinger PHP handles remote calendar feeds.');
}
function mount(){
 var grid=document.getElementById('availGrid');if(!grid||document.getElementById('otherCalendarsPanel'))return;
 var panel=document.createElement('section');
 panel.id='otherCalendarsPanel';panel.className='other-cal-panel';
 panel.innerHTML='<div class="cal-head"><div><h3>My other calendars</h3>'+
  '<p class="subtitle">Compare other Google, Outlook or iCloud calendars with your swipe availability. '+
  'Striped blocks are already busy; blue is time you are available.</p></div><span class="chip">Read-only overlays</span></div>'+
  '<div id="calSources" class="cal-sources"></div>'+
  '<div class="buttonrow"><button class="btn small" type="button" id="calAddGoogle">+ Sample Google calendar</button>'+
  '<button class="btn small" type="button" id="calAddOutlook">+ Sample Outlook calendar</button></div>'+
  '<div class="cal-file"><label class="field">Import calendar file (.ics)'+
  '<input id="calFile" type="file" multiple accept=".ics,text/calendar"></label>'+
  '<p class="subtitle">This is a working import; events stay inside this browser tab and are cleared on reload.</p></div>'+
  '<details class="cal-url"><summary>Connect published Google / Outlook / iCloud calendar link</summary>'+
  '<p class="subtitle">Your production Hostinger PHP backend supports personal read-only .ics URLs. '+
  'This public demo cannot fetch remote feeds. Never paste a real secret calendar link into a public demonstration.</p>'+
  '<form id="calUrlForm" class="cal-urlform"><label class="field">Calendar name<input name="calendarName" required placeholder="My personal calendar"></label>'+
  '<label class="field">Published iCalendar HTTPS URL<input type="url" name="calendarUrl" required placeholder="https://calendar.google.com/calendar/ical/..."></label>'+
  '<button class="btn small" type="submit">Add URL (preview setup only)</button></form>'+
  '<p class="subtitle">Google: Calendar Settings → your calendar → Integrate calendar → Secret iCal address. '+
  'Outlook: Shared calendars → Publish → ICS. iCloud: Public Calendar sharing exposes details publicly.</p></details>'+
  '<p id="calendarImportStatus" role="status" aria-live="polite" class="subtitle"></p>'+
  '<p class="subtitle"><span class="cal-swatch"></span> Other calendar busy &nbsp; '+
  '<span class="cal-swatch conflict"></span> Overlap with your availability</p>'+
  '<p id="otherCalendarStatus" aria-live="polite" class="subtitle"></p>';
 grid.closest('.tablewrap').before(panel);
 document.getElementById('calAddGoogle').onclick=function(){insertSample('google');};
 document.getElementById('calAddOutlook').onclick=function(){insertSample('outlook');};
 document.getElementById('calFile').onchange=function(){uploadIcs(this);};
 document.getElementById('calUrlForm').onsubmit=function(e){e.preventDefault();addUrl(this);};
 function update(){requestAnimationFrame(paintBusy);}
 grid.addEventListener('pointerup',update);grid.addEventListener('keydown',update);grid.addEventListener('click',update);
 listSources();paintBusy();
}
function boot(){
 var screen=document.getElementById('screen');if(!screen)return;
 new MutationObserver(mount).observe(screen,{childList:true,subtree:true});mount();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();

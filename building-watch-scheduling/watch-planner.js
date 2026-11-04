/* Deterministic, browser-only weekly watch recommender; neither changes nor adds backend endpoints. */
(function(root){"use strict";
  const hour=n=>Math.round(n*10)/10;
  function create(input) {
    const people=(input.people||[]).filter(p=>p.watch&&p.active!==false);
    const wk=input.week||[],av=input.avail||[],base=input.watches||[];
    const std=(input.grid&&input.grid.std)||[[1,5],[13,17]],size=(input.grid&&input.grid.ns)||33;
    const index=new Map(av.map(a=>[a.pid+"|"+a.date,a]));
    const row=(pid,date)=>index.get(pid+"|"+date);
    function available(pid,date,s,e){
      const a=row(pid,date);if(!a)return 0;
      let n=0;for(let i=s;i<e;i++)if(a.slots&&a.slots[i]==="1")n++;return n;
    }
    function assigned(pid,rows){
      return hour(rows.filter(w=>w.pid===pid&&wk.includes(w.date)).reduce((n,w)=>n+Math.max(0,+w.e-(+w.s))*.5,0));
    }
    function personSummary(p,rows){
      let submitted=0,availableSlots=0,zeroDays=0;
      wk.forEach(date=>{const a=row(p.id,date);if(!a)return;submitted++;
        let n=0;for(let i=0;i<size;i++)if(a.slots&&a.slots[i]==="1")n++;
        availableSlots+=n;if(!n)zeroDays++;
      });
      return {p,submitted,zeroDays,availableHours:hour(availableSlots*.5),assignedHours:assigned(p.id,rows||base)};
    }
    function candidates(date,s,e,rows){
      const data=rows||base;
      return people.map(p=>{
        const sum=personSummary(p,data),a=row(p.id,date),n=available(p.id,date,s,e);
        const overlap=data.some(w=>w.pid===p.id&&w.date===date&&w.s<e&&w.e>s);
        const state=n===e-s?"Available entire shift":n>0?"Partially available":
          !a&&!sum.submitted?"No schedule submitted":!a?"No entry for this day":"Unavailable for this shift";
        const category=n===e-s?0:n>0?1:!a?2:3;
        return {p,state,category,overlap,coverage:n,required:e-s,
          assignedHours:sum.assignedHours,availableHours:sum.availableHours,
          monthCount:(input.monthCounts||{})[p.id]||0,
          load:sum.assignedHours/Math.max(1,sum.availableHours),submitted:sum.submitted};
      }).sort((a,b)=>a.category-b.category||Number(a.overlap)-Number(b.overlap)||
        a.load-b.load||a.assignedHours-b.assignedHours||a.monthCount-b.monthCount||
        b.availableHours-a.availableHours||a.p.name.localeCompare(b.p.name));
    }
    function plan(includeExceptions){
      const working=base.map(w=>({...w})),proposals=[],skipped=[],unfilled=[];
      wk.forEach(date=>std.forEach(([s,e])=>{
        if(s<0||e>size||e<=s)return;
        if(working.some(w=>w.date===date&&w.s<e&&w.e>s)){
          skipped.push({date,s,e,reason:"Existing watch preserved"});return;
        }
        const ranked=candidates(date,s,e,working).filter(c=>!c.overlap);
        let win=ranked.find(c=>c.category===0);
        if(!win&&includeExceptions)win=ranked[0];
        if(!win){unfilled.push({date,s,e,reason:"No fully available person"});return;}
        proposals.push({date,s,e,pid:win.p.id,name:win.p.name,state:win.state,
          exception:win.category!==0,hours:hour((e-s)*.5),beforeHours:win.assignedHours});
        working.push({date,s,e,pid:win.p.id});
      }));
      return {proposals,skipped,unfilled,total:wk.length*std.length};
    }
    return {candidates,plan,summary:()=>people.map(p=>personSummary(p)).sort((a,b)=>a.p.name.localeCompare(b.p.name))};
  }
  root.BWWatchPlanner={create};
})(typeof window!=="undefined"?window:this);

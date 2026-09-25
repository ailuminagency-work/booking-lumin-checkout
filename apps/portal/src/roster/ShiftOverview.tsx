import {useMemo,useState} from 'react';
import type {RosterSnapshot} from '@lumin/flow-ui';

type KindFilter='all'|'available'|'blocked';
type StatusFilter='all'|'active'|'retired';

function displayTime(instant:string,zone:string){
 const options:Intl.DateTimeFormatOptions={year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone};
 try{return {text:new Intl.DateTimeFormat(undefined,options).format(new Date(instant)),zone,fallback:false};}
 catch{return {text:new Intl.DateTimeFormat(undefined,{...options,timeZone:'UTC'}).format(new Date(instant)),zone:'UTC',fallback:true};}
}

/** Read-only projection of a single accepted roster snapshot. */
export function ShiftOverview({snapshot}:{snapshot:RosterSnapshot}){
 const [query,setQuery]=useState(''),[kind,setKind]=useState<KindFilter>('all'),[status,setStatus]=useState<StatusFilter>('all');
 const rows=useMemo(()=>{
  const workers=new Map(snapshot.workers.map(worker=>[worker.id.toLowerCase(),worker.displayName]));
  const term=query.trim().toLocaleLowerCase();
  return snapshot.shifts.filter(shift=>{
   const name=workers.get(shift.workerId.toLowerCase())??'';
   return name.toLocaleLowerCase().includes(term)&&(kind==='all'||shift.kind===kind)&&(status==='all'||shift.active===(status==='active'));
  }).sort((a,b)=>a.startsAt<b.startsAt?-1:a.startsAt>b.startsAt?1:a.id<b.id?-1:a.id>b.id?1:0).map(shift=>({shift,workerName:workers.get(shift.workerId.toLowerCase())??'Unknown worker'}));
 },[snapshot,query,kind,status]);
 return <section aria-labelledby="recorded-shifts-title"><h2 id="recorded-shifts-title">Recorded shifts</h2>
  <p>Read-only shifts recorded for this roster. These entries do not promise booking availability.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem'}}>
   <label>Search shift workers<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label>Shift kind<select value={kind} onChange={e=>setKind(e.target.value as KindFilter)}><option value="all">All kinds</option><option value="available">Available</option><option value="blocked">Blocked</option></select></label>
   <label>Shift status<select value={status} onChange={e=>setStatus(e.target.value as StatusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="retired">Retired</option></select></label>
  </div>
  {snapshot.shifts.length===0?<p>No recorded shifts.</p>:rows.length===0?<p>No recorded shifts match these filters.</p>:<ul>{rows.map(({shift,workerName})=>{
   const start=displayTime(shift.startsAt,shift.sourceTimeZone),end=displayTime(shift.endsAt,shift.sourceTimeZone);
   return <li key={shift.id} style={{marginBlock:'0.75rem',overflowWrap:'anywhere'}}><strong>{workerName}</strong> · {shift.kind==='blocked'?'Blocked':'Available'} · {shift.active?'Active':'Retired'}<br/>
    <span>Start: {start.text}</span><br/><span>End: {end.text}</span><br/><span>Time zone: {start.zone}</span>{start.fallback&&<span> (UTC display fallback; recorded zone: {shift.sourceTimeZone})</span>}
   </li>;
  })}</ul>}
 </section>;
}

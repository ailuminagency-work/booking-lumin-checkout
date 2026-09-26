import {useMemo,useState} from 'react';
import type {RosterSnapshot} from '@lumin/flow-ui';

type KindFilter='all'|'available'|'blocked';
type StatusFilter='all'|'active'|'retired';

function displayTime(instant:string,zone:string){
 const options:Intl.DateTimeFormatOptions={year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone};
 try{return {text:new Intl.DateTimeFormat(undefined,options).format(new Date(instant)),zone,fallback:false};}
 catch{return {text:new Intl.DateTimeFormat(undefined,{...options,timeZone:'UTC'}).format(new Date(instant)),zone:'UTC',fallback:true};}
}

/** The overview reads one accepted roster snapshot; retirement is delegated to its owner. */
export function ShiftOverview({snapshot,canRetire=false,onRetire}:{snapshot:RosterSnapshot;canRetire?:boolean;onRetire?:(shift:RosterSnapshot['shifts'][number],rosterVersion:number)=>void}){
 const [query,setQuery]=useState(''),[kind,setKind]=useState<KindFilter>('all'),[status,setStatus]=useState<StatusFilter>('all');
 const [pending,setPending]=useState<{id:string;kind:'available'|'blocked';rosterVersion:number;fingerprint:string}|null>(null);
 const fingerprint=(shift:RosterSnapshot['shifts'][number])=>JSON.stringify([shift.id.toLowerCase(),shift.workerId.toLowerCase(),shift.kind,shift.startsAt,shift.endsAt,shift.sourceTimeZone,shift.active]);
 const rows=useMemo(()=>{
  const workers=new Map(snapshot.workers.map(worker=>[worker.id.toLowerCase(),worker.displayName]));
  const term=query.trim().toLocaleLowerCase();
  return snapshot.shifts.filter(shift=>{
   const name=workers.get(shift.workerId.toLowerCase())??'';
   return name.toLocaleLowerCase().includes(term)&&(kind==='all'||shift.kind===kind)&&(status==='all'||shift.active===(status==='active'));
  }).sort((a,b)=>a.startsAt<b.startsAt?-1:a.startsAt>b.startsAt?1:a.id<b.id?-1:a.id>b.id?1:0).map(shift=>({shift,workerName:workers.get(shift.workerId.toLowerCase())??'Unknown worker'}));
 },[snapshot,query,kind,status]);
 const selected=pending?.rosterVersion===snapshot.rosterVersion?snapshot.shifts.find(shift=>shift.id.toLowerCase()===pending.id.toLowerCase()&&shift.kind===pending.kind&&shift.active&&fingerprint(shift)===pending.fingerprint):undefined;
 const selectedWorker=selected&&snapshot.workers.find(worker=>worker.id.toLowerCase()===selected.workerId.toLowerCase());
 return <section aria-labelledby="recorded-shifts-title"><h2 id="recorded-shifts-title">Recorded shifts</h2>
  <p>Shifts recorded for this roster. These entries do not promise booking availability. Active available and blocked shifts can be retired; booking scheduling remains authoritative elsewhere.</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem'}}>
   <label>Search shift workers<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label>Shift kind<select value={kind} onChange={e=>setKind(e.target.value as KindFilter)}><option value="all">All kinds</option><option value="available">Available</option><option value="blocked">Blocked</option></select></label>
   <label>Shift status<select value={status} onChange={e=>setStatus(e.target.value as StatusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="retired">Retired</option></select></label>
  </div>
  {snapshot.shifts.length===0?<p>No recorded shifts.</p>:rows.length===0?<p>No recorded shifts match these filters.</p>:<ul>{rows.map(({shift,workerName})=>{
   const start=displayTime(shift.startsAt,shift.sourceTimeZone),end=displayTime(shift.endsAt,shift.sourceTimeZone);
   return <li key={shift.id} style={{marginBlock:'0.75rem',overflowWrap:'anywhere'}}><strong>{workerName}</strong> · {shift.kind==='blocked'?'Blocked':'Available'} · {shift.active?'Active':'Retired'}<br/>
    <span>Start: {start.text}</span><br/><span>End: {end.text}</span><br/><span>Time zone: {start.zone}</span>{start.fallback&&<span> (UTC display fallback; recorded zone: {shift.sourceTimeZone})</span>}
    {shift.active&&onRetire&&<div><button type="button" aria-label={`Retire ${shift.kind} shift for ${workerName}, ${start.text} to ${end.text} (${shift.sourceTimeZone}); record ${shift.id}`} disabled={!canRetire} onClick={()=>setPending({id:shift.id,kind:shift.kind,rosterVersion:snapshot.rosterVersion,fingerprint:fingerprint(shift)})}>Retire {shift.kind==='blocked'?'blocked time off':'available shift'}</button></div>}
   </li>;
  })}</ul>}
  {pending&&<div role="group" aria-label="Confirm shift retirement"><h3>Retire {pending.kind==='blocked'?'blocked time off':'available shift'}?</h3>
   {selected&&selectedWorker?<p>{selectedWorker.displayName}: {displayTime(selected.startsAt,selected.sourceTimeZone).text} to {displayTime(selected.endsAt,selected.sourceTimeZone).text} ({selected.sourceTimeZone}). Retiring this recorded shift does not cancel bookings or release holds. Booking availability is managed separately.</p>:<p>This shift changed. Refresh and review the roster before trying again.</p>}
   <button type="button" disabled={!selected||!selectedWorker||!canRetire||!onRetire} onClick={()=>{if(selected&&selectedWorker&&onRetire){onRetire(selected,pending.rosterVersion);setPending(null);}}}>Confirm retirement</button>
   <button type="button" onClick={()=>setPending(null)}>Cancel</button>
  </div>}
 </section>;
}

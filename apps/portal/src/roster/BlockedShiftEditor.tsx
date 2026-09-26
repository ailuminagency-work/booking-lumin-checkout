import {useEffect,useState} from 'react';
import type {RosterSnapshot} from '@lumin/flow-ui';

/** Resolve a wall minute only when it maps to exactly one instant in the chosen zone. */
export function uniqueWallMinute(value:string,zone:string):string|null{
 const match=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value);
 if(!match)return null;
 const wall=Date.parse(value+':00Z');
 if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==value)return null;
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',minute:'2-digit'});}catch{return null;}
 const render=(instant:number)=>{const parts=formatter.formatToParts(new Date(instant));const item=(kind:string)=>parts.find(p=>p.type===kind)?.value;return `${item('year')}-${item('month')}-${item('day')}T${item('hour')}:${item('minute')}`;};
 const offsets=new Set<number>();
 for(let delta=-16*60;delta<=16*60;delta+=30){const sample=wall+delta*60000;const local=render(sample);const parsed=Date.parse(local+':00Z');if(Number.isFinite(parsed))offsets.add(parsed-sample);}
 const candidates=[...offsets].map(offset=>wall-offset).filter(candidate=>render(candidate)===value);
 return candidates.length===1?new Date(candidates[0]!).toISOString().replace('.000Z','.000000Z'):null;
}

export function BlockedShiftEditor({snapshot,disabled,resetCounter,onCreate}:{snapshot:RosterSnapshot;disabled:boolean;resetCounter:number;onCreate:(draft:{workerId:string;startsAt:string;endsAt:string;sourceTimeZone:string},version:number)=>void}){
 const [workerId,setWorkerId]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[zone,setZone]=useState('UTC');
 const [error,setError]=useState('');
 useEffect(()=>{setWorkerId('');setStart('');setEnd('');setZone('UTC');setError('');},[resetCounter]);
 const workers=snapshot.workers.filter(w=>w.active);
 function submit(){
  setError('');const startsAt=uniqueWallMinute(start,zone),endsAt=uniqueWallMinute(end,zone);
  if(!workers.some(w=>w.id===workerId)||!startsAt||!endsAt||Date.parse(endsAt)<=Date.parse(startsAt)){setError('Choose an active worker and valid start/end times. A time skipped or repeated by daylight saving cannot be used.');return;}
  onCreate({workerId,startsAt,endsAt,sourceTimeZone:zone},snapshot.rosterVersion);
 }
 return <section aria-labelledby="blocked-shift-editor-title"><h2 id="blocked-shift-editor-title">Record worker time off</h2>
  <p>This records a blocked shift for the team. Booking availability and existing bookings are controlled separately.</p>
  {workers.length===0?<p>Add an active worker before recording time off.</p>:<fieldset disabled={disabled}>
   <label>Worker for time off<select value={workerId} onChange={e=>{setWorkerId(e.target.value);setError('');}}><option value="">Choose worker</option>{workers.map(w=><option key={w.id} value={w.id}>{w.displayName}</option>)}</select></label>
   <label>Start local time<input type="datetime-local" value={start} onChange={e=>{setStart(e.target.value);setError('');}}/></label>
   <label>End local time<input type="datetime-local" value={end} onChange={e=>{setEnd(e.target.value);setError('');}}/></label>
   <label>Time zone<input value={zone} onChange={e=>{setZone(e.target.value);setError('');}} placeholder="America/Los_Angeles"/></label>
   <button type="button" onClick={submit}>Record time off</button>
  </fieldset>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}

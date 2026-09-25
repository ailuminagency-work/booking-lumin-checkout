import {useMemo,useState} from 'react';
import type {RosterSnapshot} from '@lumin/flow-ui';

type Filter='all'|'active'|'retired';
export function WorkerDirectory({snapshot,phase,selectedId,navigationBlocked,onView}:{
 snapshot?:RosterSnapshot; phase:'loading'|'ready'|'uninitialized'|'blocked'|'denied'|'unavailable';
 selectedId:string; navigationBlocked:boolean; onView:(id:string)=>void;
}){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<Filter>('all');
 const rows=useMemo(()=>{
  if(phase!=='ready'||!snapshot)return [];
  const term=query.trim().toLocaleLowerCase();
  return snapshot.workers.filter(w=>(filter==='all'||w.active===(filter==='active'))&&w.displayName.toLocaleLowerCase().includes(term));
 },[snapshot,phase,query,filter]);
 return <section aria-labelledby="worker-directory-title"><h2 id="worker-directory-title">Worker directory</h2>
  <p>Browse workers, crews and service eligibility. Login access, assignments and availability are managed elsewhere.</p>
  {phase==='loading'&&<p role="status">Loading worker directory.</p>}
  {phase==='blocked'&&<p role="status">Worker directory is unavailable until the roster is refreshed.</p>}
  {phase==='denied'&&<p role="status">Worker directory is unavailable for this account.</p>}
  {phase==='uninitialized'&&<p>No roster has been set up.</p>}
  {phase==='unavailable'&&<p>Worker directory is unavailable in this workspace.</p>}
  {phase==='ready'&&snapshot&&<>
   <div style={{display:'flex',flexWrap:'wrap',gap:'0.75rem'}}>
    <label>Search workers<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <label>Worker status<select value={filter} onChange={e=>setFilter(e.target.value as Filter)}><option value="all">All workers</option><option value="active">Active workers</option><option value="retired">Retired workers</option></select></label>
   </div>
   {navigationBlocked&&<p role="status">Save or discard the current worker edits before viewing another worker.</p>}
   {snapshot.workers.length===0?<p>No workers have been added.</p>:rows.length===0?<p>No workers match this search and status.</p>:<ul>{rows.map(w=>{
    const crews=snapshot.crews.filter(c=>c.workerIds.includes(w.id));
    const eligible=snapshot.eligibility.filter(e=>e.workerId===w.id&&e.active).map(e=>snapshot.services.find(s=>s.id===e.serviceId)).filter((s):s is RosterSnapshot['services'][number]=>!!s);
    return <li key={w.id} style={{marginBlock:'1rem'}}><strong>{w.displayName}</strong> — {w.active?'Active':'Retired'}
     <div>Crews: {crews.length?crews.map(c=>`${c.name}${c.active?'':' (retired crew)'}`).join(', '):'None'}</div>
     <div>Service eligibility: {eligible.length?eligible.map(s=>`${s.name||'Unnamed service'}${s.active?'':' (inactive service)'}`).join(', '):'None'}</div>
     <button type="button" disabled={navigationBlocked||selectedId===w.id} onClick={()=>onView(w.id)} aria-label={`View worker ${w.displayName}`}>View worker</button>
    </li>;
   })}</ul>}
  </>}
 </section>;
}

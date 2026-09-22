import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {createRuntimeClient,type RuntimeConfig,type ServiceRow} from '@lumin/runtime-client';
export function ConnectedCheckout({config}:{config:RuntimeConfig}){
 const client=useMemo(()=>{try{return createRuntimeClient(config)}catch{return null}},[config.url,config.publishableKey,config.tenantId]);
 const [services,setServices]=useState<ServiceRow[]>([]),[service,setService]=useState(''),[date,setDate]=useState(''),[name,setName]=useState(''),[email,setEmail]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const key=useRef<string|undefined>(undefined);
 useEffect(()=>{let live=true;if(!client){setLoading(false);return}setLoading(true);client.services().then(rows=>{if(live){setServices(rows);setService(rows[0]?.id??'')}}).catch(()=>{if(live)setError('The service catalog could not be loaded. Reload to retry.')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[client]);
 const changed=()=>{key.current=undefined;setError('')};
 async function submit(e:FormEvent){e.preventDefault();if(!client||busy||saved)return;setError('');setBusy(true);
  try{const selected=services.find(s=>s.id===service);const start=new Date(date);if(!selected||!Number.isFinite(start.getTime())||start.getTime()<=Date.now())throw Error('Choose a service and a future date.');
   key.current??=crypto.randomUUID();const result=await client.saveDraft({serviceId:service,slotStart:start.toISOString(),slotEnd:new Date(start.getTime()+selected.duration_minutes*60_000).toISOString(),customer:{name:name.trim(),email:email.trim()},idempotencyKey:key.current});setSaved(result.reference);
  }catch(e){setError(e instanceof Error?e.message:'Request unavailable. Retry this same request.')}finally{setBusy(false)}
 }
 return <main style={{maxWidth:720,margin:'40px auto',padding:24}}><p>Booking Lumin · Connected preview</p><h1>Request a service</h1><p>Save a request directly to the business. This does not charge a payment or reserve availability.</p>
 {!client?<p role="alert">Connected mode configuration is missing or invalid.</p>:saved?<section role="status"><h2>Request saved — unconfirmed</h2><p>Your reference is <strong>{saved}</strong>.</p><p>No payment was taken and no appointment is guaranteed.</p><button onClick={()=>{setSaved('');key.current=undefined;setDate('')}}>Start another request</button></section>:loading?<p role="status">Loading services…</p>:services.length===0?<p>No active simple services are available for requests.</p>:<form onSubmit={submit}><fieldset disabled={busy} style={{display:'grid',gap:16,border:0,padding:0}}>
 <label>Service<select value={service} onChange={e=>{changed();setService(e.target.value)}} required style={{display:'block',width:'100%'}}>{services.map(s=><option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} minutes</option>)}</select></label>
 <label>Desired date and time ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input type="datetime-local" value={date} onChange={e=>{changed();setDate(e.target.value)}} required style={{display:'block',width:'100%'}}/></label>
 <label>Your name<input autoComplete="name" maxLength={150} required value={name} onChange={e=>{changed();setName(e.target.value)}} style={{display:'block',width:'100%'}}/></label>
 <label>Email<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>{changed();setEmail(e.target.value)}} style={{display:'block',width:'100%'}}/></label>
 <button type="submit">{busy?'Saving request…':'Save unconfirmed request'}</button></fieldset></form>}{error&&<p role="alert">{error}</p>}</main>
}

import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createRuntimeClient,type PublicRuntimeConfig,type PaidJourneyCustomerSession,type PaidJourneyAvailability} from '@lumin/runtime-client';

const field:CSSProperties={width:'100%',minWidth:0,maxWidth:'100%',boxSizing:'border-box'};
const timeoutMs=30000;
const today=()=>new Date().toISOString().slice(0,10);
function windowFor(date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return undefined;
 const start=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==date)return undefined;
 return {from:start.toISOString(),to:new Date(start.getTime()+86400000).toISOString()};
}

/** Dedicated V8 availability surface. Stage order grants no booking or payment capability. */
export function HostedJourneyFlow({installationId,config}:{installationId:string;config:PublicRuntimeConfig}){
 const client=useMemo(()=>{try{
  if(config.mode!=='supabase'||!config.flowApiOrigin||location.protocol!=='https:')return null;
  return createRuntimeClient({url:config.supabaseUrl,publishableKey:config.supabasePublishableKey,tenantId:config.tenantId,bookingApiOrigin:config.flowApiOrigin});
 }catch{return null;}},[config.mode,config.flowApiOrigin,config.supabaseUrl,config.supabasePublishableKey,config.tenantId]);
 const [sessionReceipt,setSessionReceipt]=useState<{session:PaidJourneyCustomerSession;context:string}|null>(null);
 const [opening,setOpening]=useState(false),[message,setMessage]=useState('');
 const [date,setDate]=useState(today),[availability,setAvailability]=useState<PaidJourneyAvailability|null>(null);
 const [loading,setLoading]=useState(false),[availabilityMessage,setAvailabilityMessage]=useState(''),[selected,setSelected]=useState('');
 const [stage,setStage]=useState(0),[name,setName]=useState(''),[email,setEmail]=useState('');
 const epoch=useRef(0),openingRef=useRef(false),openingAbort=useRef<AbortController|null>(null);
 const openingTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const context=installationId+'|'+config.mode+'|'+config.flowApiOrigin+'|'+config.supabaseUrl+'|'+config.supabasePublishableKey+'|'+config.tenantId;
 const session=sessionReceipt?.context===context?sessionReceipt.session:null;
 const setSession=(value:PaidJourneyCustomerSession|null)=>setSessionReceipt(value?{session:value,context}:null);
 const currentContext=useRef(context);currentContext.current=context;
 useEffect(()=>{
  epoch.current++;openingRef.current=false;openingAbort.current?.abort();clearTimeout(openingTimer.current);
  setOpening(false);setSession(null);setMessage('');setAvailability(null);setSelected('');setStage(0);setName('');setEmail('');setDate(today());
  return()=>{epoch.current++;openingRef.current=false;openingAbort.current?.abort();clearTimeout(openingTimer.current);};
 },[client,installationId]);
 async function open(){
  if(!client||openingRef.current)return;
  const run=++epoch.current,captured=context,controller=new AbortController();openingAbort.current?.abort();openingAbort.current=controller;
  openingRef.current=true;setOpening(true);setMessage('');setSession(null);setAvailability(null);setSelected('');setStage(0);setName('');setEmail('');
  const active=()=>epoch.current===run&&currentContext.current===captured&&!controller.signal.aborted;
  openingTimer.current=setTimeout(()=>{if(!active())return;controller.abort();epoch.current++;openingRef.current=false;setOpening(false);setMessage('The temporary session could not be verified. A temporary session may have been issued; no booking or payment was made. Open again only when you are ready.');},timeoutMs);
  try{const next=await client.issuePaidJourneySession(installationId,{signal:controller.signal});if(active()){setSession(next);setDate(today());}}
  catch{if(active())setMessage('The temporary session could not be verified. A temporary session may have been issued; no booking or payment was made. Open again only when you are ready.');}
  finally{if(epoch.current===run){clearTimeout(openingTimer.current);openingRef.current=false;setOpening(false);}}
 }
 useEffect(()=>{
  if(!session)return;
  const timer=setTimeout(()=>{epoch.current++;setSession(null);setAvailability(null);setSelected('');setName('');setEmail('');setStage(0);setMessage('Your temporary session expired. No slot was reserved and no booking or payment was made. Open a new session to check availability.');},Math.max(0,Date.parse(session.expiresAt)-Date.now()));
  return()=>clearTimeout(timer);
 },[session]);
 useEffect(()=>{
  setAvailability(null);setSelected('');setAvailabilityMessage('');setLoading(false);
  if(!session||!client)return;
  const window=windowFor(date);if(!window){setAvailabilityMessage('Choose a valid calendar date.');return;}
  const controller=new AbortController(),run=epoch.current,captured=context;let live=true;
  const active=()=>live&&!controller.signal.aborted&&epoch.current===run&&currentContext.current===captured&&Date.parse(session.expiresAt)>Date.now();
  setLoading(true);
  const timer=setTimeout(()=>{if(!active())return;controller.abort();setLoading(false);setAvailabilityMessage('Availability could not be verified. Choose a date again to check; no slot was reserved.');},timeoutMs);
  void client.readPaidJourneyAvailability(session,window,{signal:controller.signal}).then(next=>{if(active()){setAvailability(next);setLoading(false);}},()=>{if(active()){setLoading(false);setAvailabilityMessage('Availability could not be verified. Choose a date again to check; no slot was reserved.');}}).finally(()=>clearTimeout(timer));
  return()=>{live=false;controller.abort();clearTimeout(timer);};
 },[session,date,client,context]);
 const stages=session?.render.form.journey.stages.filter(item=>item.enabled)??[];
 const current=stages[stage];
 const slots=availability?.slots.filter(slot=>Date.parse(slot.start)>Date.now())??[];
 const changeDate=(value:string)=>{setAvailability(null);setSelected('');setDate(value);};
 const canNext=current?.kind==='schedule'?Boolean(selected&&slots.some(slot=>slot.start===selected)):current?.kind==='information'?Boolean(name.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)):Boolean(current&&current.kind!=='review_payment'&&current.kind!=='confirmation');
 const next=()=>{if(!session||Date.parse(session.expiresAt)<=Date.now()||!canNext||(current?.kind==='schedule'&&Date.parse(selected)<=Date.now()))return;setStage(value=>Math.min(value+1,stages.length-1));};
 const style={maxWidth:680,width:'100%',minWidth:0,boxSizing:'border-box',margin:'0 auto',padding:session?.render.form.presentation.layout==='compact'?12:24,overflowWrap:'anywhere','--accent':session?.render.form.presentation.accentColor} as CSSProperties;
 return <main className="checkout-card" style={style}>
  <h1>{session?.render.form.name??'Booking form'}</h1>
  <p>Staging · Availability preview. Booking submission is currently unavailable.</p>
  {!client?<p role="alert">This booking form is unavailable because its connected public configuration could not be verified.</p>:!session?<>
   {message&&<p role="alert">{message}</p>}
   {opening&&<p role="status">Opening temporary booking session…</p>}
   <button type="button" disabled={opening} onClick={()=>void open()}>{message?'Open a new temporary session':'Open booking form'}</button>
  </>:<>
   <nav aria-label="Published booking journey"><ol style={{paddingLeft:24,display:'flex',flexWrap:'wrap',gap:16}}>{stages.map((item,index)=><li key={item.id} aria-current={index===stage?'step':undefined}>{item.label}</li>)}</ol></nav>
   <section aria-labelledby="journey-stage"><h2 id="journey-stage">{current?.label}</h2>
    {current?.kind==='service'&&<><h3>{session.render.service.name}</h3><p>{session.render.service.durationMinutes} minutes · {session.render.service.price.currency} {(session.render.service.price.amount/100).toFixed(2)}</p><p>Published service. The server remains responsible for price and booking authority.</p></>}
    {current?.kind==='options'&&<p>This published service has no additional options.</p>}
    {current?.kind==='information'&&<><label>Your name<input style={field} autoComplete="name" maxLength={200} value={name} onChange={event=>setName(event.target.value)}/></label><label>Email<input style={field} type="email" autoComplete="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label><p>Your details stay in this page and have not been submitted.</p></>}
    {current?.kind==='schedule'&&<><label>Date (UTC)<input style={field} type="date" min={today()} value={date} onChange={event=>changeDate(event.target.value)}/></label>
     {loading&&<p role="status">Checking server availability…</p>}{availabilityMessage&&<p role="alert">{availabilityMessage}</p>}
     {!loading&&!availabilityMessage&&availability&&<fieldset style={{minWidth:0,border:0,padding:0}}><legend>Available times (UTC)</legend>{slots.length?slots.map(slot=><label key={slot.start} style={{display:'block',padding:8}}><input type="radio" name="journey-slot" value={slot.start} checked={selected===slot.start} onChange={()=>setSelected(slot.start)}/>{slot.start.slice(11,16)}–{slot.end.slice(11,16)} UTC</label>):<p>No available times for this date.</p>}</fieldset>}
     <p>Times are checked against server capacity. Selecting a time does not reserve it.</p>
    </>}
    {current?.kind==='review_payment'&&<><p>{session.render.service.name}</p><p>{selected?`${selected.slice(0,10)} ${selected.slice(11,16)} UTC`:'No time selected.'}</p><p>Booking submission and test payment are currently unavailable. Your information has not been sent, no hold exists, and no booking has been confirmed.</p></>}
    {current?.kind==='confirmation'&&<p>No booking has been confirmed. This stage is unavailable until server-authoritative booking submission is connected.</p>}
   </section>
   <div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:16}}>{stage>0&&<button type="button" onClick={()=>setStage(value=>value-1)}>Back</button>}{current?.kind!=='review_payment'&&current?.kind!=='confirmation'&&<button type="button" disabled={!canNext} onClick={next}>Continue</button>}</div>
   <p>Session expires at {new Date(session.expiresAt).toISOString().slice(11,19)} UTC. No reservation has been made.</p>
  </>}
 </main>;
}

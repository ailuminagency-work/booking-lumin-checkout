import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createRuntimeClient,type PublicRuntimeConfig,type PaidJourneyCustomerSession,type PaidJourneyAvailability,type PaidJourneyHoldInput,type PaidJourneyHoldReceipt,type PaidJourneyPaymentReceipt,type RuntimeClient} from '@lumin/runtime-client';

const field:CSSProperties={width:'100%',minWidth:0,maxWidth:'100%',boxSizing:'border-box'};
const timeoutMs=30000;
const today=()=>new Date().toISOString().slice(0,10);
function windowFor(date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return undefined;
 const start=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==date)return undefined;
 return {from:start.toISOString(),to:new Date(start.getTime()+86400000).toISOString()};
}

// Memory only. Unmount/context replacement must not permit a new orphan attempt.
// A full page reload loses the private token; this cannot recover missing credentials.
type RetainedPayment={phase:'pending'|'unknown'|'confirmed';revoked:boolean;receipt?:PaidJourneyPaymentReceipt;controller:AbortController;sequence:number;timeout?:ReturnType<typeof setTimeout>};
type RetainedHold={context:string;owner:symbol;client?:RuntimeClient;session?:PaidJourneyCustomerSession;input?:PaidJourneyHoldInput;phase:'pending'|'checking'|'unknown'|'held';checked:boolean;receipt?:PaidJourneyHoldReceipt;payment?:RetainedPayment;controller:AbortController;timeout?:ReturnType<typeof setTimeout>;expiryTimer?:ReturnType<typeof setTimeout>;sequence:number};
let retainedHold:RetainedHold|undefined;
const holdListeners=new Set<()=>void>();
const notifyHold=()=>{for(const listener of holdListeners)listener();};
function uncertain(hold:RetainedHold){hold.phase='unknown';hold.checked=false;clearTimeout(hold.timeout);hold.controller.abort();if(hold.payment?.phase==='pending'){hold.payment.phase='unknown';clearTimeout(hold.payment.timeout);hold.payment.controller.abort();}notifyHold();}
function forget(hold:RetainedHold){clearTimeout(hold.timeout);clearTimeout(hold.expiryTimer);hold.input=undefined;hold.session=undefined;hold.client=undefined;if(retainedHold===hold)retainedHold=undefined;notifyHold();}
const validText=(value:string,max:number)=>value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
const validCustomer=(name:string,email:string)=>validText(name,200)&&validText(email,254)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);

/** Dedicated V8 availability surface. Stage order grants no booking or payment capability. */
export function HostedJourneyFlow({installationId,config}:{installationId:string;config:PublicRuntimeConfig}){
 const client=useMemo(()=>{try{
  if(config.environment!=='staging'||config.mode!=='supabase'||!config.flowApiOrigin||location.protocol!=='https:')return null;
  return createRuntimeClient({url:config.supabaseUrl,publishableKey:config.supabasePublishableKey,tenantId:config.tenantId,bookingApiOrigin:config.flowApiOrigin});
 }catch{return null;}},[config.environment,config.mode,config.flowApiOrigin,config.supabaseUrl,config.supabasePublishableKey,config.tenantId]);
 const [sessionReceipt,setSessionReceipt]=useState<{session:PaidJourneyCustomerSession;context:string}|null>(null);
 const [opening,setOpening]=useState(false),[message,setMessage]=useState('');
 const [date,setDate]=useState(today),[availability,setAvailability]=useState<PaidJourneyAvailability|null>(null);
 const [loading,setLoading]=useState(false),[availabilityMessage,setAvailabilityMessage]=useState(''),[selected,setSelected]=useState('');
 const [stage,setStage]=useState(0),[name,setName]=useState(''),[email,setEmail]=useState('');
 const [holdVersion,setHoldVersion]=useState(0),[holdMessage,setHoldMessage]=useState('');
 const holdOwner=useRef(Symbol('journey-hold-owner'));
 const epoch=useRef(0),openingRef=useRef(false),openingAbort=useRef<AbortController|null>(null);
 const openingTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const context=installationId+'|'+config.environment+'|'+config.mode+'|'+config.flowApiOrigin+'|'+config.supabaseUrl+'|'+config.supabasePublishableKey+'|'+config.tenantId+'|'+(location.origin??location.protocol);
 const session=sessionReceipt?.context===context?sessionReceipt.session:null;
 const setSession=(value:PaidJourneyCustomerSession|null)=>setSessionReceipt(value?{session:value,context}:null);
 const currentContext=useRef(context);currentContext.current=context;
 useEffect(()=>{const listener=()=>setHoldVersion(value=>value+1);holdListeners.add(listener);const existing=retainedHold;if(existing?.payment&&existing.context!==context){existing.payment.revoked=true;uncertain(existing);}return()=>{holdListeners.delete(listener);const hold=retainedHold;if(hold?.payment&&hold.context!==currentContext.current)hold.payment.revoked=true;if(hold?.owner===holdOwner.current&&(hold.phase==='pending'||hold.phase==='checking'||hold.payment?.phase==='pending'))uncertain(hold);};},[context]);
 useEffect(()=>{
  epoch.current++;openingRef.current=false;openingAbort.current?.abort();clearTimeout(openingTimer.current);
  setOpening(false);setSession(null);setMessage('');setHoldMessage('');setAvailability(null);setSelected('');setStage(0);setName('');setEmail('');setDate(today());
  return()=>{epoch.current++;openingRef.current=false;openingAbort.current?.abort();clearTimeout(openingTimer.current);};
 },[client,installationId]);
 async function open(){
  if(!client||openingRef.current||retainedHold)return;
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
  const timer=setTimeout(()=>{epoch.current++;setSession(null);setAvailability(null);setSelected('');setName('');setEmail('');setStage(0);setMessage(retainedHold?'Your temporary session expired. Reservation status has not been checked; do not start another attempt.':'Your temporary session expired. No slot was reserved and no booking or payment was made. Open a new session to check availability.');},Math.max(0,Date.parse(session.expiresAt)-Date.now()));
  return()=>clearTimeout(timer);
 },[session]);
 useEffect(()=>{
  setAvailability(null);setSelected('');setAvailabilityMessage('');setLoading(false);
  if(!session||!client||retainedHold)return;
  const window=windowFor(date);if(!window){setAvailabilityMessage('Choose a valid calendar date.');return;}
  const controller=new AbortController(),run=epoch.current,captured=context;let live=true;
  const active=()=>live&&!controller.signal.aborted&&epoch.current===run&&currentContext.current===captured&&Date.parse(session.expiresAt)>Date.now();
  setLoading(true);
  const timer=setTimeout(()=>{if(!active())return;controller.abort();setLoading(false);setAvailabilityMessage('Availability could not be verified. Choose a date again to check; no slot was reserved.');},timeoutMs);
  void client.readPaidJourneyAvailability(session,window,{signal:controller.signal}).then(next=>{if(active()){setAvailability(next);setLoading(false);}},()=>{if(active()){setLoading(false);setAvailabilityMessage('Availability could not be verified. Choose a date again to check; no slot was reserved.');}}).finally(()=>clearTimeout(timer));
  return()=>{live=false;controller.abort();clearTimeout(timer);};
 },[session,date,client,context,holdVersion]);
 async function sendHold(hold:RetainedHold,retry:boolean){
  const sdk=hold.client,originalSession=hold.session,input=hold.input;
  if(hold.payment||retainedHold!==hold||!sdk||!originalSession||!input||hold.context!==currentContext.current||Date.parse(originalSession.expiresAt)<=Date.now()||(hold.phase==='pending'||hold.phase==='checking'||!hold.checked)&&retry)return;
  const sequence=++hold.sequence,controller=new AbortController();hold.phase='pending';hold.checked=false;hold.controller=controller;hold.owner=holdOwner.current;notifyHold();
  const timeout=setTimeout(()=>{if(retainedHold===hold&&hold.sequence===sequence&&hold.phase==='pending')uncertain(hold);},timeoutMs);hold.timeout=timeout;
  try{const receipt=await sdk.holdPaidJourneySlot(installationId,originalSession,input,{signal:controller.signal,...(retry?{retry:true as const}:{})});
   if(retainedHold!==hold||hold.sequence!==sequence)return;
   hold.receipt=receipt;hold.phase=controller.signal.aborted||hold.context!==currentContext.current?'unknown':'held';
  }catch(error){if(retainedHold!==hold||hold.sequence!==sequence)return;
   const delivery=(error as {delivery?:unknown})?.delivery;
   if(!hold.receipt&&delivery!=='unknown'&&sdk.paidJourneyHoldState().phase==='ready'){forget(hold);if(hold.context===currentContext.current)setHoldMessage('The reservation request was not accepted. No hold receipt was verified. Check availability before trying again.');return;}
   hold.phase='unknown';
  }finally{clearTimeout(timeout);if(retainedHold===hold&&hold.sequence===sequence){if(Date.parse(originalSession.expiresAt)<=Date.now()){hold.input=undefined;hold.session=undefined;hold.client=undefined;}notifyHold();}}
 }
 async function checkHold(hold:RetainedHold){
  const sdk=hold.client,originalSession=hold.session;
  if(hold.payment||retainedHold!==hold||!sdk||!originalSession||!hold.input||hold.context!==currentContext.current||Date.parse(originalSession.expiresAt)<=Date.now()||hold.phase==='pending'||hold.phase==='checking')return;
  const sequence=++hold.sequence,controller=new AbortController();hold.phase='checking';hold.checked=false;hold.controller=controller;hold.owner=holdOwner.current;notifyHold();
  const timeout=setTimeout(()=>{if(retainedHold===hold&&hold.sequence===sequence&&hold.phase==='checking')uncertain(hold);},timeoutMs);hold.timeout=timeout;
  const active=()=>retainedHold===hold&&hold.sequence===sequence&&!controller.signal.aborted&&hold.context===currentContext.current&&Date.parse(originalSession.expiresAt)>Date.now();
  try{const receipt=await sdk.recoverPaidJourneyHold(installationId,originalSession,{signal:controller.signal});
   if(!active())return;hold.receipt=receipt;hold.phase='held';hold.checked=true;
  }catch(error){if(retainedHold!==hold||hold.sequence!==sequence)return;hold.phase='unknown';hold.checked=active()&&(error as {code?:unknown})?.code==='UNVERIFIED';
  }finally{clearTimeout(timeout);if(retainedHold===hold&&hold.sequence===sequence){if(hold.phase==='checking')hold.phase='unknown';if(Date.parse(originalSession.expiresAt)<=Date.now()){hold.checked=false;hold.input=undefined;hold.session=undefined;hold.client=undefined;}notifyHold();}}
 }
 async function pay(hold:RetainedHold,retry=false){
  const sdk=hold.client,originalSession=hold.session;
  if(retainedHold!==hold||!sdk||!originalSession||hold.context!==currentContext.current||Date.parse(originalSession.expiresAt)<=Date.now()||hold.phase==='pending'||hold.phase==='checking')return;
  let payment=hold.payment;
  if(payment){if(!retry||payment.revoked||payment.phase!=='unknown')return;}
  else{if(retry||hold.phase!=='held'||!hold.receipt||Date.parse(hold.receipt.expiresAt)<=Date.now()||sdk.paidJourneyHoldState().phase!=='held'||sdk.paidJourneyPaymentState().phase!=='ready')return;payment={phase:'pending',revoked:false,controller:new AbortController(),sequence:0};hold.payment=payment;}
  const sequence=++payment.sequence,controller=new AbortController();payment.phase='pending';payment.controller=controller;hold.owner=holdOwner.current;notifyHold();
  const retained=payment;
  const active=()=>retainedHold===hold&&hold.payment===retained&&retained.sequence===sequence&&!controller.signal.aborted&&!retained.revoked&&hold.context===currentContext.current&&Date.parse(originalSession.expiresAt)>Date.now();
  retained.timeout=setTimeout(()=>{if(retainedHold===hold&&retained.sequence===sequence&&retained.phase==='pending'){controller.abort();retained.phase='unknown';notifyHold();}},timeoutMs);
  try{const receipt=await sdk.mockPayPaidJourney(installationId,originalSession,{signal:controller.signal,...(retry?{retry:true as const}:{})});
   if(!active())return;retained.receipt=receipt;retained.phase='confirmed';
  }catch{if(retainedHold===hold&&hold.payment===retained&&retained.sequence===sequence)retained.phase=retained.receipt?'confirmed':'unknown';}
  finally{clearTimeout(retained.timeout);if(retainedHold===hold&&hold.payment===retained&&retained.sequence===sequence){if(retained.phase==='pending')retained.phase='unknown';if(Date.parse(originalSession.expiresAt)<=Date.now()){hold.input=undefined;hold.session=undefined;hold.client=undefined;}notifyHold();}}
 }
 async function reserve(){
  if(retainedHold||!client||!session||current?.kind!=='review_payment'||Date.parse(session.expiresAt)<=Date.now()||!validCustomer(name,email)||!availability?.slots.some(slot=>slot.start===selected&&Date.parse(slot.start)>Date.now()))return;
  let key:string;try{const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);key=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');}catch{setHoldMessage('A secure reservation key is unavailable. No reservation request was sent.');return;}
  const input=Object.freeze({schemaVersion:1 as const,idempotencyKey:key,requestedStart:selected,customer:Object.freeze({name,email}),answers:Object.freeze({})});
  const hold:RetainedHold={context,owner:holdOwner.current,client,session,input,phase:'pending',checked:false,controller:new AbortController(),sequence:0};retainedHold=hold;setName('');setEmail('');setHoldMessage('');
  hold.expiryTimer=setTimeout(()=>{if(retainedHold!==hold)return;uncertain(hold);hold.input=undefined;hold.session=undefined;hold.client=undefined;notifyHold();},Math.max(0,Date.parse(session.expiresAt)-Date.now()));
  await sendHold(hold,false);
 }
 const hold=retainedHold;
 const compatibleHold=hold?.context===context;
 const verifiedHold=hold&&compatibleHold&&hold.phase==='held'&&hold.receipt&&hold.client?.paidJourneyHoldState().phase==='held'&&Date.parse(hold.receipt.expiresAt)>Date.now()?hold.receipt:undefined;
 useEffect(()=>{if(!verifiedHold)return;const timer=setTimeout(()=>setHoldVersion(value=>value+1),Math.max(0,Date.parse(verifiedHold.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[verifiedHold]);
 const stages=session?.render.form.journey.stages.filter(item=>item.enabled)??[];
 const current=stages[stage];
 const slots=availability?.slots.filter(slot=>Date.parse(slot.start)>Date.now())??[];
 const changeDate=(value:string)=>{if(retainedHold)return;setAvailability(null);setSelected('');setDate(value);};
 const canNext=current?.kind==='schedule'?Boolean(selected&&slots.some(slot=>slot.start===selected)):current?.kind==='information'?validCustomer(name,email):Boolean(current&&current.kind!=='review_payment'&&current.kind!=='confirmation');
 const next=()=>{if(!session||Date.parse(session.expiresAt)<=Date.now()||!canNext||(current?.kind==='schedule'&&Date.parse(selected)<=Date.now()))return;setStage(value=>Math.min(value+1,stages.length-1));};
 const style={maxWidth:680,width:'100%',minWidth:0,boxSizing:'border-box',margin:'0 auto',padding:session?.render.form.presentation.layout==='compact'?12:24,overflowWrap:'anywhere','--accent':session?.render.form.presentation.accentColor} as CSSProperties;
 return <main className={`checkout-card hosted-flow-card paid-form-layout-${session?.render.form.presentation.layout??'stacked'}`} style={style}>
  <h1>{session?.render.form.name??'Booking form'}</h1>
  <p>Staging · TEST payments only. No real money is collected.</p>
  {hold?!compatibleHold?<p role="alert">An earlier reservation attempt must be resolved before opening a different form. Booking and payment status have not been checked.</p>:<section aria-label="Reservation draft">
   <h2>{hold.payment?'Test booking status':'Reservation draft'}</h2>
   {hold.payment?hold.payment.revoked?<p role="alert">The booking context changed. Payment status cannot be shown here. Contact the business; do not start another attempt.</p>:hold.payment.phase==='pending'?<><p role="status">Confirming this TEST booking… Do not start another payment or reservation.</p><button type="button" onClick={()=>uncertain(hold)}>Stop waiting for response</button><p>Stopping the wait does not cancel the server transaction.</p></>:hold.payment.phase==='confirmed'&&hold.payment.receipt?<><p role="status">TEST booking confirmed · Simulated payment. No real money was collected.</p><p>Booking reference: {hold.payment.receipt.reference}</p><p>Test amount: {hold.payment.receipt.currency} {(hold.payment.receipt.amount/100).toFixed(2)}</p><p>Payment reference: {hold.payment.receipt.paymentId}</p></>:<><p role="alert">Test payment status could not be verified. The original booking may already be confirmed. Do not start another booking or payment.</p>{hold.session&&hold.client&&Date.parse(hold.session.expiresAt)>Date.now()?<><button type="button" onClick={()=>void pay(hold,true)}>Retry same test payment</button><p>This explicitly retries only the original financial attempt.</p></>:<p>Contact the business to resolve this booking. Its session expired; no replacement payment will be started.</p>}</>:hold.phase==='pending'||hold.phase==='checking'?<p role="status">{hold.phase==='checking'?'Checking the existing reservation… This check does not create or renew a hold.':'Reserving the selected time… Do not start another attempt.'}</p>:verifiedHold?<><p role="status">Temporary hold verified. Booking remains DRAFT. No payment has been made and no booking has been confirmed.</p><p>Draft reference: {verifiedHold.reference}</p><p>Hold active until {new Date(verifiedHold.expiresAt).toISOString().slice(11,19)} UTC.</p>{hold.session&&Date.parse(hold.session.expiresAt)>Date.now()&&<><p>TEST amount: {hold.session.render.service.price.currency} {(hold.session.render.service.price.amount/100).toFixed(2)} · Simulated payment only.</p><button type="button" onClick={()=>void pay(hold)}>Confirm test booking</button></>}</>:<><p role="alert">Reservation status could not be verified. A draft and hold may exist. Do not start another booking. No payment or confirmation was authorized.</p>{hold.receipt&&<p>Last verified draft reference: {hold.receipt.reference}. Its current hold status has not been checked.</p>}</>}
   {!hold.payment&&(hold.phase!=='pending'&&hold.phase!=='checking'&&hold.session&&hold.client&&hold.input&&Date.parse(hold.session.expiresAt)>Date.now()&&(!hold.receipt||Date.parse(hold.receipt.expiresAt)>Date.now())?<><button type="button" onClick={()=>void checkHold(hold)}>Check existing reservation</button><p>This reads the original attempt only. It does not create, renew or confirm a booking.</p>{hold.phase==='unknown'&&hold.checked&&<><button type="button" onClick={()=>void sendHold(hold,true)}>Retry same hold request</button><p>The check could not verify a hold. This explicitly sends the original unchanged request; its outcome may still be uncertain.</p></>}</>:hold.phase!=='pending'&&hold.phase!=='checking'&&<p>The session or known hold is no longer available for retry. Contact the business to resolve this draft before starting another attempt.</p>)}
  </section>:!client?<p role="alert">This booking form is unavailable because its connected public configuration could not be verified.</p>:!session?<>
   {message&&<p role="alert">{message}</p>}
   {opening&&<p role="status">Opening temporary booking session…</p>}
   <button type="button" disabled={opening} onClick={()=>void open()}>{message?'Open a new temporary session':'Open booking form'}</button>
  </>:<>
   <nav aria-label="Published booking journey"><ol style={{paddingLeft:24,display:'flex',flexWrap:'wrap',gap:16}}>{stages.map((item,index)=><li key={item.id} aria-current={index===stage?'step':undefined}>{item.label}</li>)}</ol></nav>
   <section aria-labelledby="journey-stage"><h2 id="journey-stage">{current?.label}</h2>
    {current?.kind==='service'&&<><h3>{session.render.service.name}</h3><p>{session.render.service.durationMinutes} minutes · {session.render.service.price.currency} {(session.render.service.price.amount/100).toFixed(2)}</p><p>Published service. The server remains responsible for price and booking authority.</p></>}
    {current?.kind==='options'&&<p>This published service has no additional options.</p>}
    {current?.kind==='information'&&<><label>Your name<input style={field} required autoComplete="name" maxLength={200} value={name} onChange={event=>setName(event.target.value)}/></label><label>Email<input style={field} required type="email" autoComplete="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label><p>Your details stay in this page until you explicitly reserve a time.</p></>}
    {current?.kind==='schedule'&&<><label>Date (UTC)<input style={field} type="date" min={today()} value={date} onChange={event=>changeDate(event.target.value)}/></label>
     {loading&&<p role="status">Checking server availability…</p>}{availabilityMessage&&<p role="alert">{availabilityMessage}</p>}
     {!loading&&!availabilityMessage&&availability&&<fieldset style={{minWidth:0,border:0,padding:0}}><legend>Available times (UTC)</legend>{slots.length?slots.map(slot=><label key={slot.start} style={{display:'block',padding:8}}><input type="radio" name="journey-slot" value={slot.start} checked={selected===slot.start} onChange={()=>setSelected(slot.start)}/>{slot.start.slice(11,16)}–{slot.end.slice(11,16)} UTC</label>):<p>No available times for this date.</p>}</fieldset>}
     <p>Times are checked against server capacity. Selecting a time does not reserve it.</p>
    </>}
    {current?.kind==='review_payment'&&<><p>{session.render.service.name}</p><p>{selected?`${selected.slice(0,10)} ${selected.slice(11,16)} UTC`:'No time selected.'}</p><p>First reserve a temporary hold. Then explicitly confirm a TEST booking using simulated payment; no real money is collected.</p>{holdMessage&&<p role="alert">{holdMessage}</p>}<button type="button" disabled={!validCustomer(name,email)||!availability?.slots.some(slot=>slot.start===selected&&Date.parse(slot.start)>Date.now())} onClick={()=>void reserve()}>Reserve this time (staging)</button></>}
    {current?.kind==='confirmation'&&<p>No booking has been confirmed. This stage is unavailable until server-authoritative booking submission is connected.</p>}
   </section>
   <div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:16}}>{stage>0&&<button type="button" onClick={()=>setStage(value=>value-1)}>Back</button>}{current?.kind!=='review_payment'&&current?.kind!=='confirmation'&&<button type="button" disabled={!canNext} onClick={next}>Continue</button>}</div>
   <p>Session expires at {new Date(session.expiresAt).toISOString().slice(11,19)} UTC. No reservation has been made.</p>
  </>}
 </main>;
}

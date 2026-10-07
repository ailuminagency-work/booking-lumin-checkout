import {useEffect,useId,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createRuntimeClient,PaidJourneyCustomerFieldHoldError,type PublicRuntimeConfig,type PaidJourneyCustomerFieldSession,type PaidJourneyCustomerFieldAvailability,type PaidJourneyCustomerFieldHoldReceipt} from '@lumin/runtime-client';
import {formatMoney} from '@lumin/contracts';
import {PaidJourneyCustomerFieldRender,resolvePaidJourneyCustomerFieldVisibility,validatePaidJourneyCustomerFieldAnswers} from '@lumin/workflow';

const bounded:CSSProperties={width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',overflowWrap:'anywhere'};
/** Published V9 form with explicit scheduling and draft holds; payment and confirmation remain unavailable. */
export function HostedJourneyCustomerFieldFlow({installationId,config}:{installationId:string;config:PublicRuntimeConfig}){
 const fieldPrefix=useId();
 const origin=location.origin;
 const context=JSON.stringify([installationId,origin,config.environment,config.mode,config.flowApiOrigin,config.supabaseUrl,config.supabasePublishableKey,config.tenantId]);
 const current=useRef(context);current.current=context;
 const epoch=useRef(0);
 const client=useMemo(()=>{try{
  if(config.environment!=='staging'||config.mode!=='supabase'||!config.flowApiOrigin||location.protocol!=='https:')return null;
  return createRuntimeClient({url:config.supabaseUrl,publishableKey:config.supabasePublishableKey,tenantId:config.tenantId,bookingApiOrigin:config.flowApiOrigin});
 }catch{return null;}},[context]);
 const [receipt,setReceipt]=useState<{context:string;render:PaidJourneyCustomerFieldRender}|null>(null);
 const [message,setMessage]=useState(''),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
 const [answers,setAnswers]=useState<Record<string,string>>({}),[stage,setStage]=useState(0);
 const heading=useRef<HTMLHeadingElement>(null);
 const attempted=useRef(false),actionBusy=useRef(false),actionController=useRef<AbortController|null>(null);
 const capability=useRef<{context:string;value:PaidJourneyCustomerFieldSession}|null>(null);
 const [sessionPhase,setSessionPhase]=useState<'idle'|'checking'|'issued'|'unknown'|'expired'|'blocked'>('idle');
 const [sessionExpiry,setSessionExpiry]=useState<string|null>(null),[scheduleMessage,setScheduleMessage]=useState('');
 const [day,setDay]=useState(()=>new Date(Date.now()+86400000).toISOString().slice(0,10));
 const [availability,setAvailability]=useState<{context:string;day:string;value:PaidJourneyCustomerFieldAvailability}|null>(null);
 const [chosen,setChosen]=useState<string|null>(null);
 const scheduleResult=useRef<HTMLDivElement>(null),holdResult=useRef<HTMLDivElement>(null);
 const holdAttempted=useRef(false),holdController=useRef<AbortController|null>(null),holdBusy=useRef(false);
 const [holdPhase,setHoldPhase]=useState<'idle'|'holding'|'held'|'unknown'|'expired'|'blocked'|'rejected'>('idle');
 const [holdMessage,setHoldMessage]=useState(''),[holdReceipt,setHoldReceipt]=useState<{context:string;value:PaidJourneyCustomerFieldHoldReceipt}|null>(null);
 const [customer,setCustomer]=useState({context,name:'',email:''});
 const holdLocked=holdAttempted.current||holdBusy.current;
 const clearPrivate=()=>{setCustomer({context:current.current,name:'',email:''});setAnswers({});};
 useEffect(()=>{
  const run=++epoch.current,captured=context,controller=new AbortController();let live=true;
  const active=()=>live&&run===epoch.current&&current.current===captured&&!controller.signal.aborted;
  holdController.current?.abort();holdBusy.current=false;setHoldReceipt(null);setHoldMessage('');setHoldPhase(holdAttempted.current?'blocked':'idle');setCustomer({context:captured,name:'',email:''});
  actionController.current?.abort();actionBusy.current=false;capability.current=null;setSessionExpiry(null);setAvailability(null);setChosen(null);setScheduleMessage('');setSessionPhase(attempted.current?'blocked':'idle');
  setReceipt(null);setAnswers({});setStage(0);setMessage('');setLoading(Boolean(client));
  if(!client){setMessage('This published preview requires connected HTTPS staging.');return;}
  const timer=setTimeout(()=>{if(active()){controller.abort();setLoading(false);setMessage(holdAttempted.current?'Published form could not be verified. An earlier draft reservation may exist. No payment or confirmation was made.':'Published form could not be verified. No booking or payment was made.');}},30000);
  void client.loadPaidJourneyCustomerFieldRender(installationId,{origin,signal:controller.signal}).then(value=>{
   if(active()){const parsed=PaidJourneyCustomerFieldRender.safeParse(value);if(parsed.success)setReceipt({context:captured,render:parsed.data});else setMessage(holdAttempted.current?'Published form could not be verified. An earlier draft reservation may exist. No payment or confirmation was made.':'Published form could not be verified. No booking or payment was made.');setLoading(false);}
  },()=>{if(active()){setLoading(false);setMessage(holdAttempted.current?'Published form could not be verified. An earlier draft reservation may exist. No payment or confirmation was made.':'Published form could not be verified. No booking or payment was made.');}}).finally(()=>clearTimeout(timer));
  return()=>{live=false;epoch.current++;controller.abort();actionController.current?.abort();holdController.current?.abort();capability.current=null;clearTimeout(timer);};
 },[client,context,reload]);
 const published=receipt?.context===context?receipt.render:null;
 const stages=published?.form.journey.stages.filter(value=>value.enabled)??[];
 const selected=stages[stage];
 const visible=published?resolvePaidJourneyCustomerFieldVisibility(published,answers):[];
 function change(id:string,value:string){
  if(!published||holdAttempted.current||holdBusy.current)return;
  // Rebuild in definition order so a hidden answer and all of its descendants are forgotten.
  const proposed={...answers,[id]:value},next:Record<string,string>={};
  try{for(const field of published.form.customerFields){
   if(resolvePaidJourneyCustomerFieldVisibility(published,next).includes(field.id)&&Object.hasOwn(proposed,field.id))next[field.id]=proposed[field.id]!;
  }
  resolvePaidJourneyCustomerFieldVisibility(published,next);setAnswers(next);}catch{/* Invalid local text never becomes a valid preview answer. */}
 }
 function move(index:number){setStage(index);requestAnimationFrame(()=>heading.current?.focus());}
 useEffect(()=>{
  if(!sessionExpiry)return;
  const timer=setTimeout(()=>{capability.current=null;actionController.current?.abort();holdController.current?.abort();holdBusy.current=false;clearPrivate();if(holdAttempted.current){setHoldPhase('expired');setHoldReceipt(null);setHoldMessage('The scheduling capability expired. A draft may exist; no automatic retry, payment or confirmation was made.');}actionBusy.current=false;setAvailability(null);setChosen(null);setSessionPhase('expired');setScheduleMessage(holdAttempted.current?'The scheduling capability expired. An earlier draft reservation may exist. No new session was started.':'This scheduling session expired. No time was reserved and no new session was started.');},Math.max(0,Date.parse(sessionExpiry)-Date.now()));
  return()=>clearTimeout(timer);
 },[sessionExpiry,context]);
 async function checkTimes(){
  if(!client||!published||holdAttempted.current||holdBusy.current||actionBusy.current||!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
  const from=new Date(day+'T00:00:00.000Z');if(!Number.isFinite(from.getTime())||from.toISOString().slice(0,10)!==day)return;
  const captured=context,run=epoch.current,selectedDay=day,controller=new AbortController();actionController.current=controller;actionBusy.current=true;
  const active=()=>current.current===captured&&epoch.current===run&&!controller.signal.aborted;
  setSessionPhase('checking');setScheduleMessage('');setAvailability(null);setChosen(null);
  const timer=setTimeout(()=>{if(active()){controller.abort();actionBusy.current=false;setSessionPhase(capability.current?'issued':'unknown');setScheduleMessage(capability.current?'Available times could not be read. You may explicitly check again using this same session.':'Session creation could not be verified. Do not repeat it. No booking or payment was made.');}},30000);
  try{
   let stored=capability.current?.context===captured?capability.current.value:null;
   if(!stored){
    if(attempted.current){if(active()){setSessionPhase('blocked');setScheduleMessage('A session was already started in this view. It will not be repeated or reconciled by reloading the preview.');}return;}
    attempted.current=true;
    stored=await client.issuePaidJourneyCustomerFieldSession(installationId,{origin,signal:controller.signal});
    if(!active())return;
    const parsed=PaidJourneyCustomerFieldRender.safeParse(stored.render);
    if(!parsed.success||JSON.stringify(parsed.data)!==JSON.stringify(published)||stored.installationId!==installationId)throw new Error('Incompatible session');
    capability.current={context:captured,value:stored};setSessionExpiry(stored.expiresAt);
   }
   if(Date.parse(stored.expiresAt)<=Date.now()){if(active()){setSessionPhase('expired');setScheduleMessage('This scheduling session expired. No time was reserved.');}return;}
   const value=await client.readPaidJourneyCustomerFieldAvailability(stored,{from:from.toISOString(),to:new Date(from.getTime()+86400000).toISOString()},{origin,signal:controller.signal});
   if(!active())return;
   setAvailability({context:captured,day:selectedDay,value});setSessionPhase('issued');setScheduleMessage(value.slots.length?'Available when checked. Choose a time locally; it is not reserved.':'No available times were returned for this UTC date.');requestAnimationFrame(()=>{if(active())scheduleResult.current?.focus();});
  }catch{if(active()){const stored=capability.current;setSessionPhase(stored?'issued':'unknown');setScheduleMessage(stored?'Available times could not be verified. You may explicitly check again using the same session. No time was reserved.':'Session creation could not be verified. Do not repeat it. No booking or payment was made.');}}
  finally{clearTimeout(timer);if(current.current===captured&&epoch.current===run){actionBusy.current=false;if(!controller.signal.aborted)actionController.current=null;}}
 }
 useEffect(()=>{
  const saved=holdReceipt?.context===context?holdReceipt.value:null;if(!saved)return;
  const timer=setTimeout(()=>{setHoldPhase('expired');setHoldReceipt(null);setAvailability(null);setChosen(null);capability.current=null;clearPrivate();setHoldMessage('The hold receipt expired. Current server status has not been rechecked. No payment or confirmation was made.');},Math.max(0,Date.parse(saved.expiresAt)-Date.now()));
  return()=>clearTimeout(timer);
 },[holdReceipt,context]);
 async function requestHold(){
  const stored=capability.current?.context===context?capability.current.value:null,slot=availability?.context===context&&availability.day===day?availability.value.slots.find(value=>value.start===chosen):undefined;
  if(!client||!published||!stored||!slot||holdAttempted.current||holdBusy.current||actionBusy.current)return;
  const details=customer.context===context?customer:{name:'',email:''};
  const clean=(value:string,max:number)=>value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
  if(!clean(details.name,200)||!clean(details.email,254)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(details.email)){setHoldMessage('Enter a name and valid email before requesting a draft reservation.');return;}
  let validated:Readonly<Record<string,string>>;try{validated=validatePaidJourneyCustomerFieldAnswers(published,answers);}catch{setHoldMessage('Complete the required published questions before requesting a draft reservation.');return;}
  const captured=context,run=epoch.current,controller=new AbortController(),key='v9_checkout_'+crypto.randomUUID();
  holdAttempted.current=true;holdBusy.current=true;holdController.current=controller;setHoldPhase('holding');setHoldMessage('Requesting a draft reservation. Payment and confirmation remain unavailable.');
  const active=()=>current.current===captured&&epoch.current===run&&!controller.signal.aborted;
  const unknown=()=>{capability.current=null;setAvailability(null);setChosen(null);clearPrivate();setHoldPhase('unknown');setHoldMessage('Reservation response is unverified. A draft and hold may exist. Do not repeat this request. No payment or confirmation was made.');};
  const timer=setTimeout(()=>{if(active()){controller.abort();holdBusy.current=false;unknown();}},30000);
  try{
   const value=await client.holdPaidJourneyCustomerFieldSlot(stored,slot,{schemaVersion:2,idempotencyKey:key,requestedStart:slot.start,customer:{name:details.name,email:details.email},answers:validated},{origin,signal:controller.signal});
   if(!active())return;
   setHoldReceipt({context:captured,value});setHoldPhase('held');setHoldMessage('Draft reservation received. It is not confirmed. Payment is unavailable.');setScheduleMessage('The selected time has a verified draft hold receipt. It is not a confirmed booking.');capability.current=null;clearPrivate();requestAnimationFrame(()=>{if(active())holdResult.current?.focus();});
  }catch(error){if(active()){if(error instanceof PaidJourneyCustomerFieldHoldError&&error.delivery==='rejected'){setAvailability(null);setChosen(null);clearPrivate();if(capability.current?.context===captured&&Date.parse(stored.expiresAt)>Date.now()){setHoldPhase('rejected');setHoldMessage('The reservation request was rejected. No verified hold was accepted. You may explicitly check other times using this same session.');}else{capability.current=null;setHoldPhase('expired');setHoldMessage('The reservation request was rejected and the session is no longer valid. This view will not start another session.');}}else unknown();}}
  finally{clearTimeout(timer);if(current.current===captured&&epoch.current===run){holdBusy.current=false;if(!controller.signal.aborted)holdController.current=null;}}
 }
 const slots=availability?.context===context&&availability.day===day?availability.value.slots:[];
 const canCheck=!holdLocked&&(sessionPhase==='idle'||sessionPhase==='issued');
 const price=published?formatMoney(published.service.price):'';
 return <section aria-label="Published booking form preview" style={{...bounded,padding:'clamp(12px,3vw,24px)',margin:'0 auto',maxWidth:published?.form.presentation.layout==='compact'?560:760}}>
  <p role="status">STAGING · Published booking form - draft holds only</p>
  <p>Questions and selected times stay in this view until you explicitly request a draft reservation. Availability is checked first. Payments and confirmation are unavailable.</p>
  {loading&&<p role="status">Loading published form…</p>}
  {message&&<p role="alert">{message}</p>}
  {!loading&&<button type="button" disabled={sessionPhase==='checking'||holdPhase==='holding'||holdPhase==='held'} onClick={()=>setReload(value=>value+1)}>Reload published preview</button>}
  {published&&selected&&<>
   <h1 style={bounded}>{published.form.name}</h1>
   <p style={bounded}>{published.service.name} · {published.service.durationMinutes} minutes</p>
   <p>Published service price: <strong>{price}</strong></p>
   <p>This is the published service price, not a payment or booking total.</p>
   <ol aria-label="Published step order" style={{...bounded,paddingInlineStart:24}}>{stages.map((value,index)=><li key={value.id} aria-current={index===stage?'step':undefined}>{value.label}</li>)}</ol>
   <h2 ref={heading} tabIndex={-1} style={{...bounded,color:published.form.presentation.accentColor}}>{selected.label}</h2>
   {(selected.kind==='information'||selected.kind==='informational')&&<div style={bounded}>
    {published.form.customerFields.filter(field=>visible.includes(field.id)&&published.form.fieldBindings.some(binding=>binding.fieldId===field.id&&binding.stageId===selected.id)).map(field=><div key={field.id} style={{...bounded,marginBlock:12}}>
     <label htmlFor={fieldPrefix+'-'+field.id}>{field.label}{field.required?' (required in the published form)':''}</label>
     <input id={fieldPrefix+'-'+field.id} type="text" value={answers[field.id]??''} maxLength={field.maxLength} aria-describedby={fieldPrefix+'-local-'+field.id} disabled={holdLocked} onChange={event=>change(field.id,event.target.value)} style={bounded}/>
     <small id={fieldPrefix+'-local-'+field.id}>Sent only when you request a draft reservation</small>
    </div>)}
   </div>}
   {selected.kind==='service'&&<p>The service and price above come from this published version.</p>}
   {selected.kind==='options'&&<p>No selectable priced options are configured in this published preview.</p>}
   {selected.kind==='schedule'&&<div style={bounded}>
    <p>Check current available times. Times are shown in UTC. No availability or reservation is claimed until a successful check; selecting a time does not reserve it.</p>
    <label htmlFor={fieldPrefix+'-schedule-day'}>Date to check (UTC)</label>
    <input id={fieldPrefix+'-schedule-day'} type="date" value={day} disabled={sessionPhase==='checking'||holdLocked} onChange={event=>{setDay(event.target.value);setAvailability(null);setChosen(null);setScheduleMessage('');}} style={bounded}/>
    <button type="button" disabled={!canCheck||!day} onClick={()=>void checkTimes()}>{sessionPhase==='checking'?'Checking available times':capability.current?'Check available times again':'Check available times'}</button>
    <div ref={scheduleResult} tabIndex={-1} aria-label="Scheduling results" style={bounded}>
     {scheduleMessage&&<p role="status">{scheduleMessage}</p>}
     {(sessionPhase==='blocked'||sessionPhase==='unknown')&&<p>This view will not create another session. Reloading published information cannot resolve an uncertain session.</p>}
     {sessionPhase==='expired'&&<p>Session expired. This view will not renew it automatically.</p>}
     {slots.length>0&&<fieldset style={bounded}><legend>Available times (UTC) - local selection only</legend>{slots.map(slot=><label key={slot.start} style={{display:'block',...bounded}}><input type="radio" name={fieldPrefix+'-schedule-slot'} checked={chosen===slot.start} disabled={holdLocked} onChange={()=>setChosen(slot.start)}/>{slot.start.slice(0,10)+' '+slot.start.slice(11,16)+' to '+slot.end.slice(11,16)+' UTC'}{' - '+slot.remainingCapacity+' available when checked'}</label>)}</fieldset>}
     {chosen&&!holdLocked&&<p>Selected locally: {chosen}. No reservation, booking or payment was made.</p>}
    </div>
   </div>}
   {selected.kind==='schedule'&&<form aria-label="Draft reservation details" onSubmit={event=>{event.preventDefault();void requestHold();}} style={bounded}>
    <h3>Customer details for a draft reservation</h3>
    <label htmlFor={fieldPrefix+'-customer-name'}>Customer name</label><input id={fieldPrefix+'-customer-name'} autoComplete="name" required maxLength={200} disabled={holdLocked} value={customer.context===context?customer.name:''} onChange={event=>{if(!holdAttempted.current&&!holdBusy.current)setCustomer(value=>({...value,context,name:event.target.value}));}} style={bounded}/>
    <label htmlFor={fieldPrefix+'-customer-email'}>Customer email</label><input id={fieldPrefix+'-customer-email'} autoComplete="email" type="email" required maxLength={254} disabled={holdLocked} value={customer.context===context?customer.email:''} onChange={event=>{if(!holdAttempted.current&&!holdBusy.current)setCustomer(value=>({...value,context,email:event.target.value}));}} style={bounded}/>
    <p>Submitting sends these details and the visible published answers to create a temporary draft hold. It does not request payment or confirm a booking.</p>
    <button type="submit" disabled={holdLocked||!chosen||sessionPhase!=='issued'}>{holdPhase==='holding'?'Requesting draft reservation':'Request draft reservation'}</button>
   </form>}
   {(holdMessage||holdPhase==='blocked')&&<div ref={holdResult} tabIndex={-1} aria-label="Draft reservation result" style={bounded}>
    {holdMessage&&<p role="status">{holdMessage}</p>}
    {holdPhase==='rejected'&&<button type="button" onClick={()=>{if(holdPhase!=='rejected'||holdBusy.current||capability.current?.context!==context||Date.parse(capability.current.value.expiresAt)<=Date.now())return;holdAttempted.current=false;setHoldPhase('idle');setHoldMessage('');void checkTimes();}}>Check other available times</button>}
    {holdPhase==='blocked'&&<p>An earlier reservation attempt remains blocked. Reloading information does not resolve or repeat it.</p>}
    {holdReceipt?.context===context&&<dl><dt>Draft booking reference</dt><dd>{holdReceipt.value.reference}</dd><dt>Status</dt><dd>Draft - not confirmed</dd><dt>Payment</dt><dd>Unavailable</dd><dt>Held time (UTC)</dt><dd>{holdReceipt.value.slot.start} to {holdReceipt.value.slot.end}</dd><dt>Hold receipt expires</dt><dd>{holdReceipt.value.expiresAt}</dd></dl>}
   </div>}
   {selected.kind==='review_payment'&&<p>Payment is not connected in this preview. No payment has been requested or received.</p>}
   {selected.kind==='confirmation'&&<p>{holdAttempted.current?'A draft reservation may exist. No booking confirmation or payment was made.':'No booking has been created or confirmed by this preview.'}</p>}
   <nav aria-label="Preview steps" style={{...bounded,display:'flex',gap:12,flexWrap:'wrap'}}>
    <button type="button" disabled={stage===0} onClick={()=>move(stage-1)}>Previous preview step</button>
    <button type="button" disabled={stage===stages.length-1} onClick={()=>move(stage+1)}>Next preview step</button>
   </nav>
   <button type="button" disabled style={{...bounded,marginBlock:16}}>{holdAttempted.current?'Booking confirmation not connected yet':'Booking submission not connected yet'}</button>
  </>}
 </section>;
}

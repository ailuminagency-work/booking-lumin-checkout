import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {createFlowClient,FlowError,QuestionForm,ConfigurableQuestionForm,isConfigurable,canonicalConfigurableAnswers,answersValid,type FlowClient,type Answers} from '@lumin/flow-ui';
type Session=Awaited<ReturnType<FlowClient['session']>>;
type Availability=Awaited<ReturnType<FlowClient['availability']>>;
type RequestBody=Parameters<FlowClient['submit']>[1];
const localDate=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const fieldStyle={display:'block',width:'100%',minWidth:0,maxWidth:'100%'} as const;
export function HostedFlow({installationId,apiUrl,localHarness=false}:{installationId:string;apiUrl:string;localHarness?:boolean}){
 const client=useMemo(()=>{try{return createFlowClient(apiUrl,localHarness);}catch{return null;}},[apiUrl,localHarness]);
 const [session,setSession]=useState<Session>(),[answers,setAnswers]=useState<Answers>({}),[name,setName]=useState(''),[email,setEmail]=useState(''),[date,setDate]=useState(''),[time,setTime]=useState(''),[availability,setAvailability]=useState<Availability>(),[loadingSlots,setLoadingSlots]=useState(false),[slotError,setSlotError]=useState(''),[retry,setRetry]=useState(0),[expired,setExpired]=useState(false),[pending,setPending]=useState<RequestBody>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reference,setReference]=useState('');
 const generation=useRef(0),slotGeneration=useRef(0),pendingRef=useRef<RequestBody>(),inFlight=useRef(false);
 const secure=location.protocol==='https:',timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 useEffect(()=>{
  const at=++generation.current;slotGeneration.current++;setSession(undefined);setPending(undefined);pendingRef.current=undefined;inFlight.current=false;setReference('');setAnswers({});setName('');setEmail('');setDate('');setTime('');setAvailability(undefined);setExpired(false);setError('');setBusy(false);
  if(!client||!secure)return;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installationId)){setError('This request form is unavailable.');return;}
  setBusy(true);void client.session(installationId).then(s=>{if(at===generation.current){if(Date.parse(s.expiresAt)<=Date.now())throw new FlowError('NOT_AVAILABLE');setSession(s);}}).catch(e=>{if(at===generation.current)setError(e instanceof FlowError?e.message:'Unable to open this request form.');}).finally(()=>{if(at===generation.current)setBusy(false);});
  return()=>{generation.current++;slotGeneration.current++;client.invalidate();};
 },[client,installationId,secure]);
 useEffect(()=>{
  if(!session||!client)return;
  let timer:ReturnType<typeof setTimeout>;
  const check=()=>{const remaining=Date.parse(session.expiresAt)-Date.now();if(remaining<=0){setExpired(true);slotGeneration.current++;setAvailability(undefined);setTime('');setLoadingSlots(false);client.invalidate();}else timer=setTimeout(check,Math.min(remaining,2147483647));};
  check();return()=>clearTimeout(timer);
 },[session,client]);
 useEffect(()=>{
  const at=++slotGeneration.current;setTime('');setAvailability(undefined);setSlotError('');setLoadingSlots(false);
  if(!date||!session||!client||expired)return;
  const from=new Date(date+'T00:00:00');const to=new Date(from);to.setDate(to.getDate()+1);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(from.getTime())||localDate(from)!==date){setSlotError('Choose a valid date.');return;}
  setLoadingSlots(true);
  void client.availability(session.sessionToken,from.toISOString(),to.toISOString()).then(value=>{
   if(at!==slotGeneration.current)return;
   if(Date.parse(session.expiresAt)<=Date.now()){setExpired(true);return;}
   if(value.serviceId!==session.render.service.id||value.durationMinutes!==session.render.service.durationMinutes)throw new FlowError('INTERNAL_ERROR');
   setAvailability({...value,slots:value.slots.filter(slot=>Date.parse(slot.start)>Date.now())});
  }).catch(e=>{if(at===slotGeneration.current){if(e instanceof FlowError&&e.code==='UNAUTHENTICATED')setExpired(true);setSlotError(e instanceof FlowError?e.message:'Unable to load available times.');}}).finally(()=>{if(at===slotGeneration.current)setLoadingSlots(false);});
  return()=>{slotGeneration.current++;};
 },[date,session,client,expired,retry]);
 async function submit(e:FormEvent){
  e.preventDefault();if(!client||!session||busy||inFlight.current||reference)return;
  if(expired||Date.parse(session.expiresAt)<=Date.now()){setExpired(true);setError('Your session expired. Reload this page to start again.');return;}
  const at=generation.current;setError('');let body=pendingRef.current;
  if(!body){let accepted=answers;let valid=false;try{if(isConfigurable(session.render)){accepted=canonicalConfigurableAnswers(session.render,answers);valid=true;}else valid=answersValid(session.render.service,session.render.config,answers);}catch{}
   if(!valid||!name.trim()||!email.trim()||loadingSlots||!availability?.slots.some(slot=>slot.start===time&&Date.parse(slot.start)>Date.now())){setError('Complete the required answers and choose an available future time.');return;}
   body={idempotencyKey:crypto.randomUUID(),answers:structuredClone(accepted),customer:{name:name.trim(),email:email.trim()},requestedStart:new Date(time).toISOString()};pendingRef.current=body;setPending(body);
  }
  inFlight.current=true;setBusy(true);
  try{const result=await client.submit(session.sessionToken,body);if(at===generation.current){setReference(result.reference);setSession(undefined);setAnswers({});setName('');setEmail('');setTime('');setPending(undefined);pendingRef.current=undefined;}}
  catch(e){if(at===generation.current){if(e instanceof FlowError&&e.code==='UNAUTHENTICATED')setExpired(true);setError(e instanceof FlowError?e.message:'Unable to save the request. Retry the same request.');}}
  finally{if(at===generation.current){inFlight.current=false;setBusy(false);}}
 }
 return <main className="checkout-card" style={{minWidth:0,overflowWrap:'anywhere'}}><p>Request form{localHarness?' · Local harness':''}</p>{!secure?<section><h1>Secure customer page required</h1><p>This request form must open on its published HTTPS site. Local HTTP does not demonstrate a customer session.</p></section>:!client?<p role="alert">The request service is not configured.</p>:reference?<section><h1>Request saved</h1><p>Reference: <strong>{reference}</strong></p><p>Your request is unconfirmed. No payment was taken and no time was reserved. Availability is not guaranteed.</p></section>:session?<form onSubmit={submit}><h1>{session.render.service.name}</h1><p>Answer the questions and choose an available time to request. The business must confirm your request.</p>{expired&&<p role="alert">Your session expired. Reload this page to start again.</p>}{isConfigurable(session.render)?<ConfigurableQuestionForm render={session.render} answers={answers} onChange={setAnswers} disabled={busy||!!pending||expired}/>:<QuestionForm service={session.render.service} config={session.render.config} answers={answers} onChange={setAnswers} disabled={busy||!!pending||expired}/>}<fieldset disabled={busy||!!pending||expired} style={{minWidth:0}}><label>Your name<input style={fieldStyle} required maxLength={200} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label><label>Email<input style={fieldStyle} type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Requested date<input style={fieldStyle} type="date" required min={localDate(new Date())} value={date} onChange={e=>{slotGeneration.current++;setTime('');setAvailability(undefined);setDate(e.target.value);}}/></label><p id="slot-timezone">Times shown in {timezone}. No payment is taken and no time is reserved by this request.</p><label>Available time<select style={fieldStyle} required aria-describedby="slot-timezone" disabled={loadingSlots||!availability?.slots.length} value={time} onChange={e=>setTime(e.target.value)}><option value="">Choose an available time</option>{availability?.slots.map(slot=><option key={slot.start} value={slot.start}>{new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(slot.start))}</option>)}</select></label>{loadingSlots&&<p role="status">Loading available times…</p>}{availability&&!availability.slots.length&&<p role="status">No available times on this date. Choose another date.</p>}{slotError&&<><p role="alert">{slotError}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Retry available times</button></>}</fieldset><button disabled={busy||expired||(!pending&&(!time||loadingSlots))}>{busy?'Saving…':pending?'Retry the same request':'Send unconfirmed request'}</button>{pending&&!busy&&<p>Your original answers are kept for a safe retry.</p>}</form>:null}{busy&&!session&&<p role="status">Opening request form…</p>}{error&&<p role="alert">{error}</p>}</main>;
}

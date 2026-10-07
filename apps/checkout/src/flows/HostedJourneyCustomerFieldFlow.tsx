import {useEffect,useId,useMemo,useRef,useState,type CSSProperties} from 'react';
import {createRuntimeClient,type PublicRuntimeConfig} from '@lumin/runtime-client';
import {formatMoney} from '@lumin/contracts';
import {PaidJourneyCustomerFieldRender,resolvePaidJourneyCustomerFieldVisibility} from '@lumin/workflow';

const bounded:CSSProperties={width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box',overflowWrap:'anywhere'};
/** Read-only published V9 presentation. Local answers confer no booking capability. */
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
 useEffect(()=>{
  const run=++epoch.current,captured=context,controller=new AbortController();let live=true;
  const active=()=>live&&run===epoch.current&&current.current===captured&&!controller.signal.aborted;
  setReceipt(null);setAnswers({});setStage(0);setMessage('');setLoading(Boolean(client));
  if(!client){setMessage('This published preview requires connected HTTPS staging.');return;}
  const timer=setTimeout(()=>{if(active()){controller.abort();setLoading(false);setMessage('Published form could not be verified. No booking or payment was made.');}},30000);
  void client.loadPaidJourneyCustomerFieldRender(installationId,{origin,signal:controller.signal}).then(value=>{
   if(active()){const parsed=PaidJourneyCustomerFieldRender.safeParse(value);if(parsed.success)setReceipt({context:captured,render:parsed.data});else setMessage('Published form could not be verified. No booking or payment was made.');setLoading(false);}
  },()=>{if(active()){setLoading(false);setMessage('Published form could not be verified. No booking or payment was made.');}}).finally(()=>clearTimeout(timer));
  return()=>{live=false;epoch.current++;controller.abort();clearTimeout(timer);};
 },[client,context,reload]);
 const published=receipt?.context===context?receipt.render:null;
 const stages=published?.form.journey.stages.filter(value=>value.enabled)??[];
 const selected=stages[stage];
 const visible=published?resolvePaidJourneyCustomerFieldVisibility(published,answers):[];
 function change(id:string,value:string){
  if(!published)return;
  // Rebuild in definition order so a hidden answer and all of its descendants are forgotten.
  const proposed={...answers,[id]:value},next:Record<string,string>={};
  try{for(const field of published.form.customerFields){
   if(resolvePaidJourneyCustomerFieldVisibility(published,next).includes(field.id)&&Object.hasOwn(proposed,field.id))next[field.id]=proposed[field.id]!;
  }
  resolvePaidJourneyCustomerFieldVisibility(published,next);setAnswers(next);}catch{/* Invalid local text never becomes a valid preview answer. */}
 }
 function move(index:number){setStage(index);requestAnimationFrame(()=>heading.current?.focus());}
 const price=published?formatMoney(published.service.price):'';
 return <section aria-label="Published booking form preview" style={{...bounded,padding:'clamp(12px,3vw,24px)',margin:'0 auto',maxWidth:published?.form.presentation.layout==='compact'?560:760}}>
  <p role="status">STAGING · Read-only published preview</p>
  <p>Questions are a local preview only. They are not saved or submitted. Scheduling, reservations, payments and confirmation are not connected here yet.</p>
  {loading&&<p role="status">Loading published form…</p>}
  {message&&<p role="alert">{message}</p>}
  {!loading&&<button type="button" onClick={()=>setReload(value=>value+1)}>Reload published preview</button>}
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
     <input id={fieldPrefix+'-'+field.id} type="text" value={answers[field.id]??''} maxLength={field.maxLength} aria-describedby={fieldPrefix+'-local-'+field.id} onChange={event=>change(field.id,event.target.value)} style={bounded}/>
     <small id={fieldPrefix+'-local-'+field.id}>Local preview answer only</small>
    </div>)}
   </div>}
   {selected.kind==='service'&&<p>The service and price above come from this published version.</p>}
   {selected.kind==='options'&&<p>No selectable priced options are configured in this published preview.</p>}
   {selected.kind==='schedule'&&<p>Scheduling is not connected in this preview. No availability or reservation is claimed.</p>}
   {selected.kind==='review_payment'&&<p>Payment is not connected in this preview. No payment has been requested or received.</p>}
   {selected.kind==='confirmation'&&<p>No booking has been created or confirmed by this preview.</p>}
   <nav aria-label="Preview steps" style={{...bounded,display:'flex',gap:12,flexWrap:'wrap'}}>
    <button type="button" disabled={stage===0} onClick={()=>move(stage-1)}>Previous preview step</button>
    <button type="button" disabled={stage===stages.length-1} onClick={()=>move(stage+1)}>Next preview step</button>
   </nav>
   <button type="button" disabled style={{...bounded,marginBlock:16}}>Booking submission not connected yet</button>
  </>}
 </section>;
}

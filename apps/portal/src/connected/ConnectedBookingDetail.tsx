import {useEffect,useState} from 'react';
import {ConnectedConfirmationReceipts,type ConfirmationReceiptsClient} from './ConnectedConfirmationReceipts';
import {Link,useParams} from 'react-router-dom';
import {formatMoney} from '@lumin/contracts';
import type {RuntimeClient,ConnectedBookingDetail,ServiceRow} from '@lumin/runtime-client';

// Conservative actionable subset only; unsupported saved values stay readable.
// Encode only a recipient, never mailto headers, and never add a country code.
function emailLink(value:string):string|undefined{
 if(value.length>254||/[\u0000-\u001f\u007f-\u009f]/.test(value))return;
 const parts=value.split('@');if(parts.length!==2)return;
 const [local,domain]=parts;
 if(!local||local.length>64||!/^[A-Za-z0-9._+-]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return;
 if(!domain||!domain.includes('.')||domain.split('.').some(label=>!label||label.length>63||!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)))return;
 return `mailto:${encodeURIComponent(value)}`;
}
function phoneLink(value:string|null):string|undefined{
 if(!value||value.length>100||/[\u0000-\u001f\u007f-\u009f]/.test(value)||!/^\+?[0-9(][0-9 .()-]*[0-9)]$/.test(value))return;
 let depth=0;for(const char of value){if(char==='('&&++depth>1)return;if(char===')'&&--depth<0)return;}if(depth!==0)return;
 const digits=value.replace(/[^0-9]/g,'');if(digits.length<7||digits.length>15)return;
 return `tel:${value.startsWith('+')?'+':''}${digits}`;
}

export function ConnectedBookingRecord({client,tenantId,bookingId,services}:{client:Pick<RuntimeClient,'bookingDetail'>&Partial<ConfirmationReceiptsClient>;tenantId:string;bookingId:string;services:ServiceRow[]}){
 const auth=client.authContextRevision?.()??0;
 const [result,setResult]=useState<{client:typeof client;tenant:string;id:string;auth:number;data:ConnectedBookingDetail|null;error:string}|null>(null);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setResult(null);void client.bookingDetail(tenantId,bookingId).then(data=>{if(active)setResult({client,tenant:tenantId,id:bookingId,auth,data,error:''})},()=>{if(active)setResult({client,tenant:tenantId,id:bookingId,auth,data:null,error:'Booking details could not be loaded. Check your connection or sign in again.'})});return()=>{active=false}},[client,tenantId,bookingId,retry,auth]);
 // Withhold the old connection's private record and error before passive effects.
 const current=result?.client===client&&result.tenant===tenantId&&result.id===bookingId&&result.auth===auth?result:null;
 const error=current?.error??'';
 const detail=current?.data;
 const emailHref=detail?.customer?emailLink(detail.customer.email):undefined;
 const phoneHref=detail?.customer?phoneLink(detail.customer.phone):undefined;
 const when=(v:string)=>new Date(v).toLocaleString();
 const statusLabel=(state:string)=>state.replaceAll('_',' ').replace(/^./,first=>first.toUpperCase());
 const show=(v:unknown):string=>v===null?'Not provided':typeof v==='object'?JSON.stringify(v):String(v);
 const savedAnswers=detail?.selection.answers;
 const answerEntries=savedAnswers!==null&&typeof savedAnswers==='object'&&!Array.isArray(savedAnswers)?Object.entries(savedAnswers):null;
 const renderAnswer=(value:unknown)=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return <span>{show(value)}</span>;
  const answer=value as Record<string,unknown>;
  // Do not interpret unfamiliar stored shapes or drop their saved fields.
  if(Object.keys(answer).some(key=>key!=='choiceIds'&&key!=='quantity')||
   (answer.choiceIds!==undefined&&(!Array.isArray(answer.choiceIds)||!answer.choiceIds.every(choice=>typeof choice==='string')))||
   (answer.quantity!==undefined&&(!Number.isSafeInteger(answer.quantity)||Number(answer.quantity)<0)))return <span>{show(value)}</span>;
  const choices=answer.choiceIds as string[]|undefined;
  return <>{choices&&<>{choices.length?<><p>Saved choice references:</p><ul>{choices.map((choice,index)=><li key={index}>{choice}</li>)}</ul></>:<p>No choice references recorded.</p>}</>}{answer.quantity!==undefined&&<p>Quantity: {String(answer.quantity)}</p>}{!choices&&answer.quantity===undefined&&<p>No choice references or quantity recorded.</p>}</>;
 };
 return <section style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}><p><Link to="/bookings">Back to bookings</Link></p>
  <h1>{detail?`Booking ${detail.reference}`:'Booking detail'}</h1>
  {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:!current?<p role="status">Loading booking…</p>:!detail?<p>No booking is available for this business and reference.</p>:<>
   <p>Status: {detail.state.replaceAll('_',' ')}</p>
   <h2>Customer</h2>{detail.customer?<dl><dt>Name</dt><dd>{detail.customer.name}</dd><dt>Email</dt><dd>{emailHref?<a href={emailHref} aria-label="Email saved customer">{detail.customer.email}</a>:detail.customer.email}</dd><dt>Phone</dt><dd>{phoneHref?<a href={phoneHref} aria-label="Call saved customer">{detail.customer.phone}</a>:detail.customer.phone??'Not provided'}</dd></dl>:<p>No customer record is linked.</p>}
   <h2>Service and schedule</h2><dl><dt>Service</dt><dd>{services.find(s=>s.id===detail.serviceId&&s.tenant_id===tenantId)?.name??detail.serviceId}</dd><dt>Starts</dt><dd>{when(detail.slotStart)}</dd><dt>Ends</dt><dd>{when(detail.slotEnd)}</dd><dt>Timezone shown</dt><dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd><dt>Duration</dt><dd>{(Date.parse(detail.slotEnd)-Date.parse(detail.slotStart))/60000} minutes</dd></dl>
   <h2>Payment</h2><dl><dt>Booking total</dt><dd>{detail.total?formatMoney(detail.total):'Not priced yet'}</dd><dt>Configured deposit</dt><dd>{detail.deposit?formatMoney(detail.deposit):'Not priced yet'}</dd><dt>Payment status</dt><dd>{detail.payment?.state.replaceAll('_',' ')??'No linked payment'}</dd>{detail.payment&&<><dt>Payment record amount</dt><dd>{formatMoney(detail.payment.amount)}</dd><dt>Provider</dt><dd>{['mock','staging_mock'].includes(detail.payment.provider)?'STAGING TEST — simulated payment':detail.payment.provider}</dd></>}</dl><p>Amounts come from the saved booking and payment records. Refund totals and outstanding balances are not available on this page yet.</p>
   <h2>Location</h2>{detail.address?<dl>{Object.entries(detail.address).map(([key,value])=><div key={key}><dt>{key}</dt><dd style={{overflowWrap:'anywhere'}}>{show(value)}</dd></div>)}</dl>:<p>No address was provided.</p>}
   <h2>Form responses</h2><h3>Saved selection answers</h3><p>These are the answers stored with this booking selection. Choice references are saved identifiers; historical question and choice labels and separate customer-form answers are not available here.</p>{answerEntries?answerEntries.length?<dl>{answerEntries.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{renderAnswer(value)}</dd></div>)}</dl>:<p>No selection answers are recorded for this booking.</p>:savedAnswers===undefined?<p>No selection answers are recorded for this booking.</p>:<p>Saved answers: {show(savedAnswers)}</p>}<dl>{Object.entries(detail.selection).filter(([key])=>key!=='serviceId'&&key!=='answers').map(([key,value])=><div key={key}><dt>{key}</dt><dd style={{overflowWrap:'anywhere'}}>{show(value)}</dd></div>)}</dl>
   {detail.notes&&<><h2>Notes</h2><p style={{overflowWrap:'anywhere'}}>{detail.notes}</p></>}
   <ConnectedConfirmationReceipts client={typeof client.readConfirmationReceiptStatus==='function'&&typeof client.authContextRevision==='function'?client as ConfirmationReceiptsClient:undefined} tenantId={tenantId} bookingId={bookingId}/>
   <h2>Activity</h2><p>Created {when(detail.createdAt)}</p>{detail.history.length===0?<p>No saved status changes are recorded for this booking.</p>:<ol>{detail.history.map((h,index)=><li key={index}><p>{h.from===null?`Status set to ${statusLabel(h.to)}.`:`Status changed from ${statusLabel(h.from)} to ${statusLabel(h.to)}.`} Recorded {when(h.at)}.</p>{h.reason&&<p>Saved reason: {h.reason}</p>}</li>)}</ol>}
  </>}
 </section>;
}
export function ConnectedBookingDetail(props:{client:RuntimeClient;tenantId:string;services:ServiceRow[]}){const {bookingId=''}=useParams();return <ConnectedBookingRecord {...props} bookingId={bookingId}/>}

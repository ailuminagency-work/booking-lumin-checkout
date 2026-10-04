import {useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {formatMoney} from '@lumin/contracts';
import type {RuntimeClient,ConnectedBookingDetail,ServiceRow} from '@lumin/runtime-client';

export function ConnectedBookingRecord({client,tenantId,bookingId,services}:{client:Pick<RuntimeClient,'bookingDetail'>;tenantId:string;bookingId:string;services:ServiceRow[]}){
 const [result,setResult]=useState<{tenant:string;id:string;data:ConnectedBookingDetail|null}|null>(null);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setResult(null);setError('');void client.bookingDetail(tenantId,bookingId).then(data=>{if(active)setResult({tenant:tenantId,id:bookingId,data})},()=>{if(active)setError('Booking details could not be loaded. Check your connection or sign in again.')});return()=>{active=false}},[client,tenantId,bookingId,retry]);
 // Never render the previous business or route record, even before effects run.
 const current=result?.tenant===tenantId&&result.id===bookingId?result:null;
 const detail=current?.data;
 const when=(v:string)=>new Date(v).toLocaleString();
 const show=(v:unknown):string=>v===null?'Not provided':typeof v==='object'?JSON.stringify(v):String(v);
 return <section><p><Link to="/bookings">Back to bookings</Link></p>
  <h1>{detail?`Booking ${detail.reference}`:'Booking detail'}</h1>
  {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>:!current?<p role="status">Loading booking…</p>:!detail?<p>No booking is available for this business and reference.</p>:<>
   <p>Status: {detail.state.replaceAll('_',' ')}</p>
   <h2>Customer</h2>{detail.customer?<dl><dt>Name</dt><dd>{detail.customer.name}</dd><dt>Email</dt><dd>{detail.customer.email}</dd><dt>Phone</dt><dd>{detail.customer.phone??'Not provided'}</dd></dl>:<p>No customer record is linked.</p>}
   <h2>Service and schedule</h2><dl><dt>Service</dt><dd>{services.find(s=>s.id===detail.serviceId&&s.tenant_id===tenantId)?.name??detail.serviceId}</dd><dt>Starts</dt><dd>{when(detail.slotStart)}</dd><dt>Ends</dt><dd>{when(detail.slotEnd)}</dd><dt>Timezone shown</dt><dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd><dt>Duration</dt><dd>{(Date.parse(detail.slotEnd)-Date.parse(detail.slotStart))/60000} minutes</dd></dl>
   <h2>Payment</h2><dl><dt>Booking total</dt><dd>{detail.total?formatMoney(detail.total):'Not priced yet'}</dd><dt>Configured deposit</dt><dd>{detail.deposit?formatMoney(detail.deposit):'Not priced yet'}</dd><dt>Payment status</dt><dd>{detail.payment?.state.replaceAll('_',' ')??'No linked payment'}</dd>{detail.payment&&<><dt>Payment record amount</dt><dd>{formatMoney(detail.payment.amount)}</dd><dt>Provider</dt><dd>{['mock','staging_mock'].includes(detail.payment.provider)?'STAGING TEST — simulated payment':detail.payment.provider}</dd></>}</dl><p>Amounts come from the saved booking and payment records. Refund totals and outstanding balances are not available on this page yet.</p>
   <h2>Location</h2>{detail.address?<dl>{Object.entries(detail.address).map(([key,value])=><div key={key}><dt>{key}</dt><dd style={{overflowWrap:'anywhere'}}>{show(value)}</dd></div>)}</dl>:<p>No address was provided.</p>}
   <h2>Form responses</h2><dl>{Object.entries(detail.selection).filter(([key])=>key!=='serviceId').map(([key,value])=><div key={key}><dt>{key}</dt><dd style={{overflowWrap:'anywhere'}}>{show(value)}</dd></div>)}</dl>
   {detail.notes&&<><h2>Notes</h2><p style={{overflowWrap:'anywhere'}}>{detail.notes}</p></>}
   <h2>Activity</h2><p>Created {when(detail.createdAt)}</p><ol>{detail.history.map((h,index)=><li key={index}>{when(h.at)} · {h.from?`${h.from} → `:''}{h.to}{h.reason?` · ${h.reason}`:''}</li>)}</ol>
  </>}
 </section>;
}
export function ConnectedBookingDetail(props:{client:RuntimeClient;tenantId:string;services:ServiceRow[]}){const {bookingId=''}=useParams();return <ConnectedBookingRecord {...props} bookingId={bookingId}/>}

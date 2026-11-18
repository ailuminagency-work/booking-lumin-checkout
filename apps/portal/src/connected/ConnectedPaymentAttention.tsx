import {useLayoutEffect,useRef,useState} from 'react';
import {PaymentAttentionError,validPaymentAttentionPage,validPaymentAttentionAcknowledgment,type PaymentAttentionPage,type RuntimeClient} from '@lumin/runtime-client';
import {Link} from 'react-router-dom';
export type PaymentAttentionClient=Pick<RuntimeClient,'readPaymentAttention'|'authContextRevision'>&Partial<Pick<RuntimeClient,'acknowledgePaymentAttention'>>;
type Props={client:PaymentAttentionClient;tenantId:string;role?:string;acknowledgmentEnabled?:boolean};
type Context={client:PaymentAttentionClient;tenant:string;auth:number;role?:string};
type View=Context&{data?:PaymentAttentionPage;error?:string};
export function ConnectedPaymentAttention({client,tenantId,role,acknowledgmentEnabled=false}:Props){
 const auth=client.authContextRevision(),generation=useRef(0),[revision,setRevision]=useState(0),[view,setView]=useState<View|null>(null),[page,setPage]=useState<(Context&{cursor:string})|null>(null);
 const [ack,setAck]=useState<(Context&{receiptId:string;busy:boolean;error?:string})|null>(null);
 const same=(x:Context|null)=>!!x&&x.client===client&&x.tenant===tenantId&&x.auth===auth&&x.role===role;
 const cursor=same(page)?page!.cursor:null;
 const available=['BUSINESS_OWNER','BUSINESS_STAFF'].includes(role??'')&&/^[0-9a-f-]{36}$/i.test(tenantId);
 useLayoutEffect(()=>{
  const at=++generation.current,controller=new AbortController(),authAt=client.authContextRevision();setView(null);setAck(null);
  if(available)void client.readPaymentAttention(tenantId,{limit:25,cursor},controller.signal).then(data=>{
   if(at!==generation.current||controller.signal.aborted)return;
   if(authAt!==client.authContextRevision())throw new PaymentAttentionError('STALE_CONTEXT','changed');
   if(!validPaymentAttentionPage(data,tenantId))throw new PaymentAttentionError('UNVERIFIED','invalid');
   setView({client,tenant:tenantId,auth:authAt,role,data});
  }).catch(error=>{
   if(at!==generation.current||controller.signal.aborted)return;
   const message=error instanceof PaymentAttentionError&&error.code==='UNSUPPORTED_CONFIG'?'Payment attention is unavailable in this workspace.':error instanceof PaymentAttentionError&&['FORBIDDEN','UNAUTHENTICATED'].includes(error.code)?'Sign in with an active business membership to view payment attention.':'Payment attention could not be verified. Refresh to try again.';
   setView({client,tenant:tenantId,auth:authAt,role,error:message});
  });
  return()=>{generation.current++;controller.abort();};
 },[client,tenantId,auth,role,available,cursor,revision,acknowledgmentEnabled]);
 const current=same(view)?view:null,currentAck=same(ack)?ack:null;
 async function markReviewed(receiptId:string){
  if(!acknowledgmentEnabled||role!=='BUSINESS_OWNER'||!client.acknowledgePaymentAttention||currentAck?.busy)return;
  const at=generation.current,authAt=client.authContextRevision();
  setAck({client,tenant:tenantId,auth:authAt,role,receiptId,busy:true});
  try{
   const result=await client.acknowledgePaymentAttention(tenantId,receiptId);
   if(at!==generation.current)return;if(authAt!==client.authContextRevision()){setRevision(n=>n+1);return;}
   if(!validPaymentAttentionAcknowledgment(result,tenantId,receiptId))throw Error('invalid');
   setView(previous=>previous&&previous.client===client&&previous.tenant===tenantId&&previous.auth===authAt&&previous.role===role&&previous.data?{...previous,data:{...previous.data,items:previous.data.items.map(item=>item.receiptId===receiptId?{...item,reviewedAt:result.reviewedAt}:item)}}:previous);
   setAck({client,tenant:tenantId,auth:authAt,role,receiptId,busy:false});
  }catch{
   if(at!==generation.current)return;if(authAt!==client.authContextRevision()){setRevision(n=>n+1);return;}
   setAck({client,tenant:tenantId,auth:authAt,role,receiptId,busy:false,error:'Review acknowledgment could not be verified. Refresh this history before trying again.'});
  }
 }

 return <section className="panel payment-attention" aria-label="Payment attention">
  <div className="panel-header"><h2>Payment attention history</h2><span className="workspace-chip">Historical observations</span></div>
  <p className="attention-explainer">These historical observations recorded a successful payment after a booking had failed. They do not establish a current balance or resolution. No booking is reopened and no refund is issued here. Marking an observation as reviewed records only that an owner saw it, not that the payment or booking is resolved. The business owner handles any refund in Stripe.</p>
  {!available?<p role="status">An active business membership is required.</p>:<>
   <button type="button" onClick={()=>{setPage(null);setRevision(n=>n+1);}}>Refresh payment attention</button>
   {currentAck?.error&&<p role="alert">{currentAck.error}</p>}
   {!current?<p role="status">Loading payment attention.</p>:current.error?<p role="alert">{current.error}</p>:current.data&&<>
    {current.data.items.length===0?<p role="status">No historical late-payment attention was recorded on this page.</p>:<ul className="attention-records">{current.data.items.map(item=><li className="attention-record" key={item.receiptId}>
     <Link to={'/bookings/'+item.bookingId}>{item.bookingReference??'View booking'}</Link>
     <p>Successful payment observed after failure. Recorded <time dateTime={item.recordedAt}>{item.recordedAt}</time>.</p>
     {item.reviewedAt?<p>Reviewed <time dateTime={item.reviewedAt}>{item.reviewedAt}</time>. This does not resolve the payment or booking.</p>:acknowledgmentEnabled&&role==='BUSINESS_OWNER'&&client.acknowledgePaymentAttention?<button type="button" disabled={!!currentAck?.busy} onClick={()=>void markReviewed(item.receiptId)}>{currentAck?.busy&&currentAck.receiptId===item.receiptId?'Recording review…':'Mark as reviewed'}</button>:null}
     {item.conflictSeen&&<p className="attention-conflict">Conflicting event facts were subsequently recorded. This observation needs separate verification.</p>}
    </li>)}</ul>}
    {current.data.nextCursor&&<button type="button" onClick={()=>setPage({client,tenant:tenantId,auth,role,cursor:current.data!.nextCursor!})}>Load older attention</button>}
   </>}
  </>}
 </section>;
}

import {useLayoutEffect,useRef,useState} from 'react';
import {PaymentAttentionError,validPaymentAttentionPage,type PaymentAttentionPage,type RuntimeClient} from '@lumin/runtime-client';
import {Link} from 'react-router-dom';
export type PaymentAttentionClient=Pick<RuntimeClient,'readPaymentAttention'|'authContextRevision'>;
type Props={client:PaymentAttentionClient;tenantId:string;role?:string};
type Context={client:PaymentAttentionClient;tenant:string;auth:number};
type View=Context&{data?:PaymentAttentionPage;error?:string};
export function ConnectedPaymentAttention({client,tenantId,role}:Props){
 const auth=client.authContextRevision(),generation=useRef(0),[revision,setRevision]=useState(0),[view,setView]=useState<View|null>(null),[page,setPage]=useState<(Context&{cursor:string})|null>(null);
 const same=(x:Context|null)=>!!x&&x.client===client&&x.tenant===tenantId&&x.auth===auth;
 const cursor=same(page)?page!.cursor:null;
 const available=['BUSINESS_OWNER','BUSINESS_STAFF'].includes(role??'')&&/^[0-9a-f-]{36}$/i.test(tenantId);
 useLayoutEffect(()=>{
  const at=++generation.current,controller=new AbortController(),authAt=client.authContextRevision();setView(null);
  if(available)void client.readPaymentAttention(tenantId,{limit:25,cursor},controller.signal).then(data=>{
   if(at!==generation.current||controller.signal.aborted)return;
   if(authAt!==client.authContextRevision())throw new PaymentAttentionError('STALE_CONTEXT','changed');
   if(!validPaymentAttentionPage(data,tenantId))throw new PaymentAttentionError('UNVERIFIED','invalid');
   setView({client,tenant:tenantId,auth:authAt,data});
  }).catch(error=>{
   if(at!==generation.current||controller.signal.aborted)return;
   const message=error instanceof PaymentAttentionError&&error.code==='UNSUPPORTED_CONFIG'?'Payment attention is unavailable in this workspace.':error instanceof PaymentAttentionError&&['FORBIDDEN','UNAUTHENTICATED'].includes(error.code)?'Sign in with an active business membership to view payment attention.':'Payment attention could not be verified. Refresh to try again.';
   setView({client,tenant:tenantId,auth:authAt,error:message});
  });
  return()=>{generation.current++;controller.abort();};
 },[client,tenantId,auth,role,available,cursor,revision]);
 const current=same(view)?view:null;
 return <section aria-label="Payment attention" style={{maxWidth:'100%',overflowWrap:'anywhere'}}>
  <h2>Payment attention history</h2>
  <p>These historical observations recorded a successful payment after a booking had failed. They do not establish a current balance or resolution. No booking is reopened and no refund is issued here.</p>
  {!available?<p role="status">An active business membership is required.</p>:<>
   <button type="button" onClick={()=>{setPage(null);setRevision(n=>n+1);}}>Refresh payment attention</button>
   {!current?<p role="status">Loading payment attention.</p>:current.error?<p role="alert">{current.error}</p>:current.data&&<>
    {current.data.items.length===0?<p role="status">No historical late-payment attention was recorded on this page.</p>:<ul>{current.data.items.map(item=><li key={item.receiptId}>
     <Link to={'/bookings/'+item.bookingId}>{item.bookingReference??'View booking'}</Link>
     <p>Successful payment observed after failure. Recorded <time dateTime={item.recordedAt}>{item.recordedAt}</time>.</p>
     {item.conflictSeen&&<p>Conflicting event facts were subsequently recorded. This observation needs separate verification.</p>}
    </li>)}</ul>}
    {current.data.nextCursor&&<button type="button" onClick={()=>setPage({client,tenant:tenantId,auth,cursor:current.data!.nextCursor!})}>Load older attention</button>}
   </>}
  </>}
 </section>;
}

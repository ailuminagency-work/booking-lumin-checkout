import {useLayoutEffect,useRef,useState} from 'react';
import {OwnerBookingFormAnswers} from '@lumin/contracts';
import {BookingFormAnswersError,type RuntimeClient} from '@lumin/runtime-client';
export type BookingFormAnswersClient=Pick<RuntimeClient,'authContextRevision'|'readBookingFormAnswers'>;
type Props={client?:BookingFormAnswersClient;tenantId:string;bookingId:string};
type View={client:Props['client'];tenantId:string;bookingId:string;auth:number;data?:OwnerBookingFormAnswers;error?:string};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function ConnectedBookingFormAnswers({client,tenantId,bookingId}:Props){
 const auth=client?.authContextRevision()??0,generation=useRef(0),[retry,setRetry]=useState(0),[view,setView]=useState<View|null>(null);
 const available=!!client&&uuid(tenantId)&&uuid(bookingId);
 useLayoutEffect(()=>{
  const at=++generation.current,controller=new AbortController(),authAt=client?.authContextRevision()??0;setView(null);
  if(available&&client){
   void client.readBookingFormAnswers(tenantId,bookingId,controller.signal).then(value=>{
    if(at!==generation.current||controller.signal.aborted)return;
    if(authAt!==client.authContextRevision()){setView({client,tenantId,bookingId,auth:authAt,error:'The signed-in account changed. Refresh this booking again.'});return;}
    const result=OwnerBookingFormAnswers.safeParse(value);
    if(!result.success||result.data.tenantId!==tenantId.toLowerCase()||result.data.bookingId!==bookingId.toLowerCase())throw Error('unverified');
    setView({client,tenantId,bookingId,auth:authAt,data:result.data});
   }).catch(error=>{
    if(at!==generation.current||controller.signal.aborted)return;
    const message=error instanceof BookingFormAnswersError&&['UNAUTHENTICATED','FORBIDDEN'].includes(error.code)?'An authenticated owner of this business is required to load saved form answers.':error instanceof BookingFormAnswersError&&error.code==='UNSUPPORTED_CONFIG'?'Saved form answers are unavailable in this workspace.':'Saved form answers could not be verified. Check your connection and refresh this booking.';
    setView({client,tenantId,bookingId,auth:authAt,error:message});
   });
  }
  return()=>{generation.current++;controller.abort();};
 },[client,tenantId,bookingId,auth,retry,available]);
 // Suppress the previous business/account snapshot during render, before cleanup effects.
 const current=view&&view.client===client&&view.tenantId===tenantId&&view.bookingId===bookingId&&view.auth===auth?view:null;
 return <section aria-label="Saved customer form answers" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}>
  <h3>Saved customer form answers</h3><p>Informational answers and labels saved with this booking’s published form. These answers do not change the booked service or payment amounts.</p>
  {!available?<p role="status">Saved customer form answers are unavailable in this view.</p>:<>
   <button type="button" disabled={!current} onClick={()=>setRetry(n=>n+1)}>Refresh saved form answers</button>
   {!current?<p role="status">Loading saved form answers…</p>:current.error?<p role="alert">{current.error}</p>:current.data?.status==='not_recorded'?<p role="status">No separate customer form answers were recorded for this booking.</p>:current.data?.status==='unsupported'?<p role="status">This booking used a form version that does not provide saved informational answers.</p>:current.data?.status==='recorded'?<>
    <p>Saved form revision: {current.data.provenance.draftRevision}. Published version: {current.data.provenance.versionId}.</p>
    {current.data.answers.length?<dl>{current.data.answers.map(answer=><div key={answer.fieldId}><dt>{answer.label}</dt><dd style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{answer.value===''?'Not provided':answer.value}</dd></div>)}</dl>:<p role="status">No informational answers were supplied for this published form.</p>}
   </>:<p role="status">Saved customer form answers are unavailable.</p>}
  </>}
 </section>;
}

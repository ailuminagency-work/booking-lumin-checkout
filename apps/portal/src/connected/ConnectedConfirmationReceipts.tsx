import {useEffect,useRef,useState} from 'react';
import {ConfirmationReceiptStatus} from '@lumin/contracts';
import {ConfirmationReceiptStatusError,type RuntimeClient} from '@lumin/runtime-client';
export type ConfirmationReceiptsClient=Pick<RuntimeClient,'authContextRevision'|'readConfirmationReceiptStatus'>;
type Props={client?:ConfirmationReceiptsClient;tenantId:string;bookingId:string};
type View={client:Props['client'];tenantId:string;bookingId:string;auth:number;checking?:boolean;receipt?:ConfirmationReceiptStatus;error?:string};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function ConnectedConfirmationReceipts({client,tenantId,bookingId}:Props){
 const auth=client?.authContextRevision()??0;
 const [view,setView]=useState<View>({client,tenantId,bookingId,auth}),generation=useRef(0),inFlight=useRef(false);
 useEffect(()=>{generation.current++;inFlight.current=false;setView({client,tenantId,bookingId,auth});return()=>{generation.current++;};},[client,tenantId,bookingId,auth]);
 const current=view.client===client&&view.tenantId===tenantId&&view.bookingId===bookingId&&view.auth===auth?view:undefined;
 const available=!!client&&uuid(tenantId)&&uuid(bookingId);
 async function refresh(){
  if(!available||!client||inFlight.current)return;const at=generation.current,authAt=client.authContextRevision();inFlight.current=true;setView({client,tenantId,bookingId,auth:authAt,checking:true});
  try{
   const value=await client.readConfirmationReceiptStatus(tenantId,bookingId);
   if(at!==generation.current)return;
   if(authAt!==client.authContextRevision()){setView({client,tenantId,bookingId,auth:authAt,error:'The signed-in business context changed. Refresh this booking again.'});return;}
   const result=ConfirmationReceiptStatus.safeParse(value);
   if(!result.success||result.data.tenantId!==tenantId.toLowerCase()||result.data.bookingId!==bookingId.toLowerCase())throw Error('unverified');
   setView({client,tenantId,bookingId,auth:authAt,receipt:result.data});
  }catch(error){if(at===generation.current)setView({client,tenantId,bookingId,auth:authAt,error:error instanceof ConfirmationReceiptStatusError&&error.code==='UNSUPPORTED_CONFIG'?'Confirmation receipt records are unavailable in this workspace.':error instanceof ConfirmationReceiptStatusError&&['FORBIDDEN','UNAUTHENTICATED'].includes(error.code)?'An authenticated owner of this business is required to check receipt records.':'Confirmation receipt records could not be verified. Refresh this selected booking after checking your connection and signed-in business.'});}
  finally{if(at===generation.current)inFlight.current=false;}
 }
 return <section aria-label="Confirmation receipt records" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}>
 <h2>Confirmation receipts</h2><p>A recorded receipt reflects the consumer’s reported successful-send result. It does not verify delivery to the customer or prove provider activation.</p>
 {!available?<p role="status">Confirmation receipt records are unavailable in this view.</p>:<>
 <p>Business owners can explicitly refresh the records for this selected booking. Owner membership is verified for each read.</p>
 <button type="button" disabled={current?.checking} onClick={()=>void refresh()}>Refresh confirmation receipts</button>
 {current?.checking?<p role="status">Checking receipt records…</p>:current?.error?<p role="alert">{current.error}</p>:!current?.receipt?<p role="status">Receipt records have not been checked.</p>:<table style={{width:'100%',maxWidth:'100%',tableLayout:'fixed',overflowWrap:'anywhere'}}>
 <caption>Recorded confirmation receipts for this booking</caption><thead><tr><th scope="col">Channel</th><th scope="col">Recorded receipt</th></tr></thead>
 <tbody>{current.receipt.channels.map(row=><tr key={row.channel}><th scope="row">{row.channel==='email'?'Email':'SMS'}</th><td>{row.receiptRecorded?'Successful-send receipt recorded':'No successful-send receipt recorded'}</td></tr>)}</tbody>
 </table>}
 </>}
 </section>;
}

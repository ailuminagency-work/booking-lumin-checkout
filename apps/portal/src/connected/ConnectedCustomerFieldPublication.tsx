import {useEffect,useRef,useState} from 'react';
import {PublicationError,type RuntimeClient,type PaidCustomerFieldPublicationState,type PaidSimpleFieldOwnerDraft} from '@lumin/runtime-client';

const checkoutOrigin='https://booking-lumin-checkout-staging.netlify.app';
type Client=Pick<RuntimeClient,'publishPaidCustomerFieldDraft'|'recoverPaidCustomerFieldPublication'|'paidCustomerFieldPublicationState'>;
type Props={client:Client;tenantId:string;draft?:PaidSimpleFieldOwnerDraft;pristine:boolean;available:boolean;blocked:boolean;onStateChange:()=>void};
type View={client:Client;tenantId:string;state:PaidCustomerFieldPublicationState;error:string;checking:boolean};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
/** Explicit owner actions only. The runtime client retains writer identity and uncertainty. */
export function ConnectedCustomerFieldPublication({client,tenantId,draft,pristine,available,blocked,onStateChange}:Props){
 const initial=():View=>({client,tenantId,state:client.paidCustomerFieldPublicationState(tenantId),error:'',checking:false});
 const [snapshot,setSnapshot]=useState(initial),generation=useRef(0),inFlight=useRef(false);
 useEffect(()=>{generation.current++;inFlight.current=false;setSnapshot(initial());return()=>{generation.current++;};},[client,tenantId]);
 const view=snapshot.client===client&&snapshot.tenantId===tenantId?snapshot:initial(),state=view.state;
 const pending=state.phase==='publishing',uncertain=state.phase==='unknown';
 const validDraft=!!draft&&draft.schemaVersion===2&&uuid(draft.flowId)&&Number.isSafeInteger(draft.revision)&&draft.revision>0;
 const alreadyPublished=state.phase==='published'&&draft?.flowId===state.flowId&&draft.revision===state.draftRevision;
 const canPublish=available&&!blocked&&!view.checking&&!pending&&(uncertain?state.checkoutOrigin===checkoutOrigin:validDraft&&pristine&&!alreadyPublished);
 const identity=uncertain||pending?{flowId:state.flowId,revision:state.draftRevision}:validDraft?{flowId:draft!.flowId,revision:draft!.revision}:undefined;
 const refresh=()=>{setSnapshot({client,tenantId,state:client.paidCustomerFieldPublicationState(tenantId),error:'',checking:false});onStateChange();};
 async function act(kind:'publish'|'recover'){
  if(inFlight.current||blocked||!available||pending||!identity||kind==='publish'&&!canPublish)return;
  const at=generation.current;inFlight.current=true;setSnapshot({...view,error:'',checking:kind==='recover'});
  const promise=kind==='publish'?client.publishPaidCustomerFieldDraft(tenantId,identity.flowId,{expectedDraftRevision:identity.revision,checkoutOrigin}):client.recoverPaidCustomerFieldPublication(tenantId,identity.flowId,identity.revision);
  onStateChange();if(kind==='publish')setSnapshot({client,tenantId,state:client.paidCustomerFieldPublicationState(tenantId),error:'',checking:false});
  try{await promise;if(at===generation.current)refresh();}
  catch(error){if(at===generation.current){setSnapshot({client,tenantId,state:client.paidCustomerFieldPublicationState(tenantId),error:error instanceof PublicationError?error.message:'Publication remains unverified. Keep the same form and saved revision; do not start another attempt.',checking:false});onStateChange();}}
  finally{if(at===generation.current)inFlight.current=false;}
 }
 const published=state.phase==='published'?state:undefined,receipt=published?.receipt,p=receipt?.publication;
 const verified=!!receipt&&uuid(receipt.flowId)&&Number.isSafeInteger(receipt.draftRevision)&&receipt.draftRevision>0&&receipt.flowId===published?.flowId&&receipt.draftRevision===published?.draftRevision&&p?.renderSchemaVersion===5&&uuid(p.versionId)&&uuid(p.installationId)&&p.hostedPath==='/checkout/flow/'+p.installationId;
 return <section aria-label="Informational-field publication" style={{minWidth:0,overflowWrap:'anywhere'}}><h3>Publish informational fields</h3><p>Publish only the saved revision you reviewed. The server pins the service, design and informational fields into an immutable staging form. Payment remains simulated.</p>
 {!available&&<p role="status">Hosted informational-field publication is awaiting staging runtime activation. Draft editing and preview remain available.</p>}
 <button type="button" disabled={!canPublish} onClick={()=>void act('publish')}>{uncertain?'Retry the same field publication':'Publish saved informational fields'}</button>
 {identity&&<><p>Form ID: {identity.flowId}; saved revision: {identity.revision}.</p><button type="button" disabled={!available||blocked||pending||view.checking} onClick={()=>void act('recover')}>{view.checking?'Checking field publication receipt...':'Check field publication receipt'}</button></>}
 {!pristine&&!uncertain&&<p>Save your changes and load the current draft before publishing.</p>}
 {pending&&<p role="status">Publishing informational fields. Keep this form ID and revision if the response is interrupted.</p>}
 {uncertain&&<p role="alert">Publication outcome is unverified. Draft and publication changes remain locked. Check the exact receipt. {state.checkoutOrigin===checkoutOrigin?'An explicit retry uses only the same frozen request.':'This read-only recovery has no original request body and cannot authorize publication retry.'}</p>}
 {(pending||uncertain)&&<button type="button" onClick={refresh}>Check this session's field publication state</button>}
 {view.error&&<p role="alert">{view.error}</p>}
 {verified&&receipt&&p&&<><p role="status">Informational-field publication verified at the last check.</p><p>Published draft revision: {receipt.draftRevision}; version: {p.versionId}; installation: {p.installationId}.</p><a href={checkoutOrigin+p.hostedPath} target="_blank" rel="noopener noreferrer">Open published informational-field booking form</a><p>This receipt verifies publication identity at that check. It does not certify browser loading, payment completion or a later current version.</p></>}
 {receipt&&!verified&&<p role="alert">The publication receipt could not be verified. No installation link is shown.</p>}
 </section>;
}

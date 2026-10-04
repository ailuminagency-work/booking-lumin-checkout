import {useEffect,useRef,useState,type FormEvent} from 'react';
import {formatMoney} from '@lumin/contracts';
import {PublicationError,type RuntimeClient,type ServiceRow,type PaidSimplePublicationState} from '@lumin/runtime-client';
export const STAGING_CHECKOUT_ORIGIN='https://booking-lumin-checkout-staging.netlify.app';
type PublisherClient=Pick<RuntimeClient,'publishPaidSimple'|'recoverPaidSimplePublication'|'paidSimplePublicationState'>;
export function PaidSimplePublisher({client,tenantId,role,services,staging,catalogLoading=false}:{client:PublisherClient;tenantId:string;role?:string;services:ServiceRow[];staging:boolean;catalogLoading?:boolean}){
 const [name,setName]=useState(''),[serviceId,setServiceId]=useState(''),[error,setError]=useState('');
 const [attemptId,setAttemptId]=useState(''),[checking,setChecking]=useState(false);
 const [snapshot,setSnapshot]=useState<{client:PublisherClient;tenantId:string;publication:PaidSimplePublicationState}>(()=>({client,tenantId,publication:client.paidSimplePublicationState(tenantId)}));
 const generation=useRef(0),inFlight=useRef(false);
 useEffect(()=>{generation.current++;inFlight.current=false;setName('');setServiceId('');setError('');setAttemptId('');setChecking(false);setSnapshot({client,tenantId,publication:client.paidSimplePublicationState(tenantId)});return()=>{generation.current++;}},[client,tenantId,role,staging]);
 const publication=snapshot.client===client&&snapshot.tenantId===tenantId?snapshot.publication:{phase:'ready'} as const;
 const available=services.filter(service=>service.tenant_id===tenantId&&service.active&&Number.isSafeInteger(service.base_price)&&service.base_price>0&&service.duration_minutes>=5&&service.duration_minutes<=1440&&/^[A-Z]{3}$/.test(service.currency));
 async function publish(event:FormEvent){
  event.preventDefault();if(!staging||role!=='BUSINESS_OWNER'||publication.phase!=='ready'||catalogLoading||inFlight.current)return;
  if(!available.some(service=>service.id===serviceId)||!name.trim()||name.trim().length>200){setError('Choose an active simple service and enter a form name.');return;}
  const at=generation.current,flowId=crypto.randomUUID();inFlight.current=true;setError('');setSnapshot({client,tenantId,publication:{phase:'publishing',flowId}});
  try{const receipt=await client.publishPaidSimple(tenantId,flowId,{serviceId,name:name.trim(),checkoutOrigin:STAGING_CHECKOUT_ORIGIN});if(at===generation.current)setSnapshot({client,tenantId,publication:{phase:'published',flowId,receipt}});}
  catch(error){if(at===generation.current){const unknown=!(error instanceof PublicationError)||error.delivery==='unknown';setSnapshot({client,tenantId,publication:unknown?{phase:'unknown',flowId}:{phase:'ready'}});setError(error instanceof PublicationError?error.message: 'Publication status is unverified. The request may have been saved. Check this same attempt using the receipt lookup; do not repeat publication.');}}
  finally{if(at===generation.current)inFlight.current=false;}
 }
 async function recover(event:FormEvent){
  event.preventDefault();if(!staging||role!=='BUSINESS_OWNER'||inFlight.current||publication.phase==='publishing'||publication.phase==='published')return;
  const flowId=publication.phase==='unknown'?publication.flowId:attemptId.trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowId)){setError('Enter the exact publication attempt ID for this business.');return;}
  const at=generation.current;inFlight.current=true;setChecking(true);setError('');
  // Reading a known attempt cannot authorize another create-only publication.
  setSnapshot({client,tenantId,publication:{phase:'unknown',flowId}});
  try{const receipt=await client.recoverPaidSimplePublication(tenantId,flowId);if(at===generation.current)setSnapshot({client,tenantId,publication:{phase:'published',flowId,receipt}});}
  catch(error){if(at===generation.current){setSnapshot({client,tenantId,publication:client.paidSimplePublicationState(tenantId)});setError(error instanceof PublicationError?error.message:'The receipt could not be checked. Publication status remains unverified; do not publish again.');}}
  finally{if(at===generation.current){inFlight.current=false;setChecking(false);}}
 }
 if(!staging)return <section><h1>Booking Form</h1><p>Paid form publication is available only in the staging test workspace.</p></section>;
 if(role!=='BUSINESS_OWNER')return <section><h1>Booking Form</h1><p role="status">Only a business owner can publish a staging paid form.</p></section>;
 const receipt=publication.phase==='published'?publication.receipt:undefined;
 const hostedUrl=receipt?STAGING_CHECKOUT_ORIGIN+receipt.hostedPath:'';
 const iframe=receipt?`<iframe src="${hostedUrl}" title="Booking Lumin staging test booking" width="100%" height="720" style="border:0"></iframe>`:'';
 return <section style={{minWidth:0,overflowWrap:'anywhere'}}><h1>Booking Form</h1><p>Staging paid simple-service form. Payment is simulated; no real money is charged.</p>
  {receipt?<><h2>Staging form published</h2><dl><dt>Publication attempt</dt><dd><input aria-label="Publication attempt ID" readOnly value={publication.phase==='published'?publication.flowId:''} style={{width:'100%',maxWidth:'100%',minWidth:0}}/></dd><dt>Published version</dt><dd>{receipt.versionId}</dd><dt>Installation</dt><dd>{receipt.installationId}</dd><dt>Hosted path</dt><dd>{receipt.hostedPath}</dd></dl><p>This installation points to the immutable published version.</p><p><a href={hostedUrl} target="_blank" rel="noopener noreferrer">Open staging booking form</a></p><label>Website iframe code<textarea readOnly value={iframe} rows={5} style={{width:'100%',maxWidth:'100%',minWidth:0}}/></label><p>Use this code for a staging test installation. Keep the publication attempt ID. After reloading and signing in, use that ID to check the receipt for this business.</p></>:publication.phase==='unknown'?<><p role="alert">Publication status is unverified. The request may have been saved. Publishing again is locked for this business in this session.</p><p>Do not submit another publication to recover this attempt. Check its receipt below. If you reload, keep this attempt ID and sign in to the same business before checking it again.</p><p>Publication attempt: {publication.flowId}</p></>:publication.phase==='publishing'?<><p>Publication attempt: {publication.flowId}. Keep this ID if you reload before the receipt arrives.</p><p role="status">Publishing the staging form...</p><button type="button" onClick={()=>setSnapshot({client,tenantId,publication:client.paidSimplePublicationState(tenantId)})}>Check this session's receipt</button><p>This checks the receipt held in this session. It does not repeat publication.</p></>:<form onSubmit={publish}><fieldset disabled={catalogLoading} className="form-stack" style={{minWidth:0}}><label>Simple service<select required value={serviceId} onChange={event=>setServiceId(event.target.value)}><option value="">Choose a service</option>{available.map(service=><option key={service.id} value={service.id}>{service.name} - {formatMoney({amount:service.base_price,currency:service.currency})}</option>)}</select></label><label>Form name<input required maxLength={200} value={name} onChange={event=>setName(event.target.value)}/></label><label>Checkout origin<input readOnly value={STAGING_CHECKOUT_ORIGIN}/></label><p>The server verifies that the service has a positive price and no questions, items, add-ons or resource requirements, then pins its current catalog in a new version.</p>{!catalogLoading&&!available.length&&<p>No active simple services with a positive price are available.</p>}<button disabled={catalogLoading||!available.length}>Publish staging test form</button></fieldset></form>}
  {(publication.phase==='ready'||publication.phase==='unknown')&&<form onSubmit={recover} aria-label="Check publication receipt"><h2>Check an existing publication</h2><p>Enter a known publication attempt ID for this business. This reads its current active receipt and never creates or republishes a form. A missing receipt keeps publication locked for this attempt.</p><label>Publication attempt ID<input required value={publication.phase==='unknown'?publication.flowId:attemptId} readOnly={publication.phase==='unknown'} disabled={checking} onChange={event=>setAttemptId(event.target.value)} style={{width:'100%',maxWidth:'100%',minWidth:0}}/></label><button disabled={checking} type="submit">{checking?'Checking receipt...':'Check publication receipt'}</button></form>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}

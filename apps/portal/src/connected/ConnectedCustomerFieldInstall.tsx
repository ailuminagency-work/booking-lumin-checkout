import {useEffect,useRef,useState} from 'react';
import {ConnectedBookingLinkQr} from './ConnectedBookingLinkQr';
import {CopyInstallationSnippet} from './CopyInstallationSnippet';
import {CustomerFieldInstallHealth,TenantId} from '@lumin/contracts';
import type {PaidCustomerFieldPublicationReceipt,RuntimeClient} from '@lumin/runtime-client';

type Client=Pick<RuntimeClient,'paidCustomerFieldPublicationHealth'>;
type Props={client:Client;tenantId:string;expected:PaidCustomerFieldPublicationReceipt};
type View={client:Client;selection:string;phase:'idle'|'checking'|'checked'|'failed';health?:CustomerFieldInstallHealth};
const checkout='https://booking-lumin-checkout-staging.netlify.app';

const validId=(value:unknown):value is string=>typeof value==='string'&&value===value.toLowerCase()&&TenantId.safeParse(value).success;
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function validExpected(value:unknown):value is PaidCustomerFieldPublicationReceipt{
 if(!exact(value,['flowId','draftRevision','publication'])||!validId(value.flowId)||typeof value.draftRevision!=='number'||!Number.isSafeInteger(value.draftRevision)||value.draftRevision<1)return false;
 const r=value.publication;
 return exact(r,['versionId','installationId','renderSchemaVersion','hostedPath'])&&validId(r.versionId)&&validId(r.installationId)&&r.renderSchemaVersion===5&&r.hostedPath==='/checkout/flow/'+r.installationId;
}

export function ConnectedCustomerFieldInstall({client,tenantId,expected}:Props){
 if(!validId(tenantId)||!validExpected(expected))return <section aria-label="Customer information installation"><p role="alert">Choose a verified V5 publication receipt for this business before viewing installation evidence.</p></section>;
 // Keep caller mutations out of the async read and displayed installation strings.
 const pinned={flowId:expected.flowId,draftRevision:expected.draftRevision,publication:{...expected.publication}};
 return <InstallEvidence client={client} tenantId={tenantId} expected={pinned}/>;
}

function InstallEvidence({client,tenantId,expected}:Props){
 const r=expected.publication,selection=JSON.stringify([tenantId,expected.flowId,expected.draftRevision,r.versionId,r.installationId,r.renderSchemaVersion,r.hostedPath]),generation=useRef(0),inFlight=useRef(false);
 const [snapshot,setSnapshot]=useState<View>(()=>({client,selection,phase:'idle'}));
 useEffect(()=>{generation.current++;inFlight.current=false;setSnapshot({client,selection,phase:'idle'});return()=>{generation.current++;};},[client,selection]);
 const view:View=snapshot.client===client&&snapshot.selection===selection?snapshot:{client,selection,phase:'idle'};
 async function check(){
  if(inFlight.current)return;const at=generation.current;inFlight.current=true;setSnapshot({client,selection,phase:'checking'});
  try{
   const value=await client.paidCustomerFieldPublicationHealth(tenantId,{...expected,publication:{...r}}),parsed=CustomerFieldInstallHealth.safeParse(value);
   const health=parsed.success?parsed.data:undefined,receipt=health?.installation.receipt;
   if(!health||health.flowId!==expected.flowId||health.draftRevision!==expected.draftRevision||health.versionId!==r.versionId||health.renderSchemaVersion!==5||receipt&&(receipt.versionId!==r.versionId||receipt.installationId!==r.installationId||receipt.renderSchemaVersion!==5||receipt.hostedPath!==r.hostedPath))throw Error('Unverified installation evidence');
   if(at===generation.current)setSnapshot({client,selection,phase:'checked',health});
  }catch{if(at===generation.current)setSnapshot({client,selection,phase:'failed'});}
  finally{if(at===generation.current)inFlight.current=false;}
 }
 const hostedUrl=checkout+r.hostedPath,iframe=`<iframe src="${hostedUrl}" title="Booking Lumin staging test booking" width="100%" height="720" style="border:0"></iframe>`;
 const script=(mode:'inline'|'launcher')=>`<script src="${checkout}/booking-lumin-staging.js" data-installation="${r.installationId}" data-mode="${mode}"></script>`;
 const health=view.phase==='checked'?view.health:undefined;
 return <section aria-label="Customer information installation" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h3>Customer information form installation</h3>
  <p>Published draft revision: {expected.draftRevision}; form: {expected.flowId}; immutable version: {r.versionId}; installation: {r.installationId}.</p>
  <p><a href={hostedUrl} target="_blank" rel="noopener noreferrer">Open staging customer information form</a></p>
  <CopyInstallationSnippet label="Direct staging form URL" value={hostedUrl} selection={selection}/>
  <CopyInstallationSnippet label="Website iframe code" value={iframe} selection={selection} rows={5}/>
  <CopyInstallationSnippet label="Staging JavaScript inline code" value={script('inline')} selection={selection} rows={4}/>
  <CopyInstallationSnippet label="Staging launcher / modal code" value={script('launcher')} selection={selection} rows={4}/>
  <p>Select and copy the code for the selected immutable installation. These controlled snippets run only on the canonical Booking Lumin staging Checkout and Portal origins. Merchant website domains are not enabled. Payments stay simulated.</p>
  <p>The launcher opens after a click and keeps the same form when closed and reopened. The direct hosted link remains available if a browser cannot open a modal. Copying code does not certify browser loading or a complete embedded booking.</p>
  <ConnectedBookingLinkQr tenantId={tenantId} expected={expected} checkoutOrigin={checkout}/>
  <h3>Install evidence</h3>
  <p>This read-only check does not load a customer form, publish, retry an uncertain writer or change installation settings. A missing result does not unlock an uncertain save, publication or rollback.</p>
  <button type="button" disabled={view.phase==='checking'} onClick={()=>void check()}>{view.phase==='checking'?'Checking install evidence...':'Check install evidence'}</button>
  {view.phase==='checking'&&<p role="status">Checking current server evidence...</p>}
  {view.phase==='idle'&&<p role="status">Install evidence has not been checked. Browser load health is unverified.</p>}
  {view.phase==='failed'&&<p role="alert">Install evidence could not be verified for this publication. Browser load health remains unverified. Sign in again or refresh the publication receipt before another explicit check.</p>}
  {health&&<>
   <p role="status">Install evidence at last check: {health.status==='unknown'?'Unknown':'Degraded'}. Browser load health is unverified.</p>
   <p>{health.installation.status==='available'?'The server returned the matching installation receipt. This does not prove browser loading.':'The installation could not be verified by this check. This does not prove that no installation exists.'}</p>
   <p>Catalog at last check: {health.catalog.status==='compatible'?'Compatible with this pinned version':health.catalog.status==='incompatible'?'Incompatible with this pinned version':'Unavailable for verification'}.</p>
   <p>Stored issued sessions for this version: {health.customerEvidence.sessionCountCapped?'at least ':''}{health.customerEvidence.issuedSessionCount.toLocaleString('en-US')}. Session issuance is not successful browser-load evidence.</p>
   <p>Browser-load evidence: unavailable. Last successful browser load: unavailable.</p>
   <p>TEST currently confirmed staging bookings for this version: {health.customerEvidence.bookingCountCapped?'at least ':''}{health.customerEvidence.confirmedStagingBookingCount.toLocaleString('en-US')}. These counts use simulated staging payments. Completed, cancelled and refunded bookings are excluded. They do not prove live payments or install health.</p>
   <p>Last currently confirmed TEST staging booking: {health.customerEvidence.lastConfirmedStagingBookingAt??'unavailable'}.</p>
   <p>Test payment evidence: staging mock, simulated, enabled. Browser loading remains unverified even when a test booking was confirmed.</p>
  </>}
 </section>;
}

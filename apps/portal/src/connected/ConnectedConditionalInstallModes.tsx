import {TenantId} from '@lumin/contracts';
import {CopyInstallationSnippet} from './CopyInstallationSnippet';
import type {PaidConditionalPublicationReceipt} from '@lumin/runtime-client';

const checkout='https://booking-lumin-checkout-staging.netlify.app';
const validId=(value:unknown):value is string=>typeof value==='string'&&value===value.toLowerCase()&&TenantId.safeParse(value).success;
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function validReceipt(value:unknown):value is PaidConditionalPublicationReceipt{
 if(!exact(value,['flowId','draftRevision','publication'])||!validId(value.flowId)||typeof value.draftRevision!=='number'||!Number.isSafeInteger(value.draftRevision)||value.draftRevision<1)return false;
 const r=value.publication;
 return exact(r,['versionId','installationId','renderSchemaVersion','hostedPath'])&&validId(r.versionId)&&validId(r.installationId)&&r.renderSchemaVersion===6&&r.hostedPath==='/checkout/flow/'+r.installationId;
}

export function ConnectedConditionalInstallModes({expected,tenantId}:{expected:PaidConditionalPublicationReceipt;tenantId:string}){
 if(!validId(tenantId)||!validReceipt(expected))return <p role="alert">A verified immutable V6 conditional installation receipt is required.</p>;
 const installationId=expected.publication.installationId,selection=JSON.stringify([tenantId,expected.flowId,expected.draftRevision,expected.publication]),hostedUrl=checkout+expected.publication.hostedPath;
 const snippet=(mode:'inline'|'launcher')=>`<script src="${checkout}/booking-lumin-staging.js" data-installation="${installationId}" data-mode="${mode}"></script>`;
 return <section aria-label="Conditional staging installation modes" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}>
  <h3>Conditional JavaScript and launcher staging checks</h3>
  <p>These snippets use the last verified immutable conditional installation. They run only on the canonical Booking Lumin staging Checkout and Portal origins. Merchant website domains are not enabled. Payments stay simulated.</p>
  <CopyInstallationSnippet label="Conditional direct staging form URL" value={hostedUrl} selection={selection}/>
  <CopyInstallationSnippet label="Conditional website iframe code" value={`<iframe src="${hostedUrl}" title="Booking Lumin conditional staging test booking" width="100%" height="720" style="border:0"></iframe>`} selection={selection} rows={5}/>
  <CopyInstallationSnippet label="Conditional staging JavaScript inline code" value={snippet('inline')} selection={selection} rows={4}/>
  <CopyInstallationSnippet label="Conditional staging launcher / modal code" value={snippet('launcher')} selection={selection} rows={4}/>
  <p>The launcher opens only after a click and preserves the same form when closed and reopened. The direct hosted link remains available if a browser cannot open a modal.</p>
  <p>Copying code does not save, publish, retry an uncertain request or change installation settings. Snippets alone do not certify browser loading or a complete embedded booking.</p>
 </section>;
}

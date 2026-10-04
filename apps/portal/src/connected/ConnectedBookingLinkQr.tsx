import {useEffect,useRef,useState} from 'react';
import {TenantId} from '@lumin/contracts';
import type {PaidCustomerFieldPublicationReceipt} from '@lumin/runtime-client';

const approvedOrigin='https://booking-lumin-checkout-staging.netlify.app';
type Props={tenantId:string;expected:PaidCustomerFieldPublicationReceipt;checkoutOrigin:string};
type Format='png'|'svg';
type Artifact={format:Format;url:string};
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=(value:unknown):value is string=>typeof value==='string'&&value===value.toLowerCase()&&TenantId.safeParse(value).success;
function approved(tenantId:unknown,origin:unknown,value:unknown):value is PaidCustomerFieldPublicationReceipt{
 if(!id(tenantId)||origin!==approvedOrigin||!exact(value,['flowId','draftRevision','publication'])||!id(value.flowId)||typeof value.draftRevision!=='number'||!Number.isSafeInteger(value.draftRevision)||value.draftRevision<1)return false;
 const receipt=value.publication;
 return exact(receipt,['versionId','installationId','renderSchemaVersion','hostedPath'])&&id(receipt.versionId)&&id(receipt.installationId)&&receipt.renderSchemaVersion===5&&receipt.hostedPath==='/checkout/flow/'+receipt.installationId;
}
/** A local artifact from a caller-approved publication; not a publication or health check. */
export function ConnectedBookingLinkQr({tenantId,expected,checkoutOrigin}:Props){
 if(!approved(tenantId,checkoutOrigin,expected))return <section aria-label="Booking link QR"><p role="alert">Choose an approved published customer information form and its canonical staging Checkout origin before generating a QR code.</p></section>;
 const pinned={...expected,publication:{...expected.publication}};
 return <BookingQr tenantId={tenantId} expected={pinned} checkoutOrigin={checkoutOrigin}/>;
}
function BookingQr({tenantId,expected,checkoutOrigin}:Props){
 const receipt=expected.publication,link=checkoutOrigin+receipt.hostedPath;
 const selection=JSON.stringify([tenantId,expected.flowId,expected.draftRevision,receipt.versionId,receipt.installationId,link]);
 const generation=useRef(0),inFlight=useRef(false);
 const [snapshot,setSnapshot]=useState<{selection:string;phase:'idle'|'generating'|'ready'|'failed';artifact?:Artifact}>(()=>({selection,phase:'idle'}));
 useEffect(()=>{generation.current++;inFlight.current=false;setSnapshot({selection,phase:'idle'});return()=>{generation.current++;};},[selection]);
 const view=snapshot.selection===selection?snapshot:{selection,phase:'idle' as const};
 async function generate(format:Format){
  if(inFlight.current)return;const at=generation.current;inFlight.current=true;setSnapshot({selection,phase:'generating'});
  try{
   const encoder=await import('qrcode'),options={errorCorrectionLevel:'M' as const,margin:4,width:512,color:{dark:'#000000ff',light:'#ffffffff'}};
   const output=format==='png'?await encoder.toDataURL(link,{...options,type:'image/png'}):await encoder.toString(link,{...options,type:'svg'});
   if(format==='png'&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(output))throw Error('Invalid image');
   // The encoder produces vector paths, never user text or embedded HTML.
   if(format==='svg'&&(!output.startsWith('<svg ')||!output.endsWith('</svg>\n')||/<(?:script|foreignObject|image|a)\b|(?:href|on[a-z]+)\s*=/i.test(output)))throw Error('Invalid vector image');
   const artifact={format,url:format==='png'?output:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(output)};
   if(at===generation.current)setSnapshot({selection,phase:'ready',artifact});
  }catch{if(at===generation.current)setSnapshot({selection,phase:'failed'});}
  finally{if(at===generation.current)inFlight.current=false;}
 }
 return <section aria-label="Booking link QR" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h3>Booking link QR</h3><p>Generate a local QR image for this approved immutable staging booking link. This does not publish, load a customer session or certify that the form is currently available. Payments stay simulated.</p>
  <label>QR booking URL<input readOnly value={link} style={{width:'100%',maxWidth:'100%',minWidth:0}}/></label>
  <p>Published draft revision: {expected.draftRevision}; version: {receipt.versionId}.</p>
  <button type="button" disabled={view.phase==='generating'} onClick={()=>void generate('png')}>Generate PNG QR</button>{' '}
  <button type="button" disabled={view.phase==='generating'} onClick={()=>void generate('svg')}>Generate SVG QR</button>
  {view.phase==='generating'&&<p role="status" aria-live="polite">Generating the booking link QR locally...</p>}
  {view.phase==='failed'&&<p role="alert">The QR image could not be generated. Try generating it again for this approved link.</p>}
  {view.phase==='ready'&&view.artifact&&<><img alt="QR code for the approved staging booking link" src={view.artifact.url} width={256} height={256} style={{maxWidth:'100%',height:'auto'}}/><p><a href={view.artifact.url} download={'booking-link-'+receipt.installationId+'.'+view.artifact.format}>Download {view.artifact.format.toUpperCase()} QR</a></p><p role="status">QR image generated locally. It contains only the displayed booking URL.</p></>}
 </section>;
}

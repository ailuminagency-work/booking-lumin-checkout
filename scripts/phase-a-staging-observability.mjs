import {pathToFileURL} from 'node:url';
const target='https://booking-lumin-api-staging.onrender.com';
const owner='https://booking-lumin-portal-staging.netlify.app';
const foreign='https://observability-foreign.example.test';
const spoof='00000000-0000-4000-8000-000000000001';
const queryCanary='lumin_observability_query_canary',headerCanary='lumin_observability_header_canary';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
class ProbeFailure extends Error{constructor(code,check){super('Staging observability probe failed.');this.code=code;this.check=check;}}
const failure=(code,check)=>new ProbeFailure(code,check);
export function parseObservabilityArgs(args){
 if(!Array.isArray(args)||args.length!==3||args[0]!=='--staging-read-only'||args[1]!=='--expected-release-sha')throw failure('CONFIGURATION','configuration');
 return {optIn:true,environment:'staging',target,expectedReleaseSha:args[2]};
}
/** Explicit read-only staging probes. Import and selftest never access a hosted service. */
export async function runObservabilityProbe(config,options={}){
 let expectedReleaseSha,fetchImpl,timeoutMs;
 try{
  if(!plain(config)||!exact(config,['optIn','environment','target','expectedReleaseSha'])||!plain(options)||Object.keys(options).some(key=>!['fetchImpl','timeoutMs'].includes(key)))throw Error();
  const input=Object.getOwnPropertyDescriptors(config),settings=Object.getOwnPropertyDescriptors(options);
  if([...Object.values(input),...Object.values(settings)].some(field=>!Object.hasOwn(field,'value')))throw Error();
  expectedReleaseSha=input.expectedReleaseSha.value;fetchImpl=settings.fetchImpl?.value??globalThis.fetch;timeoutMs=settings.timeoutMs?.value??10000;
  if(input.optIn.value!==true||input.environment.value!=='staging'||input.target.value!==target||typeof expectedReleaseSha!=='string'||!/^[0-9a-f]{40}$/.test(expectedReleaseSha)||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error();
 }catch{throw failure('CONFIGURATION','configuration');}
 const ids=new Set(),checks=[];
 const definitions=[['health','/health',200,'ok'],['ready','/ready',200,'ready'],['version','/version',200,'version'],['anonymous_owner_history','/api/confirmation-receipt-history?canary='+queryCanary,401,'UNAUTHENTICATED',owner],['foreign_owner_history','/api/confirmation-receipt-history?canary='+queryCanary,403,'FORBIDDEN',foreign]];
 for(const [check,path,status,expected,origin] of definitions){
  const controller=new AbortController();let timer,reader,bodyStream;
  const task=(async()=>{
   let response;try{response=await fetchImpl(target+path,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Accept:'application/json',...(origin?{Origin:origin,'X-Request-Id':spoof,'X-Observability-Canary':headerCanary}:{})}});}catch{throw failure('NETWORK',check);}
   bodyStream=response.body;
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw failure('NETWORK',check);}
   if(response.redirected||response.status!==status||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||response.headers.get('cache-control')!=='no-store'||response.headers.get('x-content-type-options')!=='nosniff'||response.headers.get('set-cookie')!==null||response.headers.get('access-control-allow-credentials')!==null||response.headers.get('access-control-expose-headers')!==null)throw failure('RESPONSE',check);
   if(response.url&&response.url!==target+path)throw failure('RESPONSE',check);
   if(response.headers.get('access-control-allow-origin')!==(origin===owner?owner:null)||(origin===owner&&response.headers.get('vary')!=='Origin'))throw failure('RESPONSE',check);
   const requestId=response.headers.get('x-request-id');if(!uuid.test(requestId??'')||requestId===spoof||ids.has(requestId))throw failure('RESPONSE',check);
   if(!response.body)throw failure('RESPONSE',check);reader=response.body.getReader();let bytes=0;const chunks=[];
   while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)throw failure('RESPONSE',check);chunks.push(part.value);}
   let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw failure('RESPONSE',check);}
   const valid=expected==='version'?exact(body,['schemaVersion','service','environment','releaseSha'])&&body.schemaVersion===1&&body.service==='booking-lumin-api'&&body.environment==='staging'&&body.releaseSha===expectedReleaseSha:status===200?exact(body,['status'])&&body.status===expected:exact(body,['ok','code'])&&body.ok===false&&body.code===expected;
   if(!valid)throw failure('RESPONSE',check);
   if(controller.signal.aborted)throw failure('NETWORK',check);
   ids.add(requestId);checks.push(Object.freeze({check,status,requestId}));
  })();
  try{await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('NETWORK',check));},timeoutMs);})]);}
  catch(error){if(error instanceof ProbeFailure)throw error;throw failure('RESPONSE',check);}
  finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});else if(bodyStream)void bodyStream.cancel().catch(()=>{});}
 }
 return Object.freeze({schemaVersion:1,result:'PASS',environment:'staging',releaseSha:expectedReleaseSha,checks:Object.freeze(checks),requestIdsUnique:true,spoofedIdRejected:true,readOnly:true,authenticatedOwnerAcceptance:false,providerDeliveryProof:false});
}
const main=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(main){try{const args=process.argv.slice(2);if(args.length===1&&args[0]==='--selftest'){const {runSelfTest}=await import('./phase-a-staging-observability.test.mjs');console.log(JSON.stringify(await runSelfTest({runObservabilityProbe,parseObservabilityArgs})));}else console.log(JSON.stringify(await runObservabilityProbe(parseObservabilityArgs(args))));}catch(error){console.error(JSON.stringify({schemaVersion:1,result:'FAIL',code:error instanceof ProbeFailure?error.code:'CONFIGURATION',check:error instanceof ProbeFailure?error.check:'configuration',readOnly:true}));process.exitCode=1;}}

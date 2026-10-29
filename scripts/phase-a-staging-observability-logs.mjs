import {pathToFileURL} from 'node:url';
import {types} from 'node:util';
const fields=['event','schemaVersion','service','environment','releaseSha','requestId','method','routeFamily','outcome','statusCode','durationMs','durationCapped'];
const methods=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','OTHER'];
const families=['health','readiness','version','customer_flow','owner_notifications','owner_booking','owner_business','owner_catalog','owner_publication','owner_roster','other'];
const checks=[['health',200,'health'],['ready',200,'readiness'],['version',200,'version'],['anonymous_owner_history',401,'owner_notifications'],['foreign_owner_history',403,'owner_notifications']];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid=()=>Object.assign(new Error('Offline observability records could not be verified.'),{code:'INVALID_EVIDENCE'});
function plain(value){return !types.isProxy(value)&&value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function object(value,keys){
 if(!plain(value))throw invalid();const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
 if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)))throw invalid();
 const copy={};for(const key of keys){const field=descriptors[key];if(!field||!Object.hasOwn(field,'value')||!field.enumerable)throw invalid();copy[key]=field.value;}return copy;
}
function array(value,maximum){
 if(types.isProxy(value)||!Array.isArray(value))throw invalid();const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
 if(!Number.isInteger(length)||length<0||length>maximum)throw invalid();const descriptors=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(descriptors).length!==length+1)throw invalid();
 const copy=[];for(let i=0;i<length;i++){const field=descriptors[i];if(!field||!Object.hasOwn(field,'value')||!field.enumerable)throw invalid();copy.push(field.value);}return copy;
}
function telemetry(input){
 if(plain(input)&&Object.hasOwn(input,'message')){
  const raw=object(input,['id','labels','message','timestamp']);
  if(typeof raw.id!=='string'||raw.id.length<1||raw.id.length>256||typeof raw.timestamp!=='string'||raw.timestamp.length<1||raw.timestamp.length>128||(types.isProxy(raw.labels)||!(plain(raw.labels)||Array.isArray(raw.labels)))||typeof raw.message!=='string'||raw.message.length>4096||Buffer.byteLength(raw.message,'utf8')>4096)throw invalid();
  // Labels are transport metadata: never inspect their values or invoke getters.
  input=JSON.parse(raw.message);
 }
 return object(input,fields);
}
/** Pure offline validation. Caller must supply records already read from the trusted
 * staging service; this cannot establish their provenance or hosted certification. */
export function validateObservabilityLogs(expectedReleaseSha,probe,records){
 try{
  if(typeof expectedReleaseSha!=='string'||!/^[0-9a-f]{40}$/.test(expectedReleaseSha))throw invalid();
  const evidence=object(probe,['schemaVersion','result','environment','releaseSha','checks','requestIdsUnique','spoofedIdRejected','readOnly','authenticatedOwnerAcceptance','providerDeliveryProof']);
  if(evidence.schemaVersion!==1||evidence.result!=='PASS'||evidence.environment!=='staging'||evidence.releaseSha!==expectedReleaseSha||evidence.requestIdsUnique!==true||evidence.spoofedIdRejected!==true||evidence.readOnly!==true||evidence.authenticatedOwnerAcceptance!==false||evidence.providerDeliveryProof!==false)throw invalid();
  const requested=array(evidence.checks,5);if(requested.length!==5)throw invalid();const ids=[];
  for(let i=0;i<5;i++){const item=object(requested[i],['check','status','requestId']);if(item.check!==checks[i][0]||item.status!==checks[i][1]||typeof item.requestId!=='string'||!uuid.test(item.requestId)||ids.includes(item.requestId))throw invalid();ids.push(item.requestId);}
  const rows=array(records,1000);if(rows.length<5)throw invalid();const seen=new Set(),matched=new Set();
  for(const input of rows){
   const row=telemetry(input);
   if(row.event!=='staging_request'||row.schemaVersion!==1||row.service!=='booking-lumin-api'||row.environment!=='staging'||row.releaseSha!==expectedReleaseSha||typeof row.requestId!=='string'||!uuid.test(row.requestId)||!methods.includes(row.method)||!families.includes(row.routeFamily)||!['completed','aborted'].includes(row.outcome)||!Number.isInteger(row.durationMs)||row.durationMs<0||row.durationMs>300000||typeof row.durationCapped!=='boolean'||row.durationCapped&&row.durationMs!==300000)throw invalid();
   if(row.outcome==='aborted'?row.statusCode!==null:!Number.isInteger(row.statusCode)||row.statusCode<100||row.statusCode>999)throw invalid();
   if(seen.has(row.requestId))throw invalid();seen.add(row.requestId);
   const index=ids.indexOf(row.requestId);if(index!==-1){if(row.method!=='GET'||row.routeFamily!==checks[index][2]||row.statusCode!==checks[index][1]||row.outcome!=='completed')throw invalid();matched.add(row.requestId);}
  }
  if(matched.size!==5)throw invalid();
  return Object.freeze({schemaVersion:1,result:'PASS',recordsValidated:rows.length,matchedRequests:5,requestIds:Object.freeze(ids)});
 }catch{throw invalid();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);if(args.length!==1||args[0]!=='--selftest')throw invalid();const{runSelfTest}=await import('./phase-a-staging-observability-logs.test.mjs');console.log(JSON.stringify(await runSelfTest({validateObservabilityLogs})));}
 catch{console.error(JSON.stringify({result:'FAIL',code:'INVALID_EVIDENCE'}));process.exitCode=1;}
}

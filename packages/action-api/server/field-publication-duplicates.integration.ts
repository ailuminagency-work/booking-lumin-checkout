/** Inert on import. Four duplicate-publication races in a root-created disposable database.
 * This is not HTTP authentication, runtime activation or general race certification. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { parseFieldPublicationV1 } from '../../workflow/src/fieldPublicationV1';
import { blocked } from './text-field-drafts-concurrency.integration';
import { textDraftTestProfile, verifyTextDraftDatabase } from './text-field-drafts-test-profile';
import { observeTextDraftConnectionEnd, awaitTextDraftConnectionCleanup } from './text-field-drafts.integration';
export const CASE_COUNT=4;
export function initialReceipt(){return {schemaVersion:1,kind:'FIELD_PUBLICATION_DUPLICATES',status:'failed',category:'CONFIGURATION_FAILED',cases:0,connectionsClosed:false};}
export function configuration(env:NodeJS.ProcessEnv,platform:NodeJS.Platform=process.platform){
 assert.equal(env.FIELD_PUBLICATION_DUPLICATES_APPROVED,'1');assert.equal(env.TEXT_DRAFT_CONCURRENCY_APPROVED,'1');
 return {...textDraftTestProfile(env,'TEXT_DRAFT_CONCURRENCY_DATABASE',platform).connection,statement_timeout:7000,lock_timeout:5000,query_timeout:9000,idle_in_transaction_session_timeout:10000,application_name:'lumin_publication_duplicates'};
}
export function definition(){return {schemaVersion:3,fields:[{key:'notes',kind:'textarea',prompt:' Exact notes ',required:false,minLength:0,maxLength:100},{key:'choice',kind:'dropdown',required:true,choices:[{id:'second',label:' Same '},{id:'first',label:' Same '}]}]};}
type Fixture={actor:string;tenant:string;flow:string;service:string};
async function bounded<T>(task:Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BOUND')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
export async function main(){
 const result=initialReceipt(),clients:Client[]=[],ends:ReturnType<typeof observeTextDraftConnectionEnd>[]=[],queries=new Set<Promise<unknown>>();let fault=false,finished=false;
 const watchdog=setTimeout(()=>{if(!finished){writeSync(1,JSON.stringify({...result,status:'failed',category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);}},90000);
 function query(client:Client,sql:string,params:unknown[]=[]){const task=client.query(sql,params);queries.add(task);void task.then(()=>queries.delete(task),()=>queries.delete(task));return task;}
 async function fixture(observer:Client):Promise<Fixture>{
  const f={actor:randomUUID(),tenant:randomUUID(),flow:randomUUID(),service:randomUUID()};
  await query(observer,'begin');
  try{
   await query(observer,'insert into auth.users(id,email) values($1,$2)',[f.actor,'publication-race-'+f.actor+'@example.test']);
   await query(observer,'insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,$4,$5)',[f.tenant,'Synthetic publication race',f.tenant,'UTC','USD']);
   await query(observer,"insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[f.tenant,f.actor]);
   await query(observer,"insert into public.services(id,tenant_id,archetype,name,currency,base_price) values($1,$2,'simple','Synthetic race','USD',0)",[f.service,f.tenant]);
   await query(observer,"insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values($1,$2,'count','Count','quantity',true,0,1,5,'[]')",[f.tenant,f.service]);
   await query(observer,'select public.save_configurable_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)',[f.actor,f.tenant,f.flow,f.service,'Synthetic race',JSON.stringify({authoringVersion:2,config:{key:'race',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]},questionOverrides:{}})]);
   await query(observer,'select public.save_field_draft_v3($1,$2,$3,0,1,$4::jsonb)',[f.actor,f.tenant,f.flow,JSON.stringify(definition())]);
   await query(observer,'commit');return f;
  }catch(error){await query(observer,'rollback');throw error;}
 }
 async function sourceState(observer:Client){
  const state:Record<string,unknown>={};
  // Fixed identifiers only; capture exact full rows, not counts or just the tested tuple.
  for(const table of ['tenants','tenant_members','services','service_questions','flows','flow_drafts','field_draft_families','text_field_drafts','field_drafts_v2','field_drafts_v3','flow_versions','bound_flow_versions','flow_installations','flow_sessions','mode_flow_installations','mode_flow_installation_history','mode_flow_sessions'])state[table]=(await query(observer,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as value from public.${table} t`)).rows[0].value;
  return state;
 }
 async function artifacts(observer:Client):Promise<Record<string,unknown>[]>{return (await query(observer,"select coalesce(jsonb_agg(to_jsonb(t) order by version_id),'[]'::jsonb) as value from public.field_publication_versions_v1 t")).rows[0].value;}
 function expected(f:Fixture,version:string){return parseFieldPublicationV1({fieldPublicationVersion:1,tenantId:f.tenant,flowId:f.flow,versionId:version,parentAuthoringVersion:2,sourceParentRevision:1,sourceFieldDraftRevision:1,definition:definition(),submissionMode:'unconfirmed_request'});}
 async function publish(client:Client,f:Fixture,version:string){const response=await query(client,'select public.publish_field_snapshot_v1($1,$2,$3,1,1,$4) as value',[f.actor,f.tenant,f.flow,version]);assert.equal(response.rows.length,1);const raw=response.rows[0].value;assert.deepEqual(raw,expected(f,version));assert.deepEqual(parseFieldPublicationV1(raw),raw);return raw;}
 try{
  assert.equal(process.argv.length,2);const config=configuration(process.env);result.category='CONNECTION_FAILED';
  // Own all clients and end observations before the first connect attempt.
  for(let i=0;i<3;i++){const client=new Client(config);clients.push(client);ends.push(observeTextDraftConnectionEnd(client));client.on('error',()=>{fault=true;});}
  for(const client of clients)await client.connect();
  const [a,b,observer]=clients as [Client,Client,Client];
  await verifyTextDraftDatabase({query:sql=>query(observer,sql)},textDraftTestProfile(process.env,'TEXT_DRAFT_CONCURRENCY_DATABASE'));
  const pids={a:(await query(a,'select pg_backend_pid() as pid')).rows[0].pid,b:(await query(b,'select pg_backend_pid() as pid')).rows[0].pid};
  result.category='CASE_FAILED';
  for(const samePair of [true,false])for(const rollback of [false,true]){
   const first=await fixture(observer),second=samePair?first:await fixture(observer),firstVersion=randomUUID(),secondVersion=samePair?randomUUID():firstVersion;
   const before=await sourceState(observer),beforeArtifacts=await artifacts(observer);
   await query(a,'begin isolation level read committed');await query(a,'set local role service_role');await publish(a,first,firstVersion);
   await query(b,'begin isolation level read committed');await query(b,'set local role service_role');
   let settled=false;
   const waiter=publish(b,second,secondVersion).then(value=>{settled=true;return {ok:true as const,value};},(error:unknown)=>{settled=true;return {ok:false as const,error};});
   await blocked({query:(sql,params)=>query(observer,sql,params)},pids.b,pids.a,()=>settled);assert.equal(settled,false);
   await query(a,rollback?'rollback':'commit');const outcome=await waiter;
   if(rollback){assert.equal(outcome.ok,true);if(outcome.ok)assert.deepEqual(outcome.value,expected(second,secondVersion));await query(b,'commit');}
   else{assert.equal(outcome.ok,false);if(!outcome.ok){assert.equal((outcome.error as {code?:unknown}).code,'40001');assert.equal((outcome.error as {message?:unknown}).message,'FIELD_PUBLICATION_V1_ARTIFACT_CONFLICT');}await query(b,'rollback');}
   const winner=rollback?second:first,version=rollback?secondVersion:firstVersion;
   const row={version_id:version,tenant_id:winner.tenant,flow_id:winner.flow,source_parent_revision:1,source_field_draft_revision:1,envelope:expected(winner,version)};
   const wanted=[...beforeArtifacts,row].sort((left,right)=>String(left.version_id)<String(right.version_id)?-1:String(left.version_id)>String(right.version_id)?1:0);
   assert.deepEqual(await artifacts(observer),wanted);assert.deepEqual(await sourceState(observer),before);assert.equal(fault,false);result.cases++;
  }
  assert.equal(result.cases,CASE_COUNT);assert.equal(queries.size,0);assert.equal(fault,false);result.status='passed';result.category='COMPLETE';
 }catch{result.status='failed';}
 finally{
  let cleanupFailed=false;
  try{const rolled=await bounded(Promise.allSettled(clients.map(client=>query(client,'rollback'))),11000);assert.ok(rolled.every(value=>value.status==='fulfilled'));await bounded(Promise.allSettled([...queries]),9000);assert.equal(queries.size,0);}catch{cleanupFailed=true;}
  try{await awaitTextDraftConnectionCleanup(clients.map(client=>client.end()),ends,7000);result.connectionsClosed=clients.length===3&&!cleanupFailed&&queries.size===0;}catch{cleanupFailed=true;}
  if(cleanupFailed||(!result.connectionsClosed&&clients.length)){result.status='failed';result.category='CLEANUP_UNOBSERVED';}
  if(fault){result.status='failed';if(result.category==='COMPLETE')result.category='CONNECTION_FAILED';}
  finished=true;clearTimeout(watchdog);
 }
 writeSync(1,JSON.stringify(result)+'\n');return result.status==='passed'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const fatal=()=>{writeSync(1,JSON.stringify({...initialReceipt(),category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);};
 process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);process.exitCode=await main();
}

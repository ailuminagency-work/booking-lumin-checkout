/** Root-supervised disposable PostgreSQL race/parity harness. Import is inert.
 * Synthetic fixture/winner commits are intentional; no live data or providers.
 * Root owns database creation, migrations and external bounded output supervision.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client, type ClientConfig } from 'pg';
import { parseTextFieldDocument } from '@lumin/workflow';
import { textDraftTestProfile, verifyTextDraftDatabase } from './text-field-drafts-test-profile';
const CASES=['create_create','save_save','parent_before_save','save_before_parent','revoke_before_save','save_before_revoke'] as const;
export function configuration(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): ClientConfig {
 assert.equal(env.TEXT_DRAFT_CONCURRENCY_APPROVED,'1');
 const profile=textDraftTestProfile(env,'TEXT_DRAFT_CONCURRENCY_DATABASE',platform);
 return {...profile.connection,statement_timeout:10000,lock_timeout:8000,idle_in_transaction_session_timeout:15000,query_timeout:12000,application_name:'lumin_text_draft_concurrency'};
}
interface Fixture { actor: string; tenant: string; flow: string; service: string }
export function corpus() {
 const f={key:'notes',kind:'text',required:true,minLength:1,maxLength:4096};
 const doc=(field: unknown)=>({schemaVersion:1,fields:[field]});
 return [null,[],{}, {schemaVersion:1,fields:[]},doc(f),doc({...f,required:false,minLength:0,maxLength:0}),
  ...['a','Z9_','a'.repeat(64),'a'.repeat(65),'__proto__','constructor','prototype','1a','é','a\n','a\r','a\r\n','a\u2028','a\u2029','a b','a.b',''].map(key=>doc({...f,key})),
  ...[-1,0,0.5,1,4096,4097].map(minLength=>doc({...f,minLength})),
  ...[-1,0,0.5,1,4096,4097].map(maxLength=>doc({...f,maxLength})),
  ...['textarea',null,1].map(kind=>doc({...f,kind})),doc({...f,required:'true'}),doc({...f,extra:true}),
  {schemaVersion:2,fields:[f]},{schemaVersion:1,fields:[f,f]},
  {schemaVersion:1,fields:Array.from({length:64},(_,i)=>({...f,key:'f'+i}))},
  {schemaVersion:1,fields:Array.from({length:65},(_,i)=>({...f,key:'f'+i}))},
  {schemaVersion:1,fields:[{key:'notes',kind:'text',required:true,minLength:1}]},
 ];
}
export async function blocked(observer: { query(sql: string, params: number[]): Promise<{ rows: { blocked: boolean }[] }> },waitingPid: number,blockingPid: number,settled: () => boolean,clock=()=>performance.now()) {
 const end=clock()+5000;
 for(let observations=0;observations<256 && clock()<end;observations++) {
  assert.equal(settled(),false,'early completion');
  const r=await observer.query('select $2::integer=any(pg_blocking_pids($1::integer)) as blocked',[waitingPid,blockingPid]);
  if(r.rows[0]?.blocked===true){assert.equal(settled(),false);return;}
  // Yield to pending query completions; this is not a timing-based lock barrier.
  await new Promise(resolve=>setImmediate(resolve));
 }
 throw Error('BARRIER_UNOBSERVED');
}
function pending<T>(promise: Promise<T>) {let done=false;const outcome=promise.then(value=>{done=true;return {ok:true as const,value};},(error: unknown)=>{done=true;return {ok:false as const,code:error && typeof error==='object' && 'code' in error && typeof error.code==='string'?error.code:'UNKNOWN'};});return {outcome,settled:()=>done};}
async function success<T>(p: ReturnType<typeof pending<T>>){const r=await p.outcome;assert.equal(r.ok,true);return r.value;}
async function rejected<T>(p: ReturnType<typeof pending<T>>,code: string){const r=await p.outcome;assert.equal(r.ok,false);assert.equal(r.code,code);}
const definition=()=>({schemaVersion:1,fields:[{key:'notes',kind:'text',required:true,minLength:1,maxLength:4096}]});
const authoring=()=>({authoringVersion:2,config:{key:'parent',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]},questionOverrides:{}});
async function parent(client: Client,f: Fixture,revision: number) {return client.query('select public.save_configurable_flow_draft($1,$2,$3,$4,$5,$6,$7::jsonb) as result',[f.actor,f.tenant,f.flow,f.service,revision,'Synthetic text race',JSON.stringify(authoring())]);}
async function save(client: Client,f: Fixture,revision: number,parentRevision: number) {return client.query('select public.save_text_field_draft($1,$2,$3,$4,$5,$6::jsonb) as result',[f.actor,f.tenant,f.flow,revision,parentRevision,JSON.stringify(definition())]);}
async function read(client: Client,f: Fixture) {return client.query('select public.get_text_field_draft($1,$2,$3) as result',[f.actor,f.tenant,f.flow]);}
async function begin(client: Client,role=true) {await client.query('begin');if(role)await client.query('set local role service_role');}
async function fixture(observer: Client) {
 const f={actor:randomUUID(),tenant:randomUUID(),flow:randomUUID(),service:randomUUID()};
 await observer.query('begin');
 try {
  await observer.query('insert into auth.users(id,email) values($1,$2)',[f.actor,'text-race-'+f.actor+'@example.test']);
  await observer.query('insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,$4,$5)',[f.tenant,'Synthetic text race','text-race-'+f.tenant,'UTC','USD']);
  await observer.query('insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,$3)',[f.tenant,f.actor,'BUSINESS_OWNER']);
  await observer.query('insert into public.services(id,tenant_id,archetype,name,currency,base_price) values($1,$2,$3,$4,$5,0)',[f.service,f.tenant,'simple','Synthetic text race','USD']);
  await observer.query("insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values($1,$2,'count','Count','quantity',true,0,1,5,'[]')",[f.tenant,f.service]);
  await parent(observer,f,0);await observer.query('commit');
 } catch(error) {await observer.query('rollback');throw error;}
 return f;
}
async function race(name: typeof CASES[number],a: Client,b: Client,observer: Client,pids: {a:number;b:number}) {
 const f=await fixture(observer);
 if(name==='save_save')await save(observer,f,0,1);
 if(name==='create_create'||name==='save_save') {
  const revision=name==='create_create'?0:1;
  await begin(a);await save(a,f,revision,1);await begin(b);
  const second=pending(save(b,f,revision,1));await blocked(observer,pids.b,pids.a,second.settled);
  await a.query('commit');await rejected(second,'40001');await b.query('rollback');
  const r=(await read(observer,f)).rows[0].result.receipt;assert.equal(r.draftRevision,revision+1);assert.equal(r.savedParentRevision,1);
 } else if(name==='parent_before_save') {
  await begin(a);await parent(a,f,1);await begin(b);
  const second=pending(save(b,f,0,1));await blocked(observer,pids.b,pids.a,second.settled);
  await a.query('commit');await rejected(second,'40001');await b.query('rollback');
  const r=(await read(observer,f)).rows[0].result;assert.equal(r.status,'missing');assert.equal(r.currentParentRevision,2);
 } else if(name==='save_before_parent') {
  await begin(a);await save(a,f,0,1);await begin(b);
  const second=pending(parent(b,f,1));await blocked(observer,pids.b,pids.a,second.settled);
  await a.query('commit');await success(second);await b.query('commit');
  const r=(await read(observer,f)).rows[0].result.receipt;assert.equal(r.savedParentRevision,1);assert.equal(r.currentParentRevision,2);assert.equal(r.draftRevision,1);
 } else if(name==='revoke_before_save') {
  await begin(a,false);await a.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[f.tenant,f.actor]);await begin(b);
  const second=pending(save(b,f,0,1));await blocked(observer,pids.b,pids.a,second.settled);
  await a.query('commit');await rejected(second,'42501');await b.query('rollback');
  assert.equal((await observer.query('select count(*)::integer as count from public.text_field_drafts where tenant_id=$1 and flow_id=$2',[f.tenant,f.flow])).rows[0].count,0);
 } else if(name==='save_before_revoke') {
  await begin(a);await save(a,f,0,1);await begin(b,false);
  const second=pending(b.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[f.tenant,f.actor]));await blocked(observer,pids.b,pids.a,second.settled);
  await a.query('commit');await success(second);await b.query('commit');
  assert.equal((await observer.query('select draft_revision::integer as revision from public.text_field_drafts where tenant_id=$1 and flow_id=$2',[f.tenant,f.flow])).rows[0].revision,1);
  await rejected(pending(save(observer,f,1,1)),'42501');
 } else throw Error('UNKNOWN_CASE');
}
async function bound<T>(promise: Promise<T>,milliseconds: number): Promise<T> {let timer: ReturnType<typeof setTimeout> | undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('TIME_BOUND')),milliseconds);})]);}finally{clearTimeout(timer);}}
export async function main() {
 const result={schemaVersion:1,kind:'TEXT_DRAFT_CONCURRENCY',status:'failed',category:'CONFIGURATION_FAILED',cases:0,parityCases:0,connectionsClosed:false};
 const clients: Client[]=[];let finished=false;let connectionFault=false;
 const watchdog=setTimeout(()=>{if(!finished){writeSync(1,JSON.stringify({...result,status:'failed',category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);}},120000);
 try {
  assert.equal(process.argv.length,2);const config=configuration(process.env);
  result.category='CONNECTION_FAILED';
  for(let i=0;i<3;i++){const client=new Client(config);clients.push(client);client.on('error',()=>{connectionFault=true;});await client.connect();}
  const a=clients[0]!,b=clients[1]!,observer=clients[2]!;
  await verifyTextDraftDatabase(observer,textDraftTestProfile(process.env,'TEXT_DRAFT_CONCURRENCY_DATABASE'));
  const pids={a:(await a.query('select pg_backend_pid() as pid')).rows[0].pid,b:(await b.query('select pg_backend_pid() as pid')).rows[0].pid};
  result.category='PARITY_FAILED';
  for(const input of corpus()) {
   let accepted=false;try{parseTextFieldDocument(input);accepted=true;}catch{}
   const sql=(await observer.query('select lumin.text_field_definition_valid($1::jsonb) as accepted',[JSON.stringify(input)])).rows[0].accepted;
   assert.equal(sql,accepted);result.parityCases++;
  }
  result.category='CASE_FAILED';
  for(const name of CASES){await race(name,a,b,observer,pids);assert.equal(connectionFault,false);result.cases++;}
  assert.equal(result.cases,6);result.category='COMPLETE';result.status='passed';
 } catch {result.status='failed';}
 finally {
  const closed=await Promise.allSettled(clients.map(async client=>{
   let rollbackFailed=false;try{await bound(client.query('rollback'),13000);}catch{rollbackFailed=true;}
   let ended=false;client.once('end',()=>{ended=true;});await bound(client.end(),5000);assert.equal(ended,true);assert.equal(rollbackFailed,false);
  }));
  result.connectionsClosed=clients.length===3&&closed.every(item=>item.status==='fulfilled');
  if(clients.length>0&&!result.connectionsClosed){result.status='failed';result.category='CLEANUP_UNOBSERVED';}
  if(connectionFault){result.status='failed';if(result.category==='COMPLETE')result.category='CONNECTION_FAILED';}
  finished=true;clearTimeout(watchdog);
 }
 writeSync(1,JSON.stringify(result)+'\n');return result.status==='passed'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 process.on('uncaughtException',()=>{writeSync(1,'{"schemaVersion":1,"kind":"TEXT_DRAFT_CONCURRENCY","status":"failed","category":"CLEANUP_UNOBSERVED","cases":0,"parityCases":0,"connectionsClosed":false}\n');process.exit(1);});
 process.on('unhandledRejection',()=>{writeSync(1,'{"schemaVersion":1,"kind":"TEXT_DRAFT_CONCURRENCY","status":"failed","category":"CLEANUP_UNOBSERVED","cases":0,"parityCases":0,"connectionsClosed":false}\n');process.exit(1);});
 process.exitCode=await main();
}

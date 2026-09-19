/** Native repository proof on a supervisor-created disposable database only.
 * Inert on import; no HTTP, provider, production authentication or activation.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client,Pool} from 'pg';
import {parseFieldDraftReadV3,parseFieldDraftReceiptV3} from '@lumin/workflow';
import {textDraftTestProfile,verifyTextDraftDatabase} from './text-field-drafts-test-profile';
import {observeTextDraftConnectionEnd,awaitTextDraftConnectionCleanup} from './text-field-drafts.integration';
import {createFieldDraftV3Repository} from './field-drafts-v3-repository';
export function fieldRepositoryV3Configuration(env:NodeJS.ProcessEnv,platform:NodeJS.Platform=process.platform){
 assert.equal(env.FIELD_DRAFT_V3_REPOSITORY_APPROVED,'1');
 const profile=textDraftTestProfile(env,'TEXT_DRAFT_HTTP_DATABASE',platform);
 return {...profile.connection,max:1,idleTimeoutMillis:0,statement_timeout:4000,lock_timeout:3000,idle_in_transaction_session_timeout:6000,query_timeout:6000,application_name:'lumin_field_v3_repository'};
}
const authoring=()=>({authoringVersion:2,config:{key:'repository',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]},questionOverrides:{}});
export const repositoryV3Definition=()=>({schemaVersion:3,fields:[{key:'short',kind:'text',required:false,minLength:0,maxLength:20,prompt:' Short question '},{key:'note',kind:'textarea',required:false,minLength:0,maxLength:4096,prompt:' Exact label '},{key:'choice',kind:'dropdown',required:true,prompt:' Choose one ',choices:[{id:'first',label:' Same label '},{id:'second',label:' Same label '}]}]});
export async function runFieldDraftV3RepositoryIntegration(){
 const result={schemaVersion:1,kind:'FIELD_DRAFT_V3_REPOSITORY',status:'failed',category:'CONFIGURATION_FAILED',cases:0,connectionsClosed:false};
 let pool:Pool|undefined,observer:Client|undefined,connected=false,fault=false;
 let observerEnd:ReturnType<typeof observeTextDraftConnectionEnd>|undefined;
 const acquired=new Set<Client>();
 const ends=new Map<Client,ReturnType<typeof observeTextDraftConnectionEnd>>();
 const watchdog=setTimeout(()=>{writeSync(1,JSON.stringify({...result,status:'failed',category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);},55000);
 try{
  const config=fieldRepositoryV3Configuration(process.env);
  pool=new Pool(config);pool.on('error',()=>{fault=true;});pool.on('acquire',client=>acquired.add(client));pool.on('release',(_error,client)=>{if(client)acquired.delete(client);});pool.on('connect',client=>ends.set(client,observeTextDraftConnectionEnd(client)));
  observer=new Client(config);observer.on('error',()=>{fault=true;});observerEnd=observeTextDraftConnectionEnd(observer);
  result.category='CONNECTION_FAILED';await observer.connect();connected=true;
  await verifyTextDraftDatabase(observer,textDraftTestProfile(process.env,'TEXT_DRAFT_HTTP_DATABASE'));
  result.category='FIXTURE_FAILED';
    const f = { ownerA: randomUUID(), ownerB: randomUUID(), staff: randomUUID(), tenantA: randomUUID(), tenantB: randomUUID(), serviceA: randomUUID(), serviceB: randomUUID(), flowA: randomUUID(), flowB: randomUUID() };
    await observer.query('begin');
    try {
      for (const actor of [f.ownerA, f.ownerB, f.staff]) await observer.query('insert into auth.users(id,email) values($1,$2)', [actor, 'field-repository-' + actor + '@example.test']);
      for (const [tenant, actor, service, flow] of [[f.tenantA, f.ownerA, f.serviceA, f.flowA], [f.tenantB, f.ownerB, f.serviceB, f.flowB]] as const) {
        await observer.query('insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,$4,$5)', [tenant, 'Synthetic repository', 'field-repository-' + tenant, 'UTC', 'USD']);
        await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [tenant, actor]);
        await observer.query("insert into public.services(id,tenant_id,archetype,name,currency,base_price) values($1,$2,'simple','Synthetic repository','USD',0)", [service, tenant]);
        await observer.query("insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values($1,$2,'count','Count','quantity',true,0,1,5,'[]')", [tenant, service]);
        await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)', [actor, tenant, flow, service, 'Synthetic repository', JSON.stringify(authoring())]);
      }
      await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_STAFF')", [f.tenantA, f.staff]);
      await observer.query('commit');
    } catch (error) { await observer.query('rollback'); throw error; }
 const repo=createFieldDraftV3Repository(pool),definition=repositoryV3Definition();
 const get=()=>repo.call('get_field_draft_v3',[f.ownerA,f.tenantA,f.flowA]);
 const save=(revision:number,parent:number)=>repo.call('save_field_draft_v3',[f.ownerA,f.tenantA,f.flowA,revision,parent,definition]);
 const denied=async(task:Promise<unknown>,code:string)=>assert.rejects(task,(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===code);
 const stored=async()=>JSON.stringify((await observer!.query('select draft_revision,saved_parent_revision,definition from public.field_drafts_v3 where tenant_id=$1 and flow_id=$2',[f.tenantA,f.flowA])).rows);
 result.category='CASE_FAILED';
 assert.deepEqual(await get(),{status:'missing',fieldDraftVersion:3,parentAuthoringVersion:2,currentParentRevision:1,runtimePublishable:false});
 const created=await save(0,1);assert.equal(parseFieldDraftReceiptV3(created).stale,false);assert.deepEqual(created,{fieldDraftVersion:3,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition,runtimePublishable:false});
 assert.deepEqual(await get(),{status:'present',receipt:created});
 const updated=await save(1,1);assert.deepEqual(updated,{...(created as object),draftRevision:2});result.cases++;
 // Two CAS failures with successful rollback must leave the single pooled connection usable with no role leak.
 const pid=(await pool.query('select pg_backend_pid() as pid')).rows[0].pid;const before=await stored();
 await denied(save(0,1),'CONFLICT');await denied(save(1,1),'CONFLICT');assert.equal(await stored(),before);assert.deepEqual(await get(),{status:'present',receipt:updated});
 const reused=(await pool.query('select pg_backend_pid() as pid,current_user as role')).rows[0];assert.equal(reused.pid,pid);assert.equal(reused.role,'postgres');result.cases++;
 await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,1,$5,$6::jsonb)',[f.ownerA,f.tenantA,f.flowA,f.serviceA,'Edited parent',JSON.stringify(authoring())]);
 const staleRead=await get();assert.deepEqual(staleRead,{status:'present',receipt:{...(updated as object),currentParentRevision:2}});const checkedRead=parseFieldDraftReadV3(staleRead);assert.equal(checkedRead.status,'present');if(checkedRead.status==='present')assert.equal(checkedRead.receipt.stale,true);await denied(save(2,1),'CONFLICT');assert.equal(await stored(),before);await save(2,2);result.cases++;
 await observer.query('select public.save_text_field_draft($1,$2,$3,0,1,$4::jsonb)',[f.ownerB,f.tenantB,f.flowB,JSON.stringify({schemaVersion:1,fields:[]})]);
 const oldV1State=JSON.stringify((await observer.query('select draft_revision,saved_parent_revision,definition from public.text_field_drafts where tenant_id=$1 and flow_id=$2',[f.tenantB,f.flowB])).rows);
 await denied(repo.call('get_field_draft_v3',[f.ownerB,f.tenantB,f.flowB]),'CONFLICT');await denied(repo.call('save_field_draft_v3',[f.ownerB,f.tenantB,f.flowB,0,1,definition]),'CONFLICT');
 assert.equal((await observer.query('select count(*)::integer as n from public.field_drafts_v3 where tenant_id=$1 and flow_id=$2',[f.tenantB,f.flowB])).rows[0].n,0);// Reverse family rejection is checked directly against the unchanged legacy RPC;
 // V1 adapter mapping is outside this V3-only repository scope.
 assert.equal(JSON.stringify((await observer.query('select draft_revision,saved_parent_revision,definition from public.text_field_drafts where tenant_id=$1 and flow_id=$2',[f.tenantB,f.flowB])).rows),oldV1State);
 const familyBefore=await stored();
 await assert.rejects(observer.query('select public.get_text_field_draft($1,$2,$3)',[f.ownerA,f.tenantA,f.flowA]),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='23514');
 await assert.rejects(observer.query('select public.save_text_field_draft($1,$2,$3,0,2,$4::jsonb)',[f.ownerA,f.tenantA,f.flowA,JSON.stringify({schemaVersion:1,fields:[]})]),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='23514');
 assert.equal(await stored(),familyBefore);result.cases++;
 // A separate old V2 flow proves both remaining family directions without conversion.
 const flowV2=randomUUID();
 await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)',[f.ownerB,f.tenantB,flowV2,f.serviceB,'Old V2 parent',JSON.stringify(authoring())]);
 await observer.query('select public.save_field_draft_v2($1,$2,$3,0,1,$4::jsonb)',[f.ownerB,f.tenantB,flowV2,JSON.stringify({schemaVersion:2,fields:[]})]);
 const oldV2State=JSON.stringify((await observer.query('select draft_revision,saved_parent_revision,definition from public.field_drafts_v2 where tenant_id=$1 and flow_id=$2',[f.tenantB,flowV2])).rows);
 await denied(repo.call('get_field_draft_v3',[f.ownerB,f.tenantB,flowV2]),'CONFLICT');
 await denied(repo.call('save_field_draft_v3',[f.ownerB,f.tenantB,flowV2,0,1,definition]),'CONFLICT');
 assert.equal(JSON.stringify((await observer.query('select draft_revision,saved_parent_revision,definition from public.field_drafts_v2 where tenant_id=$1 and flow_id=$2',[f.tenantB,flowV2])).rows),oldV2State);
 assert.equal((await observer.query('select count(*)::integer as n from public.field_drafts_v3 where tenant_id=$1 and flow_id=$2',[f.tenantB,flowV2])).rows[0].n,0);
 for(const rpc of ['get_field_draft_v2','save_field_draft_v2'] as const){
  const sql=rpc==='get_field_draft_v2'?'select public.get_field_draft_v2($1,$2,$3)':'select public.save_field_draft_v2($1,$2,$3,0,2,$4::jsonb)';
  const values=rpc==='get_field_draft_v2'?[f.ownerA,f.tenantA,f.flowA]:[f.ownerA,f.tenantA,f.flowA,JSON.stringify({schemaVersion:2,fields:[]})];
  await assert.rejects(observer.query(sql,values),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='23514');
 }
 assert.equal(await stored(),familyBefore);result.cases++;
 const protectedState=await stored();
 for(const actor of [f.ownerB,f.staff]){await denied(repo.call('get_field_draft_v3',[actor,f.tenantA,f.flowA]),'FORBIDDEN');await denied(repo.call('save_field_draft_v3',[actor,f.tenantA,f.flowA,3,2,definition]),'FORBIDDEN');}
 await denied(repo.call('get_field_draft_v3',[f.ownerB,f.tenantB,f.flowA]),'NOT_AVAILABLE');await denied(repo.call('save_field_draft_v3',[f.ownerB,f.tenantB,f.flowA,0,1,definition]),'NOT_AVAILABLE');assert.equal(await stored(),protectedState);result.cases++;
 await observer.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[f.tenantA,f.ownerA]);await denied(get(),'FORBIDDEN');await denied(save(3,2),'FORBIDDEN');assert.equal(await stored(),protectedState);result.cases++;
 assert.equal(result.cases,7);assert.equal(fault,false);result.status='passed';result.category='COMPLETE';
 }catch{result.status='failed';}
 finally{
  let failed=false;
  if(acquired.size!==0)failed=true;
  if(connected&&observer){try{await observer.query('rollback');}catch{failed=true;}}
  try{await awaitTextDraftConnectionCleanup([...(pool?[pool.end()]:[]),...(observer?[observer.end()]:[])],[...ends.values(),...(observerEnd?[observerEnd]:[])]);result.connectionsClosed=true;}catch{failed=true;}
  if(failed){result.status='failed';result.category='CLEANUP_UNOBSERVED';}else if(fault){result.status='failed';result.category='CONNECTION_FAILED';}
  clearTimeout(watchdog);
 }
 writeSync(1,JSON.stringify(result)+'\n');return result.status==='passed'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const terminal=()=>{writeSync(1,'{"schemaVersion":1,"kind":"FIELD_DRAFT_V3_REPOSITORY","status":"failed","category":"CLEANUP_UNOBSERVED","cases":0,"connectionsClosed":false}\n');process.exit(1);};
 process.on('uncaughtException',terminal);process.on('unhandledRejection',terminal);
 void runFieldDraftV3RepositoryIntegration().then(code=>{process.exitCode=code;},terminal);
}

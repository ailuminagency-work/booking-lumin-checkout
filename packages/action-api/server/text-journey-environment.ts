/** Disposable, synthetic journey composition. The external supervisor proves fresh migration.
 * Importing this module performs no I/O. Returned control methods never become HTTP routes.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { textDraftTestProfile, verifyTextDraftDatabase } from './text-field-drafts-test-profile';
import { observeTextDraftConnectionEnd, awaitTextDraftConnectionCleanup } from './text-field-drafts.integration';
import { createFlowHttpServer } from './http';
import { createFlowRepository } from './repository';
import { createTextFieldDraftRepository } from './text-field-drafts-repository';
const authoring = () => ({authoringVersion:2,config:{key:'journey',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]},questionOverrides:{}});
export function textJourneyConfiguration(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform) {
  if(env.TEXT_JOURNEY_APPROVED!=='1') throw Error('TEXT_JOURNEY_CONFIGURATION');
  try { return textDraftTestProfile(env,'TEXT_DRAFT_HTTP_DATABASE',platform); } catch { throw Error('TEXT_JOURNEY_CONFIGURATION'); }
}
async function bounded<T>(task: Promise<T>, ms: number): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('TEXT_JOURNEY_TIMEOUT')),ms);})]); }
 finally {if(timer)clearTimeout(timer);}
}
export async function createTextJourneyEnvironment(env: NodeJS.ProcessEnv) {
 const profile=textJourneyConfiguration(env);
 const config={...profile.connection,max:2,idleTimeoutMillis:1000,statement_timeout:4000,lock_timeout:3000,idle_in_transaction_session_timeout:6000,query_timeout:6000};
 const pool=new Pool(config),observer=new Client(config), observed=new Map<Client,ReturnType<typeof observeTextDraftConnectionEnd>>();
 const observerEnd=observeTextDraftConnectionEnd(observer),sockets=new Set<Socket>(),inflight=new Set<Promise<unknown>>();
 let server: Server | undefined,connected=false,fault=false,closing: Promise<{serversClosed:true;connectionsClosed:true}> | undefined,closed=false;
 pool.on('connect',client=>observed.set(client,observeTextDraftConnectionEnd(client)));
 pool.on('error',()=>{fault=true;});observer.on('error',()=>{fault=true;});
 function track<T>(start:()=>Promise<T>):Promise<T> { if(closed)return Promise.reject(Error('TEXT_JOURNEY_CLOSED'));const task=Promise.resolve().then(start);inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>undefined);return task; }
 function close():Promise<{serversClosed:true;connectionsClosed:true}> {
  if(closing)return closing;closed=true;
  closing=(async()=>{
   let failed=false;
   if(server){try{await bounded(new Promise<void>((resolve,reject)=>{if(!server!.listening){resolve();return;}server!.close(error=>error?reject(error):resolve());server!.closeAllConnections();}),7000);assert.equal(sockets.size,0);}catch{failed=true;}}
   try{await bounded(Promise.allSettled([...inflight]),10000);assert.equal(inflight.size,0);}catch{failed=true;}
   if(connected){try{await bounded(observer.query('rollback'),7000);}catch{failed=true;}}
   try{await awaitTextDraftConnectionCleanup([pool.end(),observer.end()],[...observed.values(),observerEnd]);}catch{failed=true;}
   if(failed||fault)throw Error('TEXT_JOURNEY_CLEANUP');
   return {serversClosed:true as const,connectionsClosed:true as const};
  })();return closing;
 }
 try {
  await observer.connect();connected=true;await verifyTextDraftDatabase(observer,profile);
    const f = { ownerA: randomUUID(), ownerB: randomUUID(), staff: randomUUID(), tenantA: randomUUID(), tenantB: randomUUID(), serviceA: randomUUID(), serviceB: randomUUID(), flowA: randomUUID(), flowB: randomUUID() };
    await observer.query('begin');
    try {
      for (const actor of [f.ownerA, f.ownerB, f.staff]) await observer.query('insert into auth.users(id,email) values($1,$2)', [actor, 'text-http-' + actor + '@example.test']);
      for (const [tenant, actor, service, flow] of [[f.tenantA, f.ownerA, f.serviceA, f.flowA], [f.tenantB, f.ownerB, f.serviceB, f.flowB]] as const) {
        await observer.query('insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,$4,$5)', [tenant, 'Synthetic HTTP', 'text-http-' + tenant, 'UTC', 'USD']);
        await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [tenant, actor]);
        await observer.query("insert into public.services(id,tenant_id,archetype,name,currency,base_price) values($1,$2,'simple','Synthetic HTTP','USD',0)", [service, tenant]);
        await observer.query("insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values($1,$2,'count','Count','quantity',true,0,1,5,'[]')", [tenant, service]);
        await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)', [actor, tenant, flow, service, 'Synthetic HTTP', JSON.stringify(authoring())]);
      }
      await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_STAFF')", [f.tenantA, f.staff]);
      await observer.query('commit');
    } catch (error) { await observer.query('rollback'); throw error; }
 const ownerAToken='fixture-owner-a-'+randomUUID(),ownerBToken='fixture-owner-b-'+randomUUID(),staffToken='fixture-staff-'+randomUUID();
 const tokens=new Map([[ownerAToken,f.ownerA],[ownerBToken,f.ownerB],[staffToken,f.staff]]);
 const repository=createFlowRepository(pool),textRepository=createTextFieldDraftRepository(pool);
 server=createFlowHttpServer({repository:{call:(name,params)=>track(()=>repository.call(name,params))},textFieldDraftRepository:{call:(name,params)=>track(()=>textRepository.call(name,params))},allowLocalTextPromptWrites:true,authenticateOwner:async token=>tokens.get(token)??null,ownerOrigins:['http://127.0.0.1:4191'],customerOrigins:[]});
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await bounded(new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(0,'127.0.0.1',()=>{server!.removeListener('error',reject);resolve();});}),5000);
 const address=server.address();assert.ok(address&&typeof address==='object');
 return Object.freeze({config:Object.freeze({apiUrl:`http://127.0.0.1:${address.port}`,tenantA:f.tenantA,tenantB:f.tenantB,flowA:f.flowA,flowB:f.flowB,ownerAToken,ownerBToken,staffToken}),
  inspectA:()=>track(async()=>{const result=await observer.query('select definition,draft_revision::integer as revision from public.text_field_drafts where tenant_id=$1 and flow_id=$2',[f.tenantA,f.flowA]);return result.rows[0]??null;}),
  advanceParentA:()=>track(async()=>{await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,1,$5,$6::jsonb)',[f.ownerA,f.tenantA,f.flowA,f.serviceA,'Advanced synthetic',JSON.stringify(authoring())]);return 2 as const;}),
  revokeOwnerA:()=>track(async()=>{await observer.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[f.tenantA,f.ownerA]);}),close});
 } catch {try{await close();}catch{throw Error('TEXT_JOURNEY_CLEANUP');}throw Error('TEXT_JOURNEY_SETUP');}
}

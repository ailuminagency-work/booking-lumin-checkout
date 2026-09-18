/** Synthetic native HTTP proof; inert on import and requires supervisor-created disposable DB. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeSync} from 'node:fs';
import http from 'node:http';
import {channel} from 'node:diagnostics_channel';
import {createFieldDraftV2Client,type FieldDraftV2Client} from '../../flow-ui/src/fieldDraftV2Client';
import type {Socket} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client,Pool} from 'pg';
import {parseFieldDraftReadV2,parseFieldDraftReceiptV2} from '@lumin/workflow';
import {textDraftTestProfile,verifyTextDraftDatabase} from './text-field-drafts-test-profile';
import {observeTextDraftConnectionEnd,awaitTextDraftConnectionCleanup} from './text-field-drafts.integration';
import {createFieldDraftV2Repository} from './field-drafts-v2-repository';
import {handleFieldDraftV2Request} from './field-drafts-v2-http';
import {textDraftTransport} from './text-field-drafts-transport';
export function fieldHttpV2Configuration(env:NodeJS.ProcessEnv,platform:NodeJS.Platform=process.platform){assert.equal(env.FIELD_DRAFT_V2_HTTP_APPROVED,'1');return {...textDraftTestProfile(env,'TEXT_DRAFT_HTTP_DATABASE',platform).connection,max:2,idleTimeoutMillis:1000,statement_timeout:4000,lock_timeout:3000,idle_in_transaction_session_timeout:6000,query_timeout:6000};}
const authoring=()=>({authoringVersion:2,config:{key:'httpv2',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]},questionOverrides:{}});
const definition=()=>({schemaVersion:2,fields:[{key:'note',kind:'textarea',required:false,minLength:0,maxLength:4096,prompt:' Exact question '}]});
async function bounded<T>(p:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([p,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BOUND')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
/** Native Node transport with a synthetic trusted Origin; not browser CORS proof.
 * This wrapper adds that one header only and delegates to global native fetch.
 */
export function createFieldClientFixtureFetch(base:string,onAttempt:()=>void):typeof fetch {
 const origin=new URL(base);assert.equal(origin.origin,base);assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');
 return (input,init)=>{assert.equal(typeof input,'string');assert.equal(new URL(input as string).origin,base);onAttempt();const headers=new Headers(init?.headers);headers.set('Origin','http://127.0.0.1:4193');return fetch(input,{...init,headers});};
}
export async function runFieldDraftV2HttpIntegration(){
 const result={schemaVersion:1,kind:'FIELD_DRAFT_V2_HTTP',status:'failed',category:'CONFIGURATION_FAILED',cases:0,httpRequests:0,clientCases:0,clientRequests:0,serverClosed:false,connectionsClosed:false};
 let pool:Pool|undefined,observer:Client|undefined,observerConnected=false,observerEnd:ReturnType<typeof observeTextDraftConnectionEnd>|undefined,fault=false;
 const pgEnds=new Map<Client,ReturnType<typeof observeTextDraftConnectionEnd>>(),servers:http.Server[]=[],sockets=new Set<Socket>(),clientSockets=new Set<Socket>(),tasks=new Set<Promise<unknown>>();
 const clients:FieldDraftV2Client[]=[],fetchSockets=new Set<Socket>();let fetchPort=0,fetchConnectionsObserved=0;
 const connectedChannel=channel('undici:client:connected');
 const connectedListener=(message:unknown)=>{const socket=(message as {socket?:Socket})?.socket;if(socket?.remoteAddress==='127.0.0.1'&&socket.remotePort===fetchPort){fetchConnectionsObserved++;fetchSockets.add(socket);socket.once('close',()=>fetchSockets.delete(socket));}};
 connectedChannel.subscribe(connectedListener);
 const agent=new http.Agent({keepAlive:false,maxSockets:2});
 const watchdog=setTimeout(()=>{writeSync(1,JSON.stringify({...result,status:'failed',category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);},75000);
 try{
  const config=fieldHttpV2Configuration(process.env);pool=new Pool(config);pool.on('error',()=>{fault=true;});pool.on('connect',client=>pgEnds.set(client,observeTextDraftConnectionEnd(client)));
  observer=new Client(config);observer.on('error',()=>{fault=true;});observerEnd=observeTextDraftConnectionEnd(observer);result.category='CONNECTION_FAILED';await observer.connect();observerConnected=true;await verifyTextDraftDatabase(observer,textDraftTestProfile(process.env,'TEXT_DRAFT_HTTP_DATABASE'));result.category='FIXTURE_FAILED';
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

 const repo=createFieldDraftV2Repository(pool),tokenA='synthetic-owner-a-'+randomUUID(),tokenB='synthetic-owner-b-'+randomUUID(),staffToken='synthetic-staff-'+randomUUID();
 const abortToken='synthetic-abort-'+randomUUID();let releaseAuth!:()=>void,authStarted!:()=>void;
 const authSeen=new Promise<void>(resolve=>{authStarted=resolve;}),authWait=new Promise<void>(resolve=>{releaseAuth=resolve;});
 const clientAbortToken='synthetic-client-abort-'+randomUUID();let clientAuthStarted!:()=>void,releaseClientAuth!:()=>void,clientDisconnected!:()=>void;
 const clientAuthSeen=new Promise<void>(resolve=>{clientAuthStarted=resolve;}),clientAuthWait=new Promise<void>(resolve=>{releaseClientAuth=resolve;}),clientDisconnectSeen=new Promise<void>(resolve=>{clientDisconnected=resolve;});
 const identities=new Map([[tokenA,f.ownerA],[tokenB,f.ownerB],[staffToken,f.staff]]);let authCalls=0,rpcCalls=0;
 async function start(enabled:boolean){
  const server=http.createServer((req,res)=>{
   const transport=textDraftTransport(req,res);
   if(req.headers.origin!=='http://127.0.0.1:4193'){transport.send(403,{ok:false,code:'FORBIDDEN'});return;}
   const task=handleFieldDraftV2Request(req,{allowLocalFieldDraftV2:enabled,authenticateOwner:credential=>transport.authenticate(credential,async value=>{authCalls++;if(value===clientAbortToken){res.once('close',()=>clientDisconnected());clientAuthStarted();await clientAuthWait;return f.ownerB;}if(value===abortToken){authStarted();await authWait;return f.ownerA;}return identities.get(value)??null;}),call:(name,args)=>{rpcCalls++;return repo.call(name,args);}}).then(out=>transport.send(out.status,out.body));
   tasks.add(task);void task.finally(()=>tasks.delete(task)).catch(()=>{fault=true;res.destroy();});
  });
  server.requestTimeout=12000;server.headersTimeout=10000;server.on('error',()=>{fault=true;});servers.push(server);server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await bounded(new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});}),5000);
  const address=server.address();assert.ok(address&&typeof address==='object');return address.port;
 }
 async function request(port:number,method:string,route:string,token=tokenA,payload?:unknown,extra:Record<string,string>={}){
  result.httpRequests++;const bytes=Buffer.isBuffer(payload)?payload:payload===undefined?undefined:Buffer.from(JSON.stringify(payload));
  return await bounded(new Promise<{status:number;body:any}>((resolve,reject)=>{
   const req=http.request({host:'127.0.0.1',port,path:route,method,agent,headers:{origin:'http://127.0.0.1:4193',authorization:'Bearer '+token,...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{}),...extra}},res=>{
    let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32768){req.destroy();reject(Error('RESPONSE_BOUND'));}else chunks.push(chunk);});res.once('error',reject);res.once('aborted',()=>reject(Error('RESPONSE_ABORT')));res.once('end',()=>{try{resolve({status:res.statusCode??0,body:size===0&&res.statusCode===400?{}:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Error('RESPONSE_INVALID'));}});
   });req.on('socket',socket=>{clientSockets.add(socket);socket.once('close',()=>clientSockets.delete(socket));});req.once('error',reject);req.setTimeout(5000,()=>req.destroy(Error('REQUEST_TIMEOUT')));if(bytes)req.write(bytes);req.end();
  }),6000);
 }
 const port=await start(true),disabled=await start(false),route=(flow=f.flowA,tenant=f.tenantA)=>`/api/field-drafts-v2/${flow}?tenantId=${tenant}`;
 const save=(revision:number,parent=1)=>({fieldDraftVersion:2,parentAuthoringVersion:2,expectedRevision:revision,expectedFlowRevision:parent,definition:definition()});
 const stored=async()=>JSON.stringify((await observer!.query('select draft_revision,saved_parent_revision,definition from public.field_drafts_v2 where tenant_id=$1 and flow_id=$2',[f.tenantA,f.flowA])).rows);
 result.category='CASE_FAILED';
 assert.equal((await request(disabled,'GET',route())).status,404);assert.equal((await request(disabled,'POST',route(),tokenA,save(0))).status,404);assert.equal(authCalls,0);assert.equal(rpcCalls,0);result.cases++;
 const missing=await request(port,'GET',route());assert.equal(missing.status,200);assert.equal(parseFieldDraftReadV2(missing.body.data).status,'missing');
 const created=await request(port,'POST',route(),tokenA,save(0));assert.equal(created.status,200);assert.equal(parseFieldDraftReceiptV2(created.body.data).draftRevision,1);
 assert.deepEqual((await request(port,'GET',route())).body.data,{status:'present',receipt:created.body.data});assert.equal((await request(port,'POST',route(),tokenA,save(1))).status,200);result.cases++;
 const before=await stored(),calls=rpcCalls;
 for(const payload of [Buffer.from([255]),Buffer.alloc(32769,32),{...save(2),actorId:f.ownerB},{...save(2),fieldDraftVersion:1}])assert.equal((await request(port,'POST',route(),tokenA,payload)).status,400);
 assert.equal((await request(port,'GET',`/api/field-drafts-v2/junk/../${f.flowA}?tenantId=${f.tenantA}`)).status,404);
 assert.equal((await request(port,'POST',route(),tokenA,save(2),{'content-type':'text/plain'})).status,400);assert.equal((await request(port,'POST',route(),tokenA,save(2),{'transfer-encoding':'chunked'})).status,400);assert.equal(rpcCalls,calls);
 // Abort a genuine socket while the synthetic resolver is waiting; release it
 // afterward to prove the accepted transport prevents late authenticated dispatch.
 result.httpRequests++;
 const aborted=http.request({host:'127.0.0.1',port,path:route(),method:'GET',agent,headers:{origin:'http://127.0.0.1:4193',authorization:'Bearer '+abortToken}});
 aborted.on('error',()=>{});aborted.on('socket',socket=>{clientSockets.add(socket);socket.once('close',()=>clientSockets.delete(socket));});
 const abortClosed=new Promise<void>(resolve=>aborted.once('close',()=>resolve()));aborted.end();await bounded(authSeen,3000);aborted.destroy();await bounded(abortClosed,3000);releaseAuth();
 await bounded(Promise.allSettled([...tasks]),6000);assert.equal(rpcCalls,calls);assert.equal(await stored(),before);result.cases++;
 for(const token of [tokenB,staffToken]){assert.equal((await request(port,'GET',route(),token)).status,403);assert.equal((await request(port,'POST',route(),token,save(2))).status,403);}
 assert.equal((await request(port,'GET',route(f.flowA,f.tenantB),tokenB)).status,404);assert.equal(await stored(),before);result.cases++;
 assert.equal((await request(port,'POST',route(),tokenA,save(0))).status,409);assert.equal((await request(port,'POST',route(),tokenA,save(1))).status,409);
 await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,1,$5,$6::jsonb)',[f.ownerA,f.tenantA,f.flowA,f.serviceA,'Parent updated',JSON.stringify(authoring())]);
 const stale=parseFieldDraftReadV2((await request(port,'GET',route())).body.data);assert.equal(stale.status,'present');if(stale.status==='present')assert.equal(stale.receipt.stale,true);assert.equal((await request(port,'POST',route(),tokenA,save(2))).status,409);assert.equal(await stored(),before);result.cases++;
 await observer.query('select public.save_text_field_draft($1,$2,$3,0,1,$4::jsonb)',[f.ownerB,f.tenantB,f.flowB,JSON.stringify({schemaVersion:1,fields:[]})]);
 assert.equal((await request(port,'GET',route(f.flowB,f.tenantB),tokenB)).status,409);assert.equal((await request(port,'POST',route(f.flowB,f.tenantB),tokenB,save(0))).status,409);result.cases++;
 await observer.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[f.tenantA,f.ownerA]);assert.equal((await request(port,'GET',route())).status,403);assert.equal((await request(port,'POST',route(),tokenA,save(2,2))).status,403);assert.equal(await stored(),before);result.cases++;
 assert.equal(result.cases,7);assert.equal(result.httpRequests,27);
 // Second phase uses the actual typed client and Node native fetch. The wrapper
 // adds only the fixture's trusted Origin header and counts issued attempts.
 await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_STAFF')",[f.tenantB,f.staff]);
 const flowC=randomUUID();await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)',[f.ownerB,f.tenantB,flowC,f.serviceB,'Typed client parent',JSON.stringify(authoring())]);
 const base=`http://127.0.0.1:${port}`;fetchPort=port;
 const fixtureFetch=createFieldClientFixtureFetch(base,()=>{result.clientRequests++;});
 const off=createFieldDraftV2Client(base,true,fixtureFetch);clients.push(off);
 const denial=async(promise:Promise<unknown>,code:string)=>assert.rejects(promise,(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===code);
 await denial(off.read(tokenB,f.tenantB,flowC),'NOT_AVAILABLE');await denial(off.save(tokenB,f.tenantB,flowC,save(0)),'NOT_AVAILABLE');assert.equal(result.clientRequests,0);result.clientCases++;
 const typed=createFieldDraftV2Client(base,true,fixtureFetch,true);clients.push(typed);
 assert.equal((await typed.read(tokenB,f.tenantB,flowC)).status,'missing');const first=await typed.save(tokenB,f.tenantB,flowC,save(0));assert.equal(first.draftRevision,1);assert.deepEqual(first.definition,definition());assert.deepEqual(await typed.read(tokenB,f.tenantB,flowC),{status:'present',receipt:first});assert.equal((await typed.save(tokenB,f.tenantB,flowC,save(1))).draftRevision,2);result.clientCases++;
 const clientStored=async()=>JSON.stringify((await observer!.query('select draft_revision,saved_parent_revision,definition from public.field_drafts_v2 where tenant_id=$1 and flow_id=$2',[f.tenantB,flowC])).rows);
 const beforeClient=await clientStored();await denial(typed.save(tokenB,f.tenantB,flowC,save(1)),'CONFLICT');assert.equal(await clientStored(),beforeClient);
 await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,1,$5,$6::jsonb)',[f.ownerB,f.tenantB,flowC,f.serviceB,'Changed typed parent',JSON.stringify(authoring())]);
 const clientStale=await typed.read(tokenB,f.tenantB,flowC);assert.equal(clientStale.status,'present');if(clientStale.status==='present')assert.equal(clientStale.receipt.stale,true);
 await denial(typed.save(tokenB,f.tenantB,flowC,save(2)),'CONFLICT');assert.equal(await clientStored(),beforeClient);await typed.save(tokenB,f.tenantB,flowC,save(2,2));const protectedClient=await clientStored();
 await denial(typed.read(staffToken,f.tenantB,flowC),'FORBIDDEN');assert.equal(await clientStored(),protectedClient);await denial(typed.save(staffToken,f.tenantB,flowC,save(3,2)),'FORBIDDEN');assert.equal(await clientStored(),protectedClient);await denial(typed.read(tokenB,f.tenantA,flowC),'FORBIDDEN');assert.equal(await clientStored(),protectedClient);result.clientCases++;
 const callsBefore=rpcCalls;const pending=typed.read(clientAbortToken,f.tenantB,flowC);const rejected=denial(pending,'UNAUTHENTICATED');await bounded(clientAuthSeen,3000);typed.invalidate();await bounded(rejected,3000);await bounded(clientDisconnectSeen,3000);releaseClientAuth();await bounded(Promise.allSettled([...tasks]),6000);assert.equal(rpcCalls,callsBefore);assert.equal(await clientStored(),protectedClient);
 const next=await typed.read(tokenB,f.tenantB,flowC);assert.equal(next.status,'present');if(next.status==='present')assert.equal(next.receipt.draftRevision,3);assert.equal(await clientStored(),protectedClient);result.clientCases++;
 assert.ok(fetchConnectionsObserved>0);assert.equal(result.clientCases,4);assert.equal(result.clientRequests,13);assert.equal(fault,false);result.status='passed';result.category='COMPLETE';
 }catch{result.status='failed';}
 finally{
  let failed=false;for(const client of clients)client.invalidate();agent.destroy();for(const socket of fetchSockets)socket.destroy();for(const socket of clientSockets)socket.destroy();
  try{await bounded(Promise.all(servers.map(server=>new Promise<void>((resolve,reject)=>{if(!server.listening){resolve();return;}server.close(error=>error?reject(error):resolve());server.closeAllConnections();}))),7000);await bounded(Promise.allSettled([...tasks]),10000);assert.equal(tasks.size,0);await bounded((async()=>{while(sockets.size||clientSockets.size||fetchSockets.size)await new Promise(resolve=>setTimeout(resolve,10));})(),3000);assert.equal(sockets.size,0);assert.equal(clientSockets.size,0);assert.equal(fetchSockets.size,0);result.serverClosed=true;}catch{failed=true;}
  if(observerConnected&&observer){try{await observer.query('rollback');}catch{failed=true;}}
  try{await awaitTextDraftConnectionCleanup([...(pool?[pool.end()]:[]),...(observer?[observer.end()]:[])],[...pgEnds.values(),...(observerEnd?[observerEnd]:[])]);result.connectionsClosed=true;}catch{failed=true;}
  if(failed){result.status='failed';result.category='CLEANUP_UNOBSERVED';}else if(fault){result.status='failed';result.category='CONNECTION_FAILED';}connectedChannel.unsubscribe(connectedListener);clearTimeout(watchdog);
 }
 writeSync(1,JSON.stringify(result)+'\n');return result.status==='passed'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const terminal=()=>{writeSync(1,'{"schemaVersion":1,"kind":"FIELD_DRAFT_V2_HTTP","status":"failed","category":"CLEANUP_UNOBSERVED","cases":0,"httpRequests":0,"clientCases":0,"clientRequests":0,"serverClosed":false,"connectionsClosed":false}\n');process.exit(1);};process.on('uncaughtException',terminal);process.on('unhandledRejection',terminal);void runFieldDraftV2HttpIntegration().then(code=>{process.exitCode=code;},terminal);
}

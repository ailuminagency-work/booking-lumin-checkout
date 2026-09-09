/** Mandatory local/CI PG HTTP acceptance: missing configuration is a failure, never a skip. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {Server} from "node:http";
import {localPool,seedLocalFixtures,LOCAL_FIXTURE as F,localIdentity} from "./fixtures";
import {createFlowRepository} from "./repository";
import {createFlowHttpServer} from "./http";
let pool=localPool();let server:Server|undefined;let base="";
async function start(){server=createFlowHttpServer({repository:createFlowRepository(pool),authenticateOwner:localIdentity,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin]});await new Promise<void>(r=>server!.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function stop(){if(server){const s=server;server=undefined;s.closeAllConnections();await new Promise<void>((r,j)=>s.close(e=>e?j(e):r()));}await pool.end();}
async function owner(path:string,body?:unknown,token=F.ownerToken){const response=await fetch(base+path,{method:body===undefined?"GET":"POST",headers:{Origin:F.ownerOrigin,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json() as object} as any;}
async function customer(path:string,body:unknown,token?:string,origin=F.customerOrigin){const response=await fetch(base+path,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:response.status,...await response.json() as object} as any;}
try{
 await seedLocalFixtures(pool);await start();
 const services=await owner(`/api/services?tenantId=${F.tenantA}`);assert.equal(services.status,200);assert.equal(services.data.services.length,2);
 assert.equal((await owner(`/api/services?tenantId=${F.tenantB}`)).status,403);
 assert.equal((await owner(`/api/services?tenantId=${F.tenantA}`,undefined,F.platformToken)).status,403);
 const flow=randomUUID();const config={key:"local-request",steps:[{key:"quantity",questionKey:"quantity",kind:"question",required:true},{key:"options",questionKey:"options",kind:"question",required:true}]};
 const draftPath=`/api/flows/${flow}/draft?tenantId=${F.tenantA}`;
 const draft={expectedRevision:0,serviceId:F.serviceA,name:"HTTP durable fixture",config};
 assert.equal((await owner(draftPath,draft,F.staffToken)).status,403);
 assert.equal((await owner(draftPath,{...draft,serviceId:F.serviceB})).status,404);
 const saved=await owner(draftPath,draft);assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
 await stop();pool=localPool();await start();
 const restored=await owner(draftPath);assert.equal(restored.status,200);assert.deepEqual(restored.data.config,config);
 assert.equal((await owner(draftPath,{...draft,expectedRevision:1})).data.revision,2);
 assert.equal((await owner(draftPath,{...draft,expectedRevision:1})).status,409);
 const published=await owner(`/api/flows/${flow}/publish?tenantId=${F.tenantA}`,{expectedRevision:2,allowedOrigins:[F.customerOrigin]});assert.equal(published.status,200);
 const installation=published.data.installationId;
 assert.equal((await customer(`/api/installations/${installation}/sessions`,{},undefined,"https://evil.example")).status,403);
 const session=await customer(`/api/installations/${installation}/sessions`,{});assert.equal(session.status,200);assert.equal(session.data.render.versionId,published.data.versionId);
 assert.equal(session.data.render.service.id,F.serviceA);assert.deepEqual(session.data.render.config,config);
 const originalPrompt=session.data.render.service.questions.find((q:any)=>q.id==="options").prompt;
 await pool.query("update public.service_questions set prompt=$1 where tenant_id=$2 and service_id=$3 and question_key='options'",["Changed fixture prompt",F.tenantA,F.serviceA]);
 const reordered={...config,steps:[...config.steps].reverse()};
 assert.equal((await owner(draftPath,{...draft,expectedRevision:2,config:reordered})).data.revision,3);
 const nextVersion=await owner(`/api/flows/${flow}/publish?tenantId=${F.tenantA}`,{expectedRevision:3,allowedOrigins:[F.customerOrigin]});assert.equal(nextVersion.status,200);assert.notEqual(nextVersion.data.versionId,published.data.versionId);
 const oldInstallAgain=await customer(`/api/installations/${installation}/sessions`,{});assert.equal(oldInstallAgain.status,200);assert.equal(oldInstallAgain.data.render.versionId,published.data.versionId);assert.deepEqual(oldInstallAgain.data.render.config,config);assert.equal(oldInstallAgain.data.render.service.questions.find((q:any)=>q.id==="options").prompt,originalPrompt);
 await pool.query("update public.service_questions set prompt=$1 where tenant_id=$2 and service_id=$3 and question_key='options'",[originalPrompt,F.tenantA,F.serviceA]);
 const payload={idempotencyKey:`http-fixture-${randomUUID()}`,answers:{quantity:{quantity:2},options:{choiceIds:["standard"]}},customer:{name:"Synthetic customer",email:"synthetic@example.test"},requestedStart:new Date(Date.now()+86400000).toISOString()};
 const denied=await customer("/api/flow-sessions/request",{...payload,state:"confirmed"},session.data.sessionToken);assert.equal(denied.status,400);
 const responses=await Promise.all([customer("/api/flow-sessions/request",payload,session.data.sessionToken),customer("/api/flow-sessions/request",payload,session.data.sessionToken)]);
 for(const r of responses){assert.equal(r.status,200);assert.equal(r.data.state,"draft");assert.equal(r.data.confirmed,false);}assert.equal(responses[0].data.reference,responses[1].data.reference);
 assert.equal((await customer("/api/flow-sessions/request",{...payload,customer:{...payload.customer,name:"Changed"}},session.data.sessionToken)).status,409);
 await stop();pool=localPool();await start();
 const retried=await customer("/api/flow-sessions/request",payload,session.data.sessionToken);assert.equal(retried.status,200);assert.equal(retried.data.reference,responses[0].data.reference);
 const reference=responses[0].data.reference;const requests=await owner(`/api/requests?tenantId=${F.tenantA}`);assert.equal(requests.status,200);assert.ok(requests.data.requests.some((r:any)=>r.reference===reference));
 const proof=await pool.query("select b.state,b.pricing,b.payment_id,(select count(*)::int from public.payments p where p.booking_id=b.id) as payments,(select count(*)::int from public.capacity_holds h where h.booking_id=b.id) as holds,(select count(*)::int from public.durable_outbox o where o.booking_id=b.id and o.event_type='booking.requested') as events from public.bookings b where b.reference=$1",[reference]);assert.equal(proof.rows.length,1);assert.equal(proof.rows[0].state,"draft");assert.equal(proof.rows[0].events,1);assert.deepEqual(proof.rows[0].pricing,{});assert.equal(proof.rows[0].payment_id,null);assert.equal(proof.rows[0].payments,0);assert.equal(proof.rows[0].holds,0);
 const provenance=await pool.query("select s.tenant_id,s.flow_id,s.version_id,s.installation_id,s.service_id from public.flow_requests r join public.flow_sessions s on s.id=r.session_id join public.bookings b on b.id=r.booking_id where b.reference=$1",[reference]);assert.equal(provenance.rows.length,1);assert.deepEqual(provenance.rows[0],{tenant_id:F.tenantA,flow_id:flow,version_id:published.data.versionId,installation_id:installation,service_id:F.serviceA});
 // A second generic preset follows identical DTOs and renderer semantics.
 const flow2=randomUUID();const second=await owner(`/api/flows/${flow2}/draft?tenantId=${F.tenantA}`,{...draft,serviceId:F.serviceA2});assert.equal(second.status,200);
 const pub2=await owner(`/api/flows/${flow2}/publish?tenantId=${F.tenantA}`,{expectedRevision:1,allowedOrigins:[F.customerOrigin]});assert.equal(pub2.status,200);
 const session2=await customer(`/api/installations/${pub2.data.installationId}/sessions`,{});assert.equal(session2.status,200);assert.equal(session2.data.render.service.questions.find((q:any)=>q.id==="options").kind,"multi_choice");
 const r2=await customer("/api/flow-sessions/request",{...payload,idempotencyKey:`http-fixture-${randomUUID()}`,answers:{quantity:{quantity:3},options:{choiceIds:["standard","extra"]}}},session2.data.sessionToken);assert.equal(r2.status,200);
 console.log("PASS: real local PG HTTP two-preset journey, restart durability, ownership/CAS, pinned sessions, concurrent idempotent draft plus one outbox event; not browser HTTPS or real Auth certification");
}finally{await stop();}

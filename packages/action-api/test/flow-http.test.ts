import {afterEach,expect,it,vi} from "vitest";
import type {Server} from "node:http";
import {createFlowHttpServer} from "../server/http";
import {LOCAL_FIXTURE as F,localIdentity} from "../server/fixtures";
import {createFlowRepository,FlowError} from "../server/repository";
const servers:Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0))await new Promise<void>((resolve,reject)=>{s.closeAllConnections();s.close(e=>e?reject(e):resolve());});});
async function start(call=vi.fn(async()=>({services:[]})),auth:typeof localIdentity|undefined=localIdentity){const server=createFlowHttpServer({repository:{call},authenticateOwner:auth,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin]});servers.push(server);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();if(!address||typeof address==="string")throw Error();return {base:`http://127.0.0.1:${address.port}`,call};}
const ownerHeaders={Origin:F.ownerOrigin,Authorization:`Bearer ${F.ownerToken}`,"Content-Type":"application/json"};
it("serves only verified owner identity to fixed RPC and rejects body/header actor tricks",async()=>{
 const h=await start();const response=await fetch(`${h.base}/api/services?tenantId=${F.tenantA}`,{headers:ownerHeaders});expect(response.status).toBe(200);expect(h.call).toHaveBeenCalledWith("flow_owner_services",[F.ownerA,F.tenantA]);
 expect((await fetch(`${h.base}/api/services?tenantId=${F.tenantA}&actor=${F.ownerB}`,{headers:ownerHeaders})).status).toBe(400);
 expect((await fetch(`${h.base}/api/services?tenantId=${F.tenantA}`,{headers:{...ownerHeaders,Authorization:"Bearer invalid-owner-token"}})).status).toBe(401);
 expect((await fetch(`${h.base}/api/services?tenantId=${F.tenantA}`,{headers:{...ownerHeaders,Origin:"https://evil.example"}})).status).toBe(403);
});
it("requires exact approved origin for preflight and actual customer request",async()=>{
 const h=await start();const path=`${h.base}/api/installations/${F.serviceA}/sessions`;
 const good=await fetch(path,{method:"OPTIONS",headers:{Origin:F.customerOrigin,"Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"authorization, content-type"}});expect(good.status).toBe(204);expect(good.headers.get("access-control-allow-origin")).toBe(F.customerOrigin);
 expect((await fetch(path,{method:"OPTIONS",headers:{Origin:"http://booking.local.test","Access-Control-Request-Method":"POST"}})).status).toBe(403);expect(h.call).not.toHaveBeenCalled();
});
it("keeps owner and session credential formats separate and redacts database errors",async()=>{
 const h=await start(vi.fn(async()=>{throw new FlowError("FORBIDDEN");}));
 const response=await fetch(`${h.base}/api/services?tenantId=${F.tenantA}`,{headers:ownerHeaders});expect(await response.json()).toEqual({ok:false,code:"FORBIDDEN"});
 const bad=await fetch(`${h.base}/api/flow-sessions/request`,{method:"POST",headers:{...ownerHeaders,Origin:F.customerOrigin},body:"{}"});expect(bad.status).toBe(401);
});
it("rejects excessive HTTP bodies without dispatch and refuses forged pricing",async()=>{
 const h=await start();const path=`${h.base}/api/flows/${F.serviceA}/draft?tenantId=${F.tenantA}`;
 expect((await fetch(path,{method:"POST",headers:ownerHeaders,body:JSON.stringify({padding:"x".repeat(33000)})})).status).toBe(400);expect(h.call).not.toHaveBeenCalled();
 expect((await fetch(path,{method:"POST",headers:ownerHeaders,body:JSON.stringify({expectedRevision:0,serviceId:F.serviceA,name:"x",config:{key:"x",steps:[{key:"q",questionKey:"q",kind:"question",required:true,price:1}]}})})).status).toBe(400);
});
it("rejects unsafe successful repository projection",async()=>{
 const h=await start(vi.fn(async()=>({services:[],credentials:"secret"})));const r=await fetch(`${h.base}/api/services?tenantId=${F.tenantA}`,{headers:ownerHeaders});expect(await r.json()).toEqual({ok:false,code:"INTERNAL_ERROR"});
});
it("repository uses parameterized fixed RPC, scoped role and rollback/release on failure",async()=>{
 const query=vi.fn(async(sql:string)=>{if(sql.startsWith("select public."))throw Object.assign(Error("secret SQL"),{code:"42501"});return {rows:[]};});const release=vi.fn();const pool={connect:async()=>({query,release})};const repo=createFlowRepository(pool as never);
 await expect(repo.call("flow_owner_services",[F.ownerA,F.tenantA])).rejects.toMatchObject({code:"FORBIDDEN"});
 expect(query).toHaveBeenCalledWith("set local role service_role");expect(query).toHaveBeenCalledWith("select public.flow_owner_services($1::uuid,$2::uuid) as result",[F.ownerA,F.tenantA]);expect(query).toHaveBeenCalledWith("rollback");expect(release).toHaveBeenCalledTimes(1);
});
it("unconfigured auth fails closed even with synthetic-looking credentials",async()=>{
 const server=createFlowHttpServer({repository:{call:async()=>{throw Error("must not call");}},ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin]});servers.push(server);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const a=server.address() as {port:number};expect((await fetch(`http://127.0.0.1:${a.port}/api/services?tenantId=${F.tenantA}`,{headers:ownerHeaders})).status).toBe(401);
});

it("rejects prototype-shaped answer identifiers rather than dropping them",async()=>{
 const h=await start();const body='{"idempotencyKey":"synthetic-request-key","answers":{"__proto__":{"quantity":1}},"customer":{"name":"Test","email":"test@example.test"},"requestedStart":"2030-01-01T00:00:00Z"}';
 const response=await fetch(`${h.base}/api/flow-sessions/request`,{method:"POST",headers:{Origin:F.customerOrigin,Authorization:`Bearer ${"a".repeat(43)}`,"Content-Type":"application/json"},body});expect(response.status).toBe(400);expect(h.call).not.toHaveBeenCalled();
});

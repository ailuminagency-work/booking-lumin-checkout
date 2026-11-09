import { afterEach,describe,expect,it } from "vitest";
import { createServer,type Server } from "node:http";
import { createFlowHttpServer } from "./http.js";
import type { AvailabilityReader,FlowRepository } from "./repository.js";

const origin="https://portal.staging.example.test";
const actor="a3100000-0000-4000-8000-000000000001";
const tenant="a3100000-0000-4000-8000-000000000002";
const foreign="b3100000-0000-4000-8000-000000000002";
const service="a3100000-0000-4000-8000-000000000003";

describe("authenticated availability endpoint",()=>{
 let server:Server|undefined;
 afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});
 it("returns server-computed slots for the authorized tenant",async()=>{
  const availability:AvailabilityReader=async(a,t,s)=>a===actor&&t===tenant&&s===service?{serviceId:service,durationMinutes:60,slots:[{start:"2026-01-05T16:00:00.000Z",end:"2026-01-05T17:00:00.000Z",remainingCapacity:1}]}:null;
  const http=createFlowHttpServer({repository:{call:async()=>{throw Error("unexpected");}} as FlowRepository,ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async token=>token==="owner-token-123456"?actor:null,availability});
  server=createServer((req,res)=>http.emit("request",req,res));await new Promise<void>(r=>server!.listen(0,"127.0.0.1",()=>r()));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const response=await fetch(`${base}/api/availability?tenantId=${tenant}&serviceId=${service}&from=2026-01-05T00:00:00.000Z&to=2026-01-06T00:00:00.000Z`,{headers:{authorization:"Bearer owner-token-123456",origin}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,data:{schemaVersion:1,serviceId:service,durationMinutes:60,slots:[{start:"2026-01-05T16:00:00.000Z",end:"2026-01-05T17:00:00.000Z",remainingCapacity:1}]}});
 });
 it("does not disclose slots for a foreign tenant",async()=>{
  const http=createFlowHttpServer({repository:{call:async()=>{throw Error("unexpected");}} as FlowRepository,ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async()=>actor,availability:async()=>null});
  server=createServer((req,res)=>http.emit("request",req,res));await new Promise<void>(r=>server!.listen(0,"127.0.0.1",()=>r()));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const response=await fetch(`${base}/api/availability?tenantId=${foreign}&serviceId=${service}&from=2026-01-05T00:00:00.000Z&to=2026-01-06T00:00:00.000Z`,{headers:{authorization:"Bearer owner-token-123456",origin}});
  expect(response.status).toBe(404);expect(await response.json()).toEqual({ok:false,code:"NOT_AVAILABLE"});
 });
});

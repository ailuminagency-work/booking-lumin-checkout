import { describe,expect,it } from "vitest";
import { createAvailabilityReader } from "./repository.js";

const actor="a3100000-0000-4000-8000-000000000001";
const tenant="a3100000-0000-4000-8000-000000000002";
const service="a3100000-0000-4000-8000-000000000003";

describe("availability reader capacity inputs",()=>{
 it("includes active holds and scopes booking consumers by service",async()=>{
  const sql:string[]=[];
  const client={query:async<T=unknown>(statement:string|{text:string},params?:unknown[])=>{
   const text=typeof statement==="string"?statement:statement.text;sql.push(text);
   if(text.startsWith("select t.timezone"))return {rows:[{timezone:"UTC",duration_minutes:60}]} as {rows:T[]};
   if(text.includes("from public.availability_rules"))return {rows:[{id:"a3100000-0000-4000-8000-000000000010",tenantId:tenant,serviceId:null,weekday:1,startMinute:0,endMinute:1440,capacity:1}]} as {rows:T[]};
   if(text.includes("from public.availability_overrides"))return {rows:[]} as {rows:T[]};
   if(text.includes("from public.scheduling_policies"))return {rows:[{leadTimeMinutes:0,horizonDays:60,slotIntervalMinutes:60}]} as {rows:T[]};
   if(text.includes("from public.capacity_holds"))return {rows:[{start:"2026-01-05T16:00:00.000Z",end:"2026-01-05T17:00:00.000Z"}]} as {rows:T[]};
   return {rows:[]} as {rows:T[]};
  },release:()=>{}};
  const pool={connect:async()=>client} as never;
  const reader=createAvailabilityReader(pool,()=>"2026-01-04T00:00:00.000Z");
  const result=await reader(actor,tenant,service,"2026-01-05T00:00:00.000Z","2026-01-06T00:00:00.000Z");
  expect(result?.slots.some(slot=>slot.start==="2026-01-05T16:00:00.000Z")).toBe(false);
  const consumerSql=sql.find(statement=>statement.includes("from public.capacity_holds"));
  expect(consumerSql).toContain("service_id=$4::uuid");
  expect(consumerSql).toContain("(selection ->> 'serviceId')::uuid=$4::uuid");
 });
});

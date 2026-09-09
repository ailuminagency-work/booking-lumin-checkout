import { Pool } from "pg";
import { randomUUID } from "node:crypto";
export const LOCAL_FIXTURE={
 tenantA:"a3100000-0000-4000-8000-000000000001",tenantB:"b3100000-0000-4000-8000-000000000001",
 ownerA:"a3100000-0000-4000-8000-000000000002",staffA:"a3100000-0000-4000-8000-000000000003",ownerB:"b3100000-0000-4000-8000-000000000002",
 serviceA:"a3100000-0000-4000-8000-000000000004",serviceA2:"a3100000-0000-4000-8000-000000000005",serviceB:"b3100000-0000-4000-8000-000000000004",
 platformUser:"c3100000-0000-4000-8000-000000000002",platformToken:"local-platform-synthetic-token",ownerToken:"local-owner-a-synthetic-token",staffToken:"local-staff-a-synthetic-token",otherOwnerToken:"local-owner-b-synthetic-token",
 ownerOrigin:"http://127.0.0.1:5174",customerOrigin:"https://booking.local.test",
};
export function localPool(){
 if(process.env.LOCAL_HARNESS!=="1"||process.env.FLOW_TEST_DISPOSABLE!=="1"||!["127.0.0.1","localhost"].includes(process.env.PGHOST??"")||!/^lumin_[a-z0-9_]+$/.test(process.env.PGDATABASE??""))throw Error("Explicit disposable loopback LOCAL_HARNESS configuration required");
 return new Pool({max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:5000,statement_timeout:5000});
}
export async function seedLocalFixtures(pool:Pool){
 const c=await pool.connect();try{await c.query("begin");
 for(const [id,name]of [[LOCAL_FIXTURE.tenantA,"Local fixture A"],[LOCAL_FIXTURE.tenantB,"Local fixture B"]])await c.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,'UTC','USD') on conflict(id) do nothing",[id,name,`w3-${id}`]);
 for(const [id,email]of [[LOCAL_FIXTURE.ownerA,"local-owner-a@test.invalid"],[LOCAL_FIXTURE.staffA,"local-staff-a@test.invalid"],[LOCAL_FIXTURE.ownerB,"local-owner-b@test.invalid"],[LOCAL_FIXTURE.platformUser,"local-platform@test.invalid"]])await c.query("insert into auth.users(id,email) values($1,$2) on conflict(id) do nothing",[id,email]);
 await c.query("insert into public.platform_admins(user_id) values($1) on conflict do nothing",[LOCAL_FIXTURE.platformUser]);
 for(const [tenant,user,role]of [[LOCAL_FIXTURE.tenantA,LOCAL_FIXTURE.ownerA,"BUSINESS_OWNER"],[LOCAL_FIXTURE.tenantA,LOCAL_FIXTURE.staffA,"BUSINESS_STAFF"],[LOCAL_FIXTURE.tenantB,LOCAL_FIXTURE.ownerB,"BUSINESS_OWNER"]])await c.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,$3) on conflict do nothing",[tenant,user,role]);
 for(const [service,tenant,name,multi]of [[LOCAL_FIXTURE.serviceA,LOCAL_FIXTURE.tenantA,"Local cleaning request",false],[LOCAL_FIXTURE.serviceA2,LOCAL_FIXTURE.tenantA,"Local detailing request",true],[LOCAL_FIXTURE.serviceB,LOCAL_FIXTURE.tenantB,"Other business request",false]] as const){
  await c.query("insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes,tax_rate_bp) values($1,$2,'simple',$3,'USD',0,60,0) on conflict(id) do nothing",[service,tenant,name]);
  await c.query("insert into public.service_questions(id,tenant_id,service_id,question_key,prompt,kind,required,choices,sort_order) values($1,$2,$3,'options','Which options?', $4,true,$5::jsonb,0) on conflict(service_id,question_key) do nothing",[randomUUID(),tenant,service,multi?"multi_choice":"single_choice",JSON.stringify([{id:"standard",label:"Standard",priceDelta:0,priceMultiplierBp:10000},{id:"extra",label:"Extra",priceDelta:0,priceMultiplierBp:10000}])]);
  await c.query("insert into public.service_questions(id,tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,sort_order) values($1,$2,$3,'quantity','How many?', 'quantity',true,0,1,10,1) on conflict(service_id,question_key) do nothing",[randomUUID(),tenant,service]);
 }
 await c.query("commit");}catch(e){await c.query("rollback");throw e;}finally{c.release();}
}
export async function localIdentity(token:string){return token===LOCAL_FIXTURE.ownerToken?LOCAL_FIXTURE.ownerA:token===LOCAL_FIXTURE.staffToken?LOCAL_FIXTURE.staffA:token===LOCAL_FIXTURE.otherOwnerToken?LOCAL_FIXTURE.ownerB:token===LOCAL_FIXTURE.platformToken?LOCAL_FIXTURE.platformUser:null;}

import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {Pool} from "pg";
import {LOCAL_FIXTURE as F} from "./fixtures";
import {createFlowHttpServer} from "./http";
import {createTenantProfileReader,createAvailabilityReader,createFlowRepository} from "./repository";
import {createDraftWriter} from "./draft";

const blocked=["DATABASE_URL","PGHOSTADDR","PGSERVICE","PGSERVICEFILE","PGPASSFILE","PGOPTIONS"];
if(process.env.LOCAL_HARNESS!=="1"||process.env.FLOW_TEST_DISPOSABLE!=="1"||process.env.PGHOST!=="127.0.0.1"||process.env.PGUSER!=="postgres"||!/^\d{4,5}$/.test(process.env.PGPORT??"")||!/^lumin_[a-z0-9_]+$/.test(process.env.PGDATABASE??"")||blocked.some(key=>process.env[key]!==undefined))throw Error("explicit disposable loopback HTTP fixture configuration required");

const pool=new Pool({host:"127.0.0.1",port:Number(process.env.PGPORT),database:process.env.PGDATABASE,user:"postgres",password:process.env.PGPASSWORD,max:6,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,statement_timeout:10000});
const tenant=randomUUID(),foreignTenant=randomUUID(),service=randomUUID(),foreignService=randomUUID(),run=randomUUID(),slug="detail-"+run;
const owner=randomUUID(),staff=randomUUID(),foreignOwner=randomUUID();
const ownerToken="detail-owner-"+run,staffToken="detail-staff-"+run,foreignToken="detail-foreign-"+run;
const identity=async(token:string)=>token===ownerToken?owner:token===staffToken?staff:token===foreignToken?foreignOwner:null;
const date=new Date();date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()+1);
const slotStart=new Date(date.getTime()+10*60*60*1000).toISOString(),slotEnd=new Date(date.getTime()+11*60*60*1000).toISOString(),from=date.toISOString(),to=new Date(date.getTime()+86400000-1).toISOString();
const Version=z.object({schemaVersion:z.literal(1)}).strict();
const Profile=Version.extend({profile:z.object({id:z.literal(tenant),name:z.literal("HTTP Detailing"),slug:z.literal(slug),timezone:z.literal("UTC"),currency:z.literal("USD"),status:z.literal("active")}).strict()}).strict();
const Slots=Version.extend({serviceId:z.literal(service),durationMinutes:z.literal(60),slots:z.array(z.object({start:z.string().datetime(),end:z.string().datetime(),remainingCapacity:z.number().int().positive()}).strict())}).strict();
const Draft=Version.extend({bookingId:z.string().uuid(),reference:z.string().min(1),state:z.literal("draft")}).strict();
const selection={serviceId:service,itemQuantities:{},addonIds:["pet-hair"],answers:{vehicle:{choiceIds:["sedan"]},package:{choiceIds:["full-detail"]}}};
const server=createFlowHttpServer({repository:createFlowRepository(pool),authenticateOwner:identity,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin],tenantProfile:createTenantProfileReader(pool),availability:createAvailabilityReader(pool,()=>new Date().toISOString()),draft:createDraftWriter(pool)});
let base="";
async function request(path:string,body:unknown|undefined,token=ownerToken){const response=await fetch(base+path,{method:body===undefined?"GET":"POST",redirect:"error",signal:AbortSignal.timeout(10000),headers:{origin:F.ownerOrigin,authorization:"Bearer "+token,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.match(response.headers.get("content-type")??"",/^application\/json/);return{status:response.status,body:await response.json()};}
async function success<T>(path:string,schema:z.ZodType<T>,body:unknown|undefined,token=ownerToken){const reply=await request(path,body,token);assert.equal(reply.status,200);return schema.parse(z.object({ok:z.literal(true),data:z.unknown()}).strict().parse(reply.body).data);}
// Service-role/RPC-only pre-payment persistence fixture; this intentionally bypasses HTTP caller authentication.
async function canonicalDraft(key:string){const client=await pool.connect();try{await client.query("begin");await client.query("set local statement_timeout='5s'");await client.query("set local role service_role");const result=await client.query("select * from public.create_booking_draft($1::uuid,$2::text,$3::jsonb,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::jsonb,$8::text)",[tenant,key,JSON.stringify(selection),slotStart,slotEnd,JSON.stringify({name:"Canonical Detailing Customer",email:run+"@example.test"}),null,"HTTP detailing canonical selection"]);await client.query("commit");assert.equal(result.rows.length,1);return result.rows[0] as {booking_id:string,reference:string};}catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}}
try{
 await pool.query("insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6) on conflict(id) do nothing",[owner,"http-detail-owner-"+run+"@example.test",staff,"http-detail-staff-"+run+"@example.test",foreignOwner,"http-detail-foreign-"+run+"@example.test"]);
 await pool.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'HTTP Detailing',$3,'UTC','USD'),($2,'HTTP Foreign',$4,'UTC','USD')",[tenant,foreignTenant,slug,"foreign-"+run]);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF')",[tenant,owner,staff]);
 await pool.query("insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,tax_rate_bp) values($1,$2,'Detailing service','configurable','USD',0,60,0),($3,$4,'Foreign detailing','configurable','USD',0,60,0)",[service,tenant,foreignService,foreignTenant]);
 await pool.query("insert into public.service_items(tenant_id,service_id,item_key,name,unit_price,min_qty,max_qty) values($1,$2,'full-detail','Full detail package',18000,1,1)",[tenant,service]);
 await pool.query("insert into public.service_addons(tenant_id,service_id,addon_key,name,price) values($1,$2,'pet-hair','Pet hair removal',2500)",[tenant,service]);
 await pool.query("insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,choices,sort_order) values($1,$2,'vehicle','Vehicle type','single_choice',true,$3::jsonb,0),($1,$2,'package','Package','single_choice',true,$4::jsonb,1)",[tenant,service,JSON.stringify([{id:"sedan",label:"Sedan",priceDelta:0,priceMultiplierBp:10000}]),JSON.stringify([{id:"full-detail",label:"Full detail",priceDelta:18000,priceMultiplierBp:10000}])]);
 await pool.query("insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)",[tenant,service]);
 await pool.query("insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,540,1020,1 from generate_series(0,6)n",[tenant,service]);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://127.0.0.1:"+((server.address() as {port:number}).port);
 await success("/api/profile?tenantId="+tenant,Profile,undefined);
 assert.equal((await request("/api/profile?tenantId="+foreignTenant,undefined)).status,404);
 assert.equal((await request("/api/profile?tenantId="+tenant,undefined,"invalid-synthetic-token")).status,401);
 assert.equal((await request("/api/profile?tenantId="+tenant,undefined,foreignToken)).status,404);
 const params=new URLSearchParams({tenantId:tenant,serviceId:service,from,to});
 const available=await success("/api/availability?"+params.toString(),Slots,undefined);assert.ok(available.slots.some(slot=>slot.start===slotStart&&slot.end===slotEnd));
 assert.equal((await request("/api/availability?"+new URLSearchParams({tenantId:foreignTenant,serviceId:service,from,to}).toString(),undefined)).status,404);
 const draftInput={idempotencyKey:"http-detail-"+run,serviceId:service,slotStart,slotEnd,customer:{name:"HTTP Detail Customer",email:"http-"+run+"@example.test"}};
 const ownerDraft=await success("/api/bookings/draft?tenantId="+tenant,Draft,draftInput);
 const staffDraft=await success("/api/bookings/draft?tenantId="+tenant,Draft,{...draftInput,idempotencyKey:"http-detail-staff-"+run},staffToken);assert.equal(staffDraft.state,"draft");
 assert.deepEqual(await success("/api/bookings/draft?tenantId="+tenant,Draft,draftInput),ownerDraft);
 assert.equal((await request("/api/bookings/draft?tenantId="+foreignTenant,draftInput)).status,403);
 assert.equal((await request("/api/bookings/draft?tenantId="+tenant,draftInput,foreignToken)).status,403);
 assert.equal((await request("/api/bookings/draft?tenantId="+tenant,{...draftInput,serviceId:foreignService,idempotencyKey:"http-detail-foreign-"+run})).status,404);
 assert.equal((await request("/api/bookings/draft?tenantId="+tenant,{...draftInput,selection,idempotencyKey:"http-detail-selection-"+run})).status,400);
 const ownerStored=(await pool.query("select selection,state,pricing,payment_id from public.bookings where id=$1::uuid and tenant_id=$2::uuid",[ownerDraft.bookingId,tenant])).rows[0];
 assert.deepEqual(ownerStored.selection,{serviceId:service});assert.equal(ownerStored.state,"draft");assert.deepEqual(ownerStored.pricing,{});assert.equal(ownerStored.payment_id,null);
 const canonical=await canonicalDraft("http-detail-canonical-"+run);assert.deepEqual(await canonicalDraft("http-detail-canonical-"+run),canonical);
 const stored=(await pool.query("select selection,state,pricing,payment_id from public.bookings where id=$1::uuid and tenant_id=$2::uuid",[canonical.booking_id,tenant])).rows[0];
 assert.deepEqual(stored.selection,selection,"canonical Selection v1 persisted exactly");assert.equal(stored.state,"draft");assert.deepEqual(stored.pricing,{});assert.equal(stored.payment_id,null);
 const effects=(await pool.query("select (select count(*)::int from public.payments where booking_id=$1::uuid) payments,(select count(*)::int from public.capacity_holds where booking_id=$1::uuid) capacity_holds,(select count(*)::int from public.resource_reservations where booking_id=$1::uuid) resource_reservations",[canonical.booking_id])).rows[0];
 assert.deepEqual(effects,{payments:0,capacity_holds:0,resource_reservations:0});
 console.log("PASS disposable HTTP detailing route flow plus separately scoped service-role canonical Selection persistence: owner/staff profile, availability, draft replay, foreign-owner and cross-tenant/service denial, and no payment/capacity/resource side effects");
}finally{
 try{server.closeAllConnections();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.query("delete from public.tenants where id in ($1::uuid,$2::uuid)",[tenant,foreignTenant]);await pool.query("delete from auth.users where id in ($1::uuid,$2::uuid,$3::uuid)",[owner,staff,foreignOwner]);assert.equal((await pool.query("select count(*)::int count from public.tenants where id in ($1::uuid,$2::uuid)",[tenant,foreignTenant])).rows[0].count,0);assert.equal((await pool.query("select count(*)::int count from auth.users where id in ($1::uuid,$2::uuid,$3::uuid)",[owner,staff,foreignOwner])).rows[0].count,0);}finally{await pool.end();}
}


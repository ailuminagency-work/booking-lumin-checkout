import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {localPool,localIdentity,LOCAL_FIXTURE as F} from './fixtures';
import {createFlowHttpServer} from './http';
import {createFlowRepository,createTenantProfileReader,createAvailabilityReader} from './repository';
import {createDraftWriter,DraftReceipt} from './draft';
import {createReservationWriter,HoldReceipt} from './reservation';
import {createMockPaymentWriter,MockPaymentReceipt} from './mock-payment';
import {createBookingConfirmation,ConfirmationReceipt} from './confirmation';

if(process.env.LOCAL_HARNESS!=='1'||process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_[a-z0-9_]+$/.test(process.env.PGDATABASE??'')||!/^\d{4,5}$/.test(process.env.PGPORT??''))throw Error('explicit disposable loopback HTTP fixture configuration required');
// localPool reads libpq-style environment settings; reject ambient routing/config
// overrides before constructing it. A local fixture role is explicitly postgres.
if(process.env.PGHOSTADDR!==undefined&&process.env.PGHOSTADDR!=='127.0.0.1')throw Error('PGHOSTADDR must be exact IPv4 loopback');
if(['PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'].some(key=>process.env[key]!==undefined)||process.env.PGUSER!=='postgres')throw Error('explicit local postgres role and no ambient PostgreSQL overrides required');
const pool=localPool(),tenant=randomUUID(),foreign=randomUUID(),service=randomUUID(),run=randomUUID();
const server=createFlowHttpServer({repository:createFlowRepository(pool),authenticateOwner:localIdentity,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin],tenantProfile:createTenantProfileReader(pool),availability:createAvailabilityReader(pool),draft:createDraftWriter(pool),reservation:createReservationWriter(pool),confirmation:createBookingConfirmation(pool),mockPayment:createMockPaymentWriter(pool,{BOOKING_LUMIN_ENV:'staging',BOOKING_LUMIN_FAKE_PAYMENTS:'1'})});
let base='';
async function request(path:string,body?:unknown,token=F.ownerToken){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{origin:F.ownerOrigin,authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.match(response.headers.get('content-type')??'',/^application\/json/);return{status:response.status,body:await response.json()};}
async function success<T>(path:string,schema:z.ZodType<T>,body?:unknown){const response=await request(path,body);assert.equal(response.status,200);const envelope=z.object({ok:z.literal(true),data:z.unknown()}).strict().parse(response.body);return schema.parse(envelope.data);}
const version={schemaVersion:z.literal(1)};
try{
 // localIdentity intentionally uses its existing fixed synthetic actor; all business fixtures are per-run.
 await pool.query('insert into auth.users(id,email) values($1,$2) on conflict(id) do nothing',[F.ownerA,'local-owner-a@test.invalid']);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'HTTP Housekeeping',$3,'UTC','USD'),($2,'HTTP Foreign',$4,'UTC','USD')`,[tenant,foreign,`http-golden-${run}`,`http-foreign-${run}`]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')`,[tenant,F.ownerA]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Housekeeping visit','simple','USD',12500,60)`,[service,tenant]);
 await pool.query(`insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)`,[tenant,service]);
 await pool.query(`insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,540,1020,1 from generate_series(0,6)n`,[tenant,service]);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const Profile=z.object({...version,profile:z.object({id:z.literal(tenant),name:z.literal('HTTP Housekeeping'),slug:z.literal(`http-golden-${run}`),timezone:z.literal('UTC'),currency:z.literal('USD'),status:z.literal('active')}).strict()}).strict();
 await success(`/api/profile?tenantId=${tenant}`,Profile);
 assert.equal((await request(`/api/profile?tenantId=${foreign}`)).status,404);assert.equal((await request(`/api/profile?tenantId=${tenant}`,undefined,'invalid-synthetic-token')).status,401);
 const day=new Date();day.setUTCHours(0,0,0,0);day.setUTCDate(day.getUTCDate()+1);const from=day.toISOString(),to=new Date(day.getTime()+86400000-1).toISOString();
 const query=new URLSearchParams({tenantId:tenant,serviceId:service,from,to});
 const Slots=z.object({...version,serviceId:z.literal(service),durationMinutes:z.literal(60),slots:z.array(z.object({start:z.string().datetime(),end:z.string().datetime(),remainingCapacity:z.number().int().positive()}).strict())}).strict();
 const available=await success(`/api/availability?${query}`,Slots);assert.ok(available.slots.length);const slot=available.slots[0]!;
 assert.equal((await request(`/api/availability?${new URLSearchParams({tenantId:foreign,serviceId:service,from,to})}`)).status,404);
 const input={idempotencyKey:`http-golden-${run}`,serviceId:service,slotStart:slot.start,slotEnd:slot.end,customer:{name:'Synthetic Customer',email:`customer-${run}@example.test`}};
 assert.equal((await request(`/api/bookings/draft?tenantId=${foreign}`,input)).status,403);
 const created=await success(`/api/bookings/draft?tenantId=${tenant}`,DraftReceipt.extend(version).strict(),input);assert.deepEqual(await success(`/api/bookings/draft?tenantId=${tenant}`,DraftReceipt.extend(version).strict(),input),created);
 const target={bookingId:created.bookingId};
 for(const route of ['reservations/hold','bookings/mock-payment','bookings/confirm'])assert.equal((await request(`/api/${route}?tenantId=${foreign}`,target)).status,403);
 assert.equal((await request(`/api/bookings/mock-payment?tenantId=${tenant}`,{...target,amount:1})).status,400);
 const held=await success(`/api/reservations/hold?tenantId=${tenant}`,HoldReceipt.extend(version).strict(),target);assert.equal(held.bookingId,created.bookingId);assert.deepEqual(await success(`/api/reservations/hold?tenantId=${tenant}`,HoldReceipt.extend(version).strict(),target),held);
 const paid=await success(`/api/bookings/mock-payment?tenantId=${tenant}`,MockPaymentReceipt.extend(version).strict(),target);assert.equal(paid.bookingId,created.bookingId);assert.equal(paid.replayed,false);assert.deepEqual(await success(`/api/bookings/mock-payment?tenantId=${tenant}`,MockPaymentReceipt.extend(version).strict(),target),{...paid,replayed:true});
 const confirmed=await success(`/api/bookings/confirm?tenantId=${tenant}`,ConfirmationReceipt.extend(version).strict(),target);assert.deepEqual(confirmed,{schemaVersion:1,bookingId:created.bookingId,paymentId:paid.paymentId,state:'confirmed',replayed:true});
 const stored=(await pool.query(`select b.state,b.payment_id,b.pricing,p.provider,p.state payment_state,p.amount::int amount,p.currency,h.status hold_status from public.bookings b join public.payments p on p.id=b.payment_id and p.booking_id=b.id and p.tenant_id=b.tenant_id join public.capacity_holds h on h.booking_id=b.id and h.tenant_id=b.tenant_id where b.id=$1`,[created.bookingId])).rows[0];
 assert.deepEqual(stored.pricing.total,{amount:12500,currency:'USD'});assert.equal(stored.state,'confirmed');assert.equal(stored.payment_id,paid.paymentId);assert.equal(stored.provider,'staging_mock');assert.equal(stored.payment_state,'succeeded');assert.equal(stored.amount,12500);assert.equal(stored.currency,'USD');assert.equal(stored.hold_status,'consumed');
 assert.equal((await pool.query('select count(*)::int n from public.payments where booking_id=$1',[created.bookingId])).rows[0].n,1);
 assert.deepEqual((await pool.query('select to_state from public.booking_state_history where booking_id=$1',[created.bookingId])).rows.map(r=>r.to_state).sort(),['confirmed','draft','pending_payment']);
 assert.ok(!(await success(`/api/availability?${query}`,Slots)).slots.some(s=>s.start===slot.start));
 console.log('PASS loopback HTTP housekeeping golden flow: strict profile/availability/draft/hold/simulated-payment/confirmation receipts, replay, tenant denial, amount tampering rejection and durable single-payment confirmation');
}finally{server.closeAllConnections();if(server.listening)await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pool.end();}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createAvailabilityReader,createTenantProfileReader} from './repository';

const blockedNames=['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'];
if(
 process.env.LOCAL_HARNESS!=='1'||
 process.env.FLOW_TEST_DISPOSABLE!=='1'||
 process.env.PGHOST!=='127.0.0.1'||
 !/^\d{4,5}$/.test(process.env.PGPORT??'')||
 !/^lumin_[a-z0-9_]+$/.test(process.env.PGDATABASE??'')||
 process.env.PGUSER!=='postgres'||
 blockedNames.some(name=>process.env[name]!==undefined)
)throw Error('explicit disposable loopback PostgreSQL database required');

const pool=new Pool({
 host:'127.0.0.1',
 port:Number(process.env.PGPORT),
 database:process.env.PGDATABASE,
 user:process.env.PGUSER,
 password:process.env.PGPASSWORD,
 max:5,
 connectionTimeoutMillis:5000,
 idleTimeoutMillis:5000,
 statement_timeout:10000,
});

const actor=randomUUID();
const tenant=randomUUID();
const foreignTenant=randomUUID();
const service=randomUUID();
const foreignService=randomUUID();
const packageItem=randomUUID();
const addon=randomUUID();
const run=randomUUID();
const packageKey='full-detail';
const addonKey='pet-hair';

async function createDraft(tenantId:string,selection:Record<string,unknown>,idempotencyKey:string){
 const client=await pool.connect();
 try{
  await client.query('begin');
  await client.query('set local statement_timeout=\'5s\'');
  await client.query('set local role service_role');
  const result=await client.query(
   'select * from public.create_booking_draft($1::uuid,$2::text,$3::jsonb,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::jsonb,$8::text)',
   [tenantId,idempotencyKey,JSON.stringify(selection),slotStart,slotEnd,JSON.stringify({name:'Synthetic Detailing Customer',email:`detail-${run}@example.test`,phone:'2065550100'}),null,'Disposable local detailing-flow fixture'],
  );
  await client.query('commit');
  assert.equal(result.rows.length,1);
  return result.rows[0] as {booking_id:string;reference:string};
 }catch(error){
  await client.query('rollback').catch(()=>{});
  throw error;
 }finally{client.release();}
}

const next=new Date();
next.setUTCHours(0,0,0,0);
next.setUTCDate(next.getUTCDate()+1);
const slotStart=new Date(next.getTime()+10*60*60*1000).toISOString();
const slotEnd=new Date(next.getTime()+11*60*60*1000).toISOString();
const from=next.toISOString();
const to=new Date(next.getTime()+86400000-1).toISOString();

try{
 await pool.query('insert into auth.users(id,email) values($1,$2)',[actor,`detail-owner-${run}@example.test`]);
 await pool.query(
  `insert into public.tenants(id,name,slug,timezone,currency)
   values($1,'Detailing Golden',$3,'UTC','USD'),($2,'Foreign Detailer',$4,'UTC','USD')`,
  [tenant,foreignTenant,`detail-${run}`,`foreign-detail-${run}`],
 );
 await pool.query('insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,\'BUSINESS_OWNER\')',[tenant,actor]);
 await pool.query(
  `insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,tax_rate_bp)
   values($1,$2,'Car detailing','cart','USD',0,60,0),($3,$4,'Foreign detailing','cart','USD',0,60,0)`,
  [service,tenant,foreignService,foreignTenant],
 );
 await pool.query(
  `insert into public.service_items(id,tenant_id,service_id,item_key,name,unit_price,min_qty,max_qty)
   values($1,$2,$3,$4,'Full detail package',18000,1,1)`,
  [packageItem,tenant,service,packageKey],
 );
 await pool.query(
  `insert into public.service_addons(id,tenant_id,service_id,addon_key,name,price)
   values($1,$2,$3,$4,'Pet hair removal',2500)`,
  [addon,tenant,service,addonKey],
 );
 await pool.query(
  `insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes)
   values($1,$2,0,30,30)`,
  [tenant,service],
 );
 await pool.query(
  `insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity)
   select $1,$2,n,540,1020,1 from generate_series(0,6)n`,
  [tenant,service],
 );

 const profile=createTenantProfileReader(pool);
 const availability=createAvailabilityReader(pool,()=>new Date().toISOString());
 assert.deepEqual(await profile(actor,tenant),{
  id:tenant,name:'Detailing Golden',slug:`detail-${run}`,timezone:'UTC',currency:'USD',status:'active',
 });
 assert.equal(await profile(actor,foreignTenant),null,'foreign tenant profile is hidden from the actor');
 assert.equal(await availability(actor,tenant,foreignService,from,to),null,'foreign service is not available through the tenant context');
 assert.equal(await availability(actor,foreignTenant,service,from,to),null,'foreign tenant context is not available to the actor');
 const available=await availability(actor,tenant,service,from,to);
 if(!available)throw Error('expected tenant service availability');
 assert.equal(available.serviceId,service);
 assert.equal(available.durationMinutes,60);
 assert.ok(available.slots.some(slot=>slot.start===slotStart&&slot.end===slotEnd));

 const packageRows=(await pool.query(
  `select item_key,tenant_id,service_id
     from public.service_items
    where tenant_id=$1::uuid and service_id=$2::uuid`,
  [tenant,service],
 )).rows;
 assert.deepEqual(packageRows,[{item_key:packageKey,tenant_id:tenant,service_id:service}],'package belongs to the tenant service');
 const addonRows=(await pool.query(
  `select addon_key,tenant_id,service_id
     from public.service_addons
    where tenant_id=$1::uuid and service_id=$2::uuid`,
  [tenant,service],
 )).rows;
 assert.deepEqual(addonRows,[{addon_key:addonKey,tenant_id:tenant,service_id:service}],'add-on belongs to the tenant service');

 // Canonical Selection v1 shape. The draft RPC persists this input exactly;
 // pricing and payment remain outside this pre-payment harness.
 const selection={
  serviceId:service,
  vehicleType:'sedan',
  packageKey,
  addonIds:[addonKey],
 };
 const idempotencyKey=`detail-${run}-booking`;
 await assert.rejects(
  createDraft(tenant,{...selection,serviceId:foreignService},`detail-${run}-foreign-service`),
  (error:unknown)=>String((error as {message?:unknown}).message)==='SERVICE_NOT_FOUND',
 );
 await assert.rejects(
  createDraft(foreignTenant,selection,`detail-${run}-foreign-tenant`),
  (error:unknown)=>String((error as {message?:unknown}).message)==='SERVICE_NOT_FOUND',
 );
 const created=await createDraft(tenant,selection,idempotencyKey);
 const replay=await createDraft(tenant,selection,idempotencyKey);
 assert.deepEqual(replay,created,'same tenant/idempotency key replays the same draft');
 const persisted=(await pool.query(
  `select state,selection,pricing,payment_id
     from public.bookings
    where id=$1::uuid and tenant_id=$2::uuid`,
  [created.booking_id,tenant],
 )).rows[0];
 assert.ok(persisted);
 assert.equal(persisted.state,'draft');
 assert.deepEqual(persisted.selection,selection,'canonical detailing selection is persisted exactly');
 assert.deepEqual(persisted.pricing,{});
 assert.equal(persisted.payment_id,null);
 assert.equal((await pool.query('select count(*)::int as count from public.payments where booking_id=$1::uuid',[created.booking_id])).rows[0].count,0);
 assert.equal((await pool.query('select count(*)::int as count from public.bookings where tenant_id=$1::uuid and idempotency_key=$2',[tenant,idempotencyKey])).rows[0].count,1);
 console.log('PASS disposable detailing flow: profile -> cart service/item/add-on -> availability -> canonical draft; replay, exact selection, empty pricing, no payment, and cross-tenant/service denial verified');
}finally{
 await pool.query('delete from public.tenants where id in ($1::uuid,$2::uuid)',[tenant,foreignTenant]).catch(()=>{});
 await pool.query('delete from auth.users where id=$1::uuid',[actor]).catch(()=>{});
 await pool.end();
}

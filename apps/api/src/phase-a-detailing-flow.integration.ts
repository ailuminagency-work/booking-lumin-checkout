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
const vehicleQuestion=randomUUID();
const packageQuestion=randomUUID();
const run=randomUUID();
const packageKey='full-detail';
const addonKey='pet-hair';

function record(value:unknown):Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

// This is a service_role database fixture for pre-payment persistence. The
// helper intentionally has no caller-authentication input and therefore does
// not prove an auth boundary or actor-spoof protection; reader membership and
// tenant/service mismatch checks below are separate evidence only.
async function createDraft(tenantId:string,selection:Record<string,unknown>,idempotencyKey:string){
 const client=await pool.connect();
 try{
  await client.query('begin');
  await client.query('set local statement_timeout=\'5s\'');
  await client.query('set local role service_role');
  // The production RPC persists only serviceId. The harness boundary checks
  // question and catalog references before calling it so invalid/foreign IDs
  // are not misreported as DB-level validation; this is harness-local proof.
  if(tenantId===tenant&&selection.serviceId===service){
   const answers=record(selection.answers);
   const answerChoiceRefs=Object.entries(answers).flatMap(([questionKey,answer])=>{
    const choiceIds=record(answer).choiceIds;
    return Array.isArray(choiceIds)?choiceIds.filter((choiceId):choiceId is string=>typeof choiceId==='string').map(choiceId=>({questionKey,choiceId})):[];
   });
   const questionKeys=[...new Set(answerChoiceRefs.map(ref=>ref.questionKey))];
   const questionRows=await client.query<{question_key:string;choices:unknown}>(
    'select question_key,choices from public.service_questions where tenant_id=$1::uuid and service_id=$2::uuid and question_key=any($3::text[])',
    [tenant,service,questionKeys],
   );
   const declaredChoices=new Map(questionRows.rows.map(row=>[row.question_key,new Set(Array.isArray(row.choices)?row.choices.map(choice=>record(choice).id).filter((choiceId):choiceId is string=>typeof choiceId==='string'):[])]));
   if(questionRows.rows.length!==questionKeys.length||answerChoiceRefs.some(ref=>!declaredChoices.get(ref.questionKey)?.has(ref.choiceId)))throw Error('QUESTION_CHOICE_NOT_BOUND');
   const packageAnswer=record(answers.package);
   const packageChoiceIds=Array.isArray(packageAnswer.choiceIds)?packageAnswer.choiceIds.filter((key):key is string=>typeof key==='string'):[];
   const itemQuantities=record(selection.itemQuantities);
   const itemKeys=[...new Set([...Object.keys(itemQuantities),...packageChoiceIds])];
   const addonKeys=Array.isArray(selection.addonIds)?selection.addonIds.filter((key):key is string=>typeof key==='string'):[];
   const catalogItems=await client.query('select item_key from public.service_items where tenant_id=$1::uuid and service_id=$2::uuid and item_key=any($3::text[])',[tenant,service,itemKeys]);
   const catalogAddons=await client.query('select addon_key from public.service_addons where tenant_id=$1::uuid and service_id=$2::uuid and addon_key=any($3::text[])',[tenant,service,addonKeys]);
   if(catalogItems.rows.length!==itemKeys.length||catalogAddons.rows.length!==addonKeys.length)throw Error('CATALOG_NOT_BOUND');
  }
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
 assert.equal(process.env.PGUSER,'postgres','service-role database fixture; caller authentication is outside this harness');
 await pool.query('insert into auth.users(id,email) values($1,$2)',[actor,`detail-owner-${run}@example.test`]);
 await pool.query(
  `insert into public.tenants(id,name,slug,timezone,currency)
   values($1,'Detailing Golden',$3,'UTC','USD'),($2,'Foreign Detailer',$4,'UTC','USD')`,
  [tenant,foreignTenant,`detail-${run}`,`foreign-detail-${run}`],
 );
 await pool.query('insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,\'BUSINESS_OWNER\')',[tenant,actor]);
 await pool.query(
  `insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,tax_rate_bp)
   values($1,$2,'Car detailing','configurable','USD',0,60,0),($3,$4,'Foreign detailing','configurable','USD',0,60,0)`,
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
  `insert into public.service_questions(id,tenant_id,service_id,question_key,prompt,kind,required,choices,sort_order)
   values
    ($1,$2,$3,'vehicle','Vehicle type','single_choice',true,$4::jsonb,0),
    ($5,$2,$3,'package','Package','single_choice',true,$6::jsonb,1)`,
  [
   vehicleQuestion,tenant,service,
   JSON.stringify([{id:'sedan',label:'Sedan',priceDelta:0,priceMultiplierBp:10000}]),
   packageQuestion,
   JSON.stringify([{id:packageKey,label:'Full detail',priceDelta:18000,priceMultiplierBp:10000}]),
  ],
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
 const questionRows=(await pool.query(
  `select question_key,choices
     from public.service_questions
    where tenant_id=$1::uuid and service_id=$2::uuid
    order by sort_order`,
  [tenant,service],
 )).rows;
 assert.deepEqual(questionRows,[
  {question_key:'vehicle',choices:[{id:'sedan',label:'Sedan',priceDelta:0,priceMultiplierBp:10000}]},
  {question_key:'package',choices:[{id:packageKey,label:'Full detail',priceDelta:18000,priceMultiplierBp:10000}]},
 ],'vehicle and package answers belong to the configurable detailing service');

 // Canonical Selection v1 shape. The draft RPC persists this input exactly;
 // pricing and payment remain outside this pre-payment harness.
 const selection={
  serviceId:service,
  itemQuantities:{},
  addonIds:[addonKey],
  answers:{vehicle:{choiceIds:['sedan']},package:{choiceIds:[packageKey]}},
 };
 const invalidCatalogSelection={
  ...selection,
  itemQuantities:{'foreign-package':1},
  addonIds:['foreign-addon'],
  answers:{vehicle:{choiceIds:['sedan']},package:{choiceIds:[packageKey]}},
 };
 const invalidAnswerSelection={
  ...selection,
  itemQuantities:{},
  answers:{vehicle:{choiceIds:['truck']},package:{choiceIds:['unknown-package']}},
 };
 assert.equal((await pool.query('select count(*)::int as count from public.service_items where tenant_id=$1::uuid and service_id=$2::uuid and item_key=$3',[tenant,service,'foreign-package'])).rows[0].count,0,'invalid package is absent from the owner catalog');
 assert.equal((await pool.query('select count(*)::int as count from public.service_addons where tenant_id=$1::uuid and service_id=$2::uuid and addon_key=$3',[tenant,service,'foreign-addon'])).rows[0].count,0,'invalid add-on is absent from the owner catalog');
 await assert.rejects(
  createDraft(tenant,invalidAnswerSelection,`detail-${run}-invalid-answer`),
  (error:unknown)=>String((error as {message?:unknown}).message)==='QUESTION_CHOICE_NOT_BOUND',
 );
 await assert.rejects(
  createDraft(tenant,invalidCatalogSelection,`detail-${run}-invalid-catalog`),
  (error:unknown)=>String((error as {message?:unknown}).message)==='CATALOG_NOT_BOUND',
 );
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
 const effects=(await pool.query(
  `select
     (select count(*)::int from public.payments where booking_id=$1::uuid) as payments,
     (select count(*)::int from public.capacity_holds where booking_id=$1::uuid) as capacity_holds,
     (select count(*)::int from public.resource_reservations where booking_id=$1::uuid) as resource_reservations`,
  [created.booking_id],
 )).rows[0];
 assert.deepEqual(effects,{payments:0,capacity_holds:0,resource_reservations:0},'draft has no payment or reservation side effects');
 assert.equal((await pool.query('select count(*)::int as count from public.bookings where tenant_id=$1::uuid and idempotency_key=$2',[tenant,idempotencyKey])).rows[0].count,1);
 console.log('PASS disposable detailing flow: profile -> configurable service/questions/item/add-on -> availability -> canonical draft; replay, exact selection, harness-local question/catalog binding, empty pricing, no payment, and cross-tenant/service denial verified');
}finally{
 let cleanupError:unknown;
 try{
  await pool.query('delete from public.tenants where id in ($1::uuid,$2::uuid)',[tenant,foreignTenant]);
  await pool.query('delete from auth.users where id=$1::uuid',[actor]);
  const remainingTenants=(await pool.query('select count(*)::int as count from public.tenants where id in ($1::uuid,$2::uuid)',[tenant,foreignTenant])).rows[0].count;
  const remainingUsers=(await pool.query('select count(*)::int as count from auth.users where id=$1::uuid',[actor])).rows[0].count;
  assert.equal(remainingTenants,0,'disposable tenants were cleaned up');
  assert.equal(remainingUsers,0,'disposable auth user was cleaned up');
 }catch(error){cleanupError=error;}
 try{await pool.end();}catch(error){cleanupError??=error;}
 if(cleanupError)throw cleanupError;
}

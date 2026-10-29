import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {createPaidJourneyCustomerFieldPublicationOperations,PublishPaidJourneyCustomerFieldDraft} from './paid-journey-customer-field-publication';
import {Pool} from 'pg';
import {createPaidJourneyCustomerFieldDraftOperations,SavePaidJourneyCustomerFieldDraft} from './paid-journey-customer-field-draft';
assert.equal(process.env.PAID_JOURNEY_CUSTOMER_FIELD_PUBLIC_READER_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
const ci=process.env.CI==='true';let trustedDatabaseHost='127.0.0.1';
if(ci){assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_journey_fields_reader_ci');trustedDatabaseHost=process.env.PAID_JOURNEY_CUSTOMER_FIELD_DRAFT_CI_DATABASE_HOST??'';assert.equal(isIP(trustedDatabaseHost),4);assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);}else{assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_journey_fields_local_[a-z0-9_]+$/);}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
import {createPaidJourneyCustomerFieldPublicReader} from './paid-journey-customer-field-public-reader';
const origin='https://checkout.example.test',otherOrigin='https://second-checkout.example.test';
const pool=new Pool({max:4}),id=(n:number)=>`79200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),version=id(5),installation=id(6),foreignTenant=id(7);
const form={name:'Public fields',presentation:{accentColor:'#0e7490',layout:'compact'},journey:{schemaVersion:1,stages:['service','options','schedule','information','review_payment','confirmation'].map(kind=>({id:kind,kind,label:kind,enabled:kind!=='options'}))},customerFields:[{id:'custom_gate',kind:'text',label:'Gate',required:false,maxLength:100}],fieldBindings:[{fieldId:'custom_gate',stageId:'information'}]};
const draft=createPaidJourneyCustomerFieldDraftOperations(pool),publication=createPaidJourneyCustomerFieldPublicationOperations(pool,{configuredCustomerOrigins:[origin]}),read=createPaidJourneyCustomerFieldPublicReader(pool,[origin,otherOrigin]);
async function counts(){const result:Record<string,string>={};for(const table of ['bookings','payments','capacity_holds','flow_sessions','paid_journey_sessions','durable_outbox','flow_requests','paid_journey_requests'])result[table]=(await pool.query(`select count(*)::text n from public.${table}`)).rows[0].n;return result;}
const deny=(action:()=>Promise<unknown>,code:string)=>assert.rejects(action,{code});
try{
 const actual=(await pool.query('select current_database() db,current_user actor,host(inet_server_addr()) host,inet_server_port() port')).rows[0];assert.deepEqual(actual,{db:process.env.PGDATABASE,actor:'postgres',host:trustedDatabaseHost,port:Number(process.env.PGPORT)});
 const before=await counts();
 await pool.query("insert into auth.users(id,email) values($1,'public-fields-owner@example.test')",[actor]);
 await pool.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'Public fields','public-fields-owner','UTC','USD'),($2,'Foreign','public-fields-foreign','UTC','USD')",[tenant,foreignTenant]);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 await pool.query('select public.initialize_staging_business_profile($1,$2,$3,$4)',[actor,tenant,'HOUSEKEEPING','public_fields_owner_fixture']);
 await pool.query("insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Cleaning','simple','USD',12500,60)",[service,tenant]);
 await draft.save(actor,tenant,flow,SavePaidJourneyCustomerFieldDraft.parse({schemaVersion:2,serviceId:service,expectedRevision:0,form}));
 await publication.publish(actor,tenant,flow,PublishPaidJourneyCustomerFieldDraft.parse({schemaVersion:2,expectedDraftRevision:1,allowedOrigins:[origin]}),version,installation);
 const original=await read(installation,origin);assert.equal(original.versionId,version);assert.equal(original.renderSchemaVersion,9);assert.deepEqual(original.form,form);
 await deny(()=>read(installation,otherOrigin),'NOT_AVAILABLE');await deny(()=>read(installation,origin+'.evil.test'),'FORBIDDEN');await deny(()=>read(id(30),origin),'NOT_AVAILABLE');
 await pool.query("update public.services set base_price=22000,duration_minutes=90,name='Current catalog' where id=$1",[service]);assert.deepEqual(await read(installation,origin),original);
 await pool.query('update public.services set active=false where id=$1',[service]);await deny(()=>read(installation,origin),'NOT_AVAILABLE');await pool.query("update public.services set active=true,base_price=12500,duration_minutes=60,name='Cleaning' where id=$1",[service]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);await deny(()=>read(installation,origin),'NOT_AVAILABLE');await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 for(const role of ['anon','authenticated','service_role']){
  const client=await pool.connect();try{
   await client.query('begin');await client.query('set local role '+role);
   if(role==='service_role')assert.equal((await client.query('select public.get_paid_journey_customer_field_render($1,$2) result',[installation,origin])).rows[0].result.versionId,version);
   else await deny(()=>client.query('select public.get_paid_journey_customer_field_render($1,$2)',[installation,origin]),'42501');
   await client.query('rollback');await client.query('begin');await client.query('set local role '+role);
   await deny(()=>client.query('select * from public.paid_journey_customer_field_publications'),'42501');await client.query('rollback');
  }finally{client.release();}
 }
 await draft.save(actor,tenant,flow,SavePaidJourneyCustomerFieldDraft.parse({schemaVersion:2,serviceId:service,expectedRevision:1,form:{...form,name:'Updated fields'}}));await publication.publish(actor,tenant,flow,PublishPaidJourneyCustomerFieldDraft.parse({schemaVersion:2,expectedDraftRevision:2,allowedOrigins:[origin]}),id(15),id(16));await deny(()=>read(installation,origin),'NOT_AVAILABLE');assert.equal((await read(id(16),origin)).form.name,'Updated fields');
 assert.deepEqual(await counts(),before);console.log('PASS V9 actual immutable public reader: canonical aliases, exact origins, historical price, active tenant/service, stale installation denial, narrow privileges, zero financial/session writes');
}finally{await pool.end();}

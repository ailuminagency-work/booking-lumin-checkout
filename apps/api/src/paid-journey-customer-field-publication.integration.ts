import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {createPaidJourneyCustomerFieldPublicationOperations,PublishPaidJourneyCustomerFieldDraft} from './paid-journey-customer-field-publication';
import {Pool} from 'pg';
import {createPaidJourneyCustomerFieldDraftOperations,SavePaidJourneyCustomerFieldDraft} from './paid-journey-customer-field-draft';
assert.equal(process.env.PAID_JOURNEY_CUSTOMER_FIELD_PUBLICATION_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
const ci=process.env.CI==='true';let trustedDatabaseHost='127.0.0.1';
if(ci){assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_journey_fields_ci');trustedDatabaseHost=process.env.PAID_JOURNEY_CUSTOMER_FIELD_DRAFT_CI_DATABASE_HOST??'';assert.equal(isIP(trustedDatabaseHost),4);assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);}else{assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_journey_fields_local_[a-z0-9_]+$/);}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const origin='https://checkout.example.test';
const pool=new Pool({max:8}),operations=createPaidJourneyCustomerFieldDraftOperations(pool),id=(n:number)=>`79100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreign=id(5),otherTenant=id(6);
const journey={schemaVersion:1,stages:['service','options','schedule','information','review_payment','confirmation'].map(kind=>({id:kind,kind,label:kind,enabled:kind!=='options'}))};
const form={name:'Field journey',presentation:{accentColor:'#0e7490',layout:'compact'},journey,customerFields:[{id:'custom_gate',kind:'text',label:'Gate',required:false,maxLength:100},{id:'custom_code',kind:'text',label:'Code',required:false,maxLength:100,when:{fieldId:'custom_gate',equals:'yes'}}],fieldBindings:[{fieldId:'custom_gate',stageId:'information'},{fieldId:'custom_code',stageId:'information'}]};
const input=SavePaidJourneyCustomerFieldDraft.parse({schemaVersion:2,serviceId:service,expectedRevision:0,form});
const deny=async(action:()=>Promise<unknown>,code:string)=>assert.rejects(action,{code});
async function financialCounts(){const value:Record<string,string>={};for(const table of ['bookings','payments','capacity_holds','flow_sessions','paid_journey_sessions','paid_journey_holds','durable_outbox','flow_requests','paid_journey_hold_bindings']){const exists=(await pool.query('select to_regclass($1) name',['public.'+table])).rows[0].name;if(exists)value[table]=(await pool.query(`select count(*)::text n from public.${table}`)).rows[0].n;}return value;}
async function legacySave(client:{query:Pool['query']},target:string){return client.query('select public.save_paid_journey_draft($1,$2,$3,$4,0,$5,$6,$7)',[actor,tenant,target,service,'Legacy',{accentColor:'#0e7490',layout:'compact'},journey]);}
try{
 const actual=(await pool.query('select current_database() db,current_user actor,host(inet_server_addr()) host,inet_server_port() port')).rows[0];assert.deepEqual(actual,{db:process.env.PGDATABASE,actor:'postgres',host:trustedDatabaseHost,port:Number(process.env.PGPORT)});
 const before=await financialCounts();
 await pool.query("insert into auth.users(id,email) values($1,'fields-api-owner@example.test'),($2,'fields-api-foreign@example.test')",[actor,foreign]);
 await pool.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'Fields','fields-api-owner','UTC','USD'),($2,'Other','fields-api-other','UTC','USD')",[tenant,otherTenant]);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')",[tenant,actor,otherTenant,foreign]);
 await pool.query('select public.initialize_staging_business_profile($1,$2,$3,$4)',[actor,tenant,'HOUSEKEEPING','fields_api_owner_fixture']);
 await pool.query('select public.initialize_staging_business_profile($1,$2,$3,$4)',[foreign,otherTenant,'HOUSEKEEPING','fields_api_other_fixture']);
 await pool.query("insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Fields','simple','USD',12500,60)",[service,tenant]);

 const publication=createPaidJourneyCustomerFieldPublicationOperations(pool,{configuredCustomerOrigins:[origin]});
 const publishInput=PublishPaidJourneyCustomerFieldDraft.parse({schemaVersion:2,expectedDraftRevision:1,allowedOrigins:[origin]});
 const publish=(revision=1,version=id(30),installation=id(31))=>publication.publish(actor,tenant,flow,{...publishInput,expectedDraftRevision:revision},version,installation);
 await operations.save(actor,tenant,flow,input);
 await deny(()=>publication.read(actor,tenant,flow),'NOT_AVAILABLE');
 await deny(()=>publication.publish(foreign,tenant,flow,publishInput,id(30),id(31)),'FORBIDDEN');
 await deny(()=>publish(2),'CONFLICT');
 await deny(()=>publication.publish(actor,tenant,flow,{...publishInput,allowedOrigins:['https://foreign.example.test']},id(30),id(31)),'FORBIDDEN');
 const raced=await Promise.all([publish(),publish()]);assert.equal(raced.filter(result=>result.replayed).length,1);assert.equal(raced.filter(result=>!result.replayed).length,1);const first=raced.find(result=>!result.replayed)!;assert.deepEqual(first,{schemaVersion:2,tenantId:tenant,flowId:flow,draftRevision:1,versionId:id(30),installationId:id(31),renderSchemaVersion:9,replayed:false});
 const owner=await publication.read(actor,tenant,flow);assert.deepEqual(owner.render.form,form);assert.equal(owner.render.service.price.amount,12500);assert.equal(owner.render.versionId,id(30));
 assert.equal((await publish(1,id(32),id(33))).replayed,true);
 const frozen=(await pool.query('select journey_snapshot from public.flow_versions where id=$1',[id(30)])).rows[0].journey_snapshot;
 await deny(()=>legacySave(pool,flow),'0A000');
 await deny(()=>pool.query('select public.publish_paid_journey_draft($1,$2,$3,1,$4,$5,$6,$6)',[actor,tenant,flow,id(60),id(61),JSON.stringify([origin])]),'P0002');
 await deny(()=>pool.query('select public.publish_detailing_draft($1,$2,$3,1,$4,$5,$6)',[actor,tenant,flow,id(60),id(61),JSON.stringify([origin])]),'P0002');
 await deny(()=>pool.query('select public.publish_paid_simple_flow($1,$2,$3,$4,$5,$6,$7,$8)',[actor,tenant,flow,service,'Legacy',id(60),id(61),JSON.stringify([origin])]),'0A000');
 await deny(()=>pool.query('select public.publish_flow_version($1,$2,1,$3,$4,$5,$6)',[tenant,flow,id(60),id(61),{key:'legacy',steps:[{key:'service',kind:'info',title:'Legacy'}]},JSON.stringify([origin])]),'40001');
 for(const mutation of ["name='stolen'","status='archived'","published_version_id=null"]){await deny(()=>pool.query('update public.flows set '+mutation+' where id=$1',[flow]),'55000');}
 await deny(()=>pool.query('delete from public.flows where id=$1',[flow]),'55000');
 await deny(()=>pool.query("insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout) values($1,$2,$3,1,'Legacy','#4f46e5','stacked')",[flow,tenant,service]),'0A000');
 await deny(()=>pool.query('select public.get_paid_journey_render($1,$2)',[id(31),origin]),'P0002');
 await deny(()=>pool.query('select public.issue_paid_journey_session($1,$2,$3)',[id(31),'a'.repeat(64),origin]),'P0002');
 await operations.save(actor,tenant,flow,SavePaidJourneyCustomerFieldDraft.parse({...input,expectedRevision:1,form:{...form,name:'Updated fields'}}));
 const second=await publish(2,id(34),id(35));assert.equal(second.replayed,false);assert.equal((await publication.read(actor,tenant,flow)).render.form.name,'Updated fields');
 assert.deepEqual((await pool.query('select journey_snapshot from public.flow_versions where id=$1',[id(30)])).rows[0].journey_snapshot,frozen);
 assert.equal((await pool.query('select generation::text n from public.paid_journey_publication_generations where flow_id=$1',[flow])).rows[0].n,'3');
 assert.equal((await pool.query('select count(*)::text n from lumin.paid_journey_customer_field_publication_proofs')).rows[0].n,'0');
 for(const role of ['anon','authenticated','service_role']){const client=await pool.connect();try{await client.query('begin');await client.query('set local role '+role);await deny(()=>client.query('select * from lumin.paid_journey_customer_field_publication_proofs'),'42501');await client.query('rollback');}finally{client.release();}}
 await pool.query('update public.services set base_price=13000 where id=$1',[service]);await deny(()=>publication.read(actor,tenant,flow),'CONFLICT');await deny(()=>publish(2,id(36),id(37)),'CONFLICT');await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);await deny(()=>publication.read(actor,tenant,flow),'FORBIDDEN');await pool.query("update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=$1 and user_id=$2",[tenant,actor]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);await deny(()=>publication.read(actor,tenant,flow),'FORBIDDEN');await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 assert.deepEqual(await financialCounts(),before);
 console.log('PASS V9 actual publication factory: explicit CAS/replay, immutable catalog snapshot, protected flow mutation, editable draft republish, generation, old reader/session denial, private proof, owner/tenant/catalog, zero financial/session writes');
}finally{await pool.end();}

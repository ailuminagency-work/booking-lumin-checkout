import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createDraftWriter} from './draft';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||!/^lumin_/.test(process.env.PGDATABASE??'')||process.env.PGHOST!=='127.0.0.1')throw Error('disposable loopback database required');
const pool=new Pool();const id=(n:number)=>`a5500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pool.query(`insert into auth.users(id,email) values($1,'draft@example.test')`,[id(1)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Draft','draft-fixture','UTC','USD'),($2,'Other','draft-other','UTC','USD')`,[id(2),id(20)]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_STAFF')`,[id(2),id(1)]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Service','simple','USD',100,60),($3,$4,'Foreign','simple','USD',100,60)`,[id(3),id(2),id(23),id(20)]);
 const write=createDraftWriter(pool);const input={idempotencyKey:'draft-request-000001',serviceId:id(3),slotStart:'2030-01-01T10:00:00.000Z',slotEnd:'2030-01-01T11:00:00.000Z',customer:{name:'Example',email:'example@example.test'}};
 const first=await write(id(1),id(2),input);assert.deepEqual(await write(id(1),id(2),input),first);
 await assert.rejects(write(id(1),id(20),input),{code:'FORBIDDEN'});
 await assert.rejects(write(id(1),id(2),{...input,serviceId:id(23)}),{code:'NOT_AVAILABLE'});
 await assert.rejects(write(id(1),id(2),{...input,slotEnd:'2030-01-01T12:00:00.000Z'}),{code:'CONFLICT'});
 const stored=(await pool.query('select state,pricing,payment_id,selection from public.bookings where id=$1',[first.bookingId])).rows[0];assert.deepEqual(stored,{state:'draft',pricing:{},payment_id:null,selection:{serviceId:id(3)}});
 assert.equal((await pool.query('select count(*)::int n from public.bookings')).rows[0].n,1);assert.equal((await pool.query('select count(*)::int n from public.payments')).rows[0].n,0);assert.equal((await pool.query('select count(*)::int n from public.capacity_holds')).rows[0].n,0);
 console.log('PASS real PostgreSQL staff draft creation, stable replay, cross-tenant and foreign service denial, changed-interval replay conflict, no financial/capacity mutation');
}finally{await pool.end();}

import assert from 'node:assert/strict';
import {Pool} from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||!/^lumin_/.test(process.env.PGDATABASE??'')||process.env.PGHOST!=='127.0.0.1')throw Error('disposable loopback database required');
const pool=new Pool({max:8});const id=(n:number)=>`a4300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function call(payment:string,role='service_role'){
 const c=await pool.connect();try{await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query(`set local role ${role==='authenticated'?'authenticated':'service_role'}`);const r=await c.query('select public.confirm_succeeded_payment($1::uuid) result',[payment]);await c.query('commit');return r.rows[0].result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}
}
async function seed(n:number,hold='active'){
 await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values($1::uuid,$2::uuid,($1::uuid)::text,($1::uuid)::text,jsonb_build_object('serviceId',$3::text),'{"total":{"amount":100,"currency":"USD"}}','2030-01-01T10:00Z','2030-01-01T11:00Z')`,[id(n),id(1),id(3)]);
 await pool.query(`insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2::uuid,$3::uuid,'fixture',($1::uuid)::text,'succeeded',100,'USD')`,[id(n+100),id(1),id(n)]);
 await pool.query(`insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1,$2,$3,'2030-01-01T10:00Z','2030-01-01T11:00Z','fixture-key',$4,clock_timestamp()+interval '5 minutes')`,[id(1),id(3),id(n),hold]);
}
try{
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Confirm','atomic-confirm-fixture','UTC','USD'),($2,'Other','atomic-confirm-other','UTC','USD')`,[id(1),id(2)]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Service','simple','USD',100,60)`,[id(3),id(1)]);
 await seed(10);
 await assert.rejects(call(id(110),'authenticated'),{code:'42501'});
 const blocker=await pool.connect();await blocker.query('begin');await blocker.query('select id from public.payments where id=$1 for update',[id(110)]);
 const pending=Promise.all([call(id(110)),call(id(110))]);let observed=false;
 try{for(let i=0;i<100;i++){if((await pool.query(`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0`)).rows[0].n>=2){observed=true;break;}await new Promise(r=>setTimeout(r,20));}}finally{await blocker.query('commit');blocker.release();}
 const results=await pending;assert.ok(observed,'two real confirmation transactions blocked before execution');assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);
 assert.equal((await pool.query(`select count(*)::int n from public.booking_state_history where booking_id=$1 and to_state='confirmed'`,[id(10)])).rows[0].n,1);
 assert.equal((await call(id(110))).replayed,true);
 await seed(11,'consumed');assert.equal((await call(id(111))).state,'confirmed');
 for(const n of [12,13,14,15,16,17,18])await seed(n);
 await pool.query('update public.payments set tenant_id=$1 where id=$2',[id(2),id(112)]);await assert.rejects(call(id(112)),{code:'22023'});
 await pool.query('update public.payments set amount=99 where id=$1',[id(113)]);await assert.rejects(call(id(113)),{code:'22023'});
 await pool.query("update public.payments set state='processing' where id=$1",[id(114)]);await assert.rejects(call(id(114)),{code:'22023'});
 await pool.query("update public.bookings set state='failed' where id=$1",[id(15)]);await assert.rejects(call(id(115)),{code:'40001'});
 await pool.query("update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[id(16)]);await assert.rejects(call(id(116)),{code:'40001'});
 await pool.query("update public.capacity_holds set slot_end=slot_end+interval '1 minute' where booking_id=$1",[id(17)]);await assert.rejects(call(id(117)),{code:'40001'});
 await pool.query(`create function public.fixture_confirmation_failure() returns trigger language plpgsql as $$begin if new.id='${id(18)}'::uuid and new.state='confirmed' then raise exception 'fixture failure' using errcode='23514';end if;return new;end$$;create trigger zz_fixture_confirmation_failure before update on public.bookings for each row execute function public.fixture_confirmation_failure()`);
 await assert.rejects(call(id(118)),{code:'23514'});
 const unchanged=(await pool.query(`select b.state,b.payment_id,h.status,(select count(*)::int from public.booking_state_history where booking_id=b.id) history from public.bookings b join public.capacity_holds h on h.booking_id=b.id where b.id=$1`,[id(18)])).rows[0];assert.deepEqual(unchanged,{state:'draft',payment_id:null,status:'active',history:1});
 await pool.query('drop trigger zz_fixture_confirmation_failure on public.bookings;drop function public.fixture_confirmation_failure()');
 assert.equal((await pool.query(`select count(*)::int n from public.refunds`)).rows[0].n,0);
 console.log('PASS atomic confirmation: active/consumed hold, observed concurrent exactly-once transition, idempotent retry, browser ACL, tenant/amount/payment-state/booking-state/hold mismatch, late-failure full rollback');
}finally{await pool.end();}

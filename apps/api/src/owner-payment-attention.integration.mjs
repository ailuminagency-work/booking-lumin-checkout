import {createFlowHttpServer} from './http.ts';
import {createOwnerPaymentAttentionReader} from './owner-payment-attention.ts';
import {createSupabaseIdentityVerifier} from './supabase-auth.ts';
import {paymentAttentionVisibilityEnabled} from './capability-flags.ts';
// Synthetic local PostgreSQL evidence, never provider capture evidence.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??'')) throw Error('Disposable loopback database required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS']) if(process.env[k]) throw Error(`Unexpected ${k}`);
const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,statement_timeout:5000};
const db=new pg.Client(config), a=new pg.Client(config),b=new pg.Client(config);await Promise.all([db.connect(),a.connect(),b.connect()]);
let passed=0;const ok=label=>{passed++;console.log('PASS',label)};
async function seed(state='processing',hold='active',options={}){
 const t=options.owner?.t??randomUUID(),s=options.owner?.s??randomUUID(),booking=randomUUID(),payment=randomUUID();
 if(!options.owner)await db.query("insert into tenants(id,name,slug,timezone,currency) values($1::uuid,'Synthetic processing authority',$1::uuid::text,'UTC','USD')",[t]);
 if(!options.owner)await db.query("insert into services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1::uuid,$2,'Test','simple','USD',100,60)",[s,t]);
 await db.query(`insert into bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state) values($1::uuid,$2,$1::uuid::text,$1::uuid::text,$3,'{"total":{"amount":100,"currency":"USD"}}','2035-05-01T10:00Z','2035-05-01T11:00Z','pending_payment')`,[booking,t,JSON.stringify({serviceId:s})]);
 await db.query("insert into payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2,$3,'stripe_connect',$1::uuid::text,$4,100,'USD')",[payment,t,booking,state]);
 if(hold!=='missing')await db.query("insert into capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1::uuid,$2,$3,'2035-05-01T10:00Z','2035-05-01T11:00Z',$3::uuid::text,$4,clock_timestamp()+$5::interval)",[t,s,booking,hold==='expired'?'active':hold,hold==='expired'?'-1 minute':'10 minutes']);
 await db.query('delete from payments where id=$1',[payment]);
 const suffix=t.replaceAll('-',''); const account=options.account??('acct_'+suffix), platform='acct_platformAAA';
 if(!options.owner)await db.query("insert into payment_connections(tenant_id,provider,status,account_id,charges_enabled) values($1,'stripe_connect','connected',$2,true)",[t,account]);
 const source=(await a.query('select id from register_payment_source_scope($1,$2,$3)',[t,platform,options.mode??false])).rows[0].id;
 const attempt=(await a.query('select id from bind_booking_payment_source($1,$2,$3)',[t,booking,source])).rows[0].id;
 await a.query("select snapshot_payment_attempt_request($1,$2,100,'USD')",[t,attempt]);
 if(options.envelope!==false)await a.query("select snapshot_payment_request_envelope($1,$2,'2024-06-20')",[t,attempt]);
 const intent=options.intent??('pi_'+payment.replaceAll('-',''));
 await a.query("select associate_payment_attempt_intent($1,$2,$3,$4,$5,$6,100,'USD')",[t,attempt,intent,platform,account,options.mode??false]);
 return {t,s,booking,payment,source,attempt,intent,platform,account};
}
const record=async(c,f,state='requires_payment')=>(await c.query('select payment_internal.record_scoped_payment_observation($1,$2) r',[f.attempt,state])).rows[0].r;
const facts=(f,extra={})=>({provider:'stripe_connect',platformAccountId:f.platform,accountId:f.account,livemode:false,eventId:'evt_'+randomUUID().replaceAll('-',''),objectType:'payment_intent',eventType:'payment_intent.succeeded',eventCreated:1760000000,eventApiVersion:null,parserVersion:2,schemaVersion:2,intentStatus:"succeeded",amountReceived:100,amountCapturable:0,intentId:f.intent,intentAmount:100,currency:'USD',...extra});
const receipt=async(c,x)=>(await c.query('select payment_internal.record_quarantined_event($1) r',[x])).rows[0].r;
const apply=async(c,id)=>(await c.query('select payment_internal.process_scoped_success_receipt($1) r',[id])).rows[0].r;
const snapshot=async f=>{const r={};for(const table of ['payments','bookings','capacity_holds','resource_reservations','refunds','payment_reviews','durable_outbox'])r[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') r from ${table} x where ${table==='bookings'?'id':'booking_id'}=$1`,[f.booking])).rows[0].r;return r;};
const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
async function waitLock(id){for(let i=0;i<150;i++){if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[id])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('contender did not block');}
const pool=new pg.Pool(config),origin='https://portal.example.test',issuer='https://aaaaaaaaaaaaaaaaaaaa.supabase.co',tokens=new Map();let server;
const credential=user=>{const token=[{alg:'HS256',typ:'JWT'},{iss:issuer+'/auth/v1',aud:'authenticated',sub:user,session_id:randomUUID(),is_anonymous:false,exp:2000000000}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.c3ludGhldGlj';tokens.set(token,user);return token;};
// Real verifier composition with synthetic upstream identity authority, not live JWT proof.
const verify=createSupabaseIdentityVerifier({projectUrl:issuer,publicKey:'sb_publishable_abcdefghijklmnop'},{now:()=>1900000000000,fetch:async(_url,opts)=>{const user=tokens.get(String(new Headers(opts.headers).get('authorization')).slice(7));return new Response(JSON.stringify(user?{id:user,is_anonymous:false}:{error:'denied'}),{status:user?200:401,headers:{'content-type':'application/json'}});}});
async function start(enabled=true,reader=createOwnerPaymentAttentionReader(pool)){server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected write');}},ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async token=>{try{return(await verify(token)).userId;}catch{return null;}},...(enabled?{ownerPaymentAttention:reader}:{})});await new Promise(r=>server.listen(0,'127.0.0.1',r));}
async function stop(){server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));server=null;}
async function request(tenant,token,query='',o=origin,method='GET'){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/payment-attention?tenantId=${tenant}${query}`,{method,headers:{origin:o,authorization:'Bearer '+token}});return{status:r.status,data:await r.json()};}
try{
 await a.query('set role service_role');const f=await seed(),g=await seed();await record(a,f);await record(a,g);
 const owner=randomUUID(),staff=randomUUID(),other=randomUUID(),stranger=randomUUID();for(const user of [owner,staff,other,stranger])await db.query("insert into auth.users(id,email) values($1::uuid,$1::text||'@example.test')",[user]);await db.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF'),($4,$5,'BUSINESS_OWNER')",[f.t,owner,staff,g.t,other]);
 const ownerToken=credential(owner),staffToken=credential(staff),otherToken=credential(other),strangerToken=credential(stranger);
 const failFacts=x=>facts(x,{eventType:'payment_intent.payment_failed',parserVersion:1,schemaVersion:1,intentStatus:undefined,amountReceived:undefined,amountCapturable:undefined});
 for(const x of [f,g]){const rr=await receipt(a,failFacts(x));await a.query('select payment_internal.process_scoped_failure_receipt($1)',[rr.receiptId]);}
 const trigger='attention_clock_'+randomUUID().replaceAll('-','');await db.query(`create function public.${trigger}() returns trigger language plpgsql as $$begin new.created_at:=current_setting('test.attention_time')::timestamptz;return new;end$$;create trigger ${trigger} before insert on payment_internal.payment_attention for each row execute function public.${trigger}()`);
 const ids=[];try{for(let i=0;i<4;i++){await a.query("select set_config('test.attention_time',$1,false)",[i===3?'2030-01-01T00:00:00.123457Z':'2030-01-01T00:00:00.123456Z']);const rr=await receipt(a,facts(f));ids.push(rr.receiptId);await apply(a,rr.receiptId);}await a.query("select set_config('test.attention_time','2030-01-01T00:00:00.123456Z',false)");await apply(a,(await receipt(a,facts(g))).receiptId);}finally{await db.query(`drop trigger ${trigger} on payment_internal.payment_attention;drop function public.${trigger}()`);}
 const before=await snapshot(f);await start();
 for(const token of [ownerToken,staffToken]){const response=await request(f.t,token);assert.equal(response.status,200);assert.equal(response.data.data.items.length,4);}ok('real HTTP verifier composition plus actual DB owner/staff membership');
 const seen=[];let cursor=null;do{const response=await request(f.t,ownerToken,'&limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(response.status,200);const page=response.data.data;assert.equal(page.items.length,1);assert.deepEqual(Object.keys(page.items[0]).sort(),['bookingId','bookingReference','conflictSeen','reason','receiptId','recordedAt']);seen.push(page.items[0].receiptId);cursor=page.nextCursor;if(cursor)assert.match(cursor,/\.12345[67]Z\|/);}while(cursor);assert.equal(new Set(seen).size,4);assert.deepEqual(new Set(seen),new Set(ids));assert.equal(seen[0],ids[3]);ok('microsecond + UUID keyset pagination has no skipped ties, safe projection');
 for(const [tenant,token] of [[g.t,ownerToken],[f.t,otherToken],[f.t,strangerToken]])assert.equal((await request(tenant,token)).status,403);assert.equal((await request(f.t,'forged-token-123456')).status,401);assert.equal((await request(f.t,ownerToken,'','https://evil.example')).status,403);tokens.delete(ownerToken);assert.equal((await request(f.t,ownerToken)).status,401);tokens.set(ownerToken,owner);ok('cross tenant, stranger, forged/revoked token and origin denied');
 await db.query("update tenants set status='inactive' where id=$1",[f.t]);assert.equal((await request(f.t,ownerToken)).status,403);await db.query("update tenants set status='active' where id=$1",[f.t]);await db.query('delete from tenant_members where tenant_id=$1 and user_id=$2',[f.t,staff]);assert.equal((await request(f.t,staffToken)).status,403);ok('inactive business and revoked membership denied');
 for(const query of ['&limit=0','&limit=101','&limit=1&limit=2','&cursor=bad','&cursor=x&cursor=y','&actorId='+other,'&limit=1.0'])assert.equal((await request(f.t,ownerToken,query)).status,400);assert.equal((await request(f.t,ownerToken,'',origin,'POST')).status,400);ok('strict query/cursor/method validation');
 await stop();await start(false);assert.equal((await request(f.t,ownerToken)).status,422);assert.equal(paymentAttentionVisibilityEnabled({}),false);assert.equal(paymentAttentionVisibilityEnabled({BOOKING_LUMIN_PAYMENT_ATTENTION_VISIBILITY:'true'}),false);assert.equal(paymentAttentionVisibilityEnabled({BOOKING_LUMIN_PAYMENT_ATTENTION_VISIBILITY:'1'}),true);ok('independent visibility default off');
 await stop();await start(true,async()=>{throw Error('synthetic secret backend error');});const unavailable=await request(f.t,ownerToken);assert.equal(unavailable.status,500);assert.equal(JSON.stringify(unavailable).includes('synthetic secret'),false);assert.deepEqual(await snapshot(f),before);ok('backend failure not empty success; no financial writes or error leakage');
 for(const role of ['anon','authenticated']){await db.query('begin');await db.query(`set local role ${role}`);await assert.rejects(db.query('select payment_internal.list_payment_attention($1,null,null,25)',[f.t]),e=>e.code==='42501');await db.query('rollback');}await db.query('begin');await db.query('set local role service_role');await assert.rejects(db.query('select * from payment_internal.payment_attention'),e=>e.code==='42501');await db.query('rollback');ok('private RPC/client and direct service table access denied');
 await stop();await start();await pool.end();const databaseUnavailable=await request(f.t,ownerToken);assert.equal(databaseUnavailable.status,500);assert.equal(JSON.stringify(databaseUnavailable).includes('pool'),false);assert.deepEqual(await snapshot(f),before);ok('actual closed database pool fails without empty-history success');
 console.log(`${passed} actual HTTP/DB attention checks passed; synthetic identity transport, no deployed notification`);
}finally{await stop();await pool.end().catch(()=>{});await Promise.all([db.end(),a.end(),b.end()]);}

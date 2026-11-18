// Test-only bridge from restarted durable receipt processing to the actual owner
// HTTP/DB reader. Synthetic identity transport is not live JWT/provider evidence.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFlowHttpServer} from './http.ts';
import {createOwnerPaymentAttentionReader} from './owner-payment-attention.ts';
import {createSupabaseIdentityVerifier} from './supabase-auth.ts';

export async function assertRestartedOwnerAttention(pool, fixture, receiptId) {
 if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
 const {tenant,booking}=fixture;
 const snapshot=async()=>{const result={};for(const table of ['bookings','payments','capacity_holds','resource_reservations','refunds','payment_reviews','durable_outbox'])result[table]=(await pool.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from public.${table} t where ${table==='bookings'?'id':'booking_id'}=$1`,[booking])).rows[0].data;return result;};
 const before=await snapshot();
 const expected=(await pool.query(`select a.receipt_id,a.booking_id,b.reference,
 to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at,
 exists(select 1 from payment_internal.event_receipt_conflicts c where c.receipt_id=a.receipt_id) conflict_seen
 from payment_internal.payment_attention a join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
 where a.receipt_id=$1 and a.tenant_id=$2 and a.booking_id=$3 and a.reason='late_success_after_failure'`,[receiptId,tenant,booking])).rows;
 assert.equal(expected.length,1,'restarted processing must have durably committed attention before owner read');
 const owner=randomUUID(),stranger=randomUUID(),foreignOwner=randomUUID(),foreignTenant=randomUUID();
 for(const user of [owner,stranger,foreignOwner])await pool.query("insert into auth.users(id,email) values($1::uuid,$1::text||'@example.test')",[user]);
 await pool.query("insert into public.tenants(id,name,slug,timezone,currency) values($1::uuid,'Synthetic owner read boundary',$1::text,'UTC','USD')",[foreignTenant]);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')",[tenant,owner,foreignTenant,foreignOwner]);
 const origin='https://portal.example.test',issuer='https://aaaaaaaaaaaaaaaaaaaa.supabase.co',tokens=new Map();
 const credential=user=>{const token=[{alg:'HS256',typ:'JWT'},{iss:issuer+'/auth/v1',aud:'authenticated',sub:user,session_id:randomUUID(),is_anonymous:false,exp:2000000000}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.c3ludGhldGlj';tokens.set(token,user);return token;};
 const verifier=createSupabaseIdentityVerifier({projectUrl:issuer,publicKey:'sb_publishable_abcdefghijklmnop'},{now:()=>1900000000000,fetch:async(url,options)=>{
  assert.equal(String(url),issuer+'/auth/v1/user');
  const actor=tokens.get(String(new Headers(options.headers).get('authorization')).slice(7));
  return new Response(JSON.stringify(actor?{id:actor,is_anonymous:false}:{error:'denied'}),{status:actor?200:401,headers:{'content-type':'application/json'}});
 }});
 const ownerToken=credential(owner),strangerToken=credential(stranger),foreignToken=credential(foreignOwner);
 const server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected owner write');}},ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async token=>{try{return(await verifier(token)).userId;}catch{return null;}},ownerPaymentAttention:createOwnerPaymentAttentionReader(pool)});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const request=async(selectedTenant,token,cursor=null,requestOrigin=origin)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/payment-attention?tenantId=${selectedTenant}&limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`,{headers:{origin:requestOrigin,authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};};
  let cursor=null,found,rounds=0;const cursors=new Set();
  do{
   const response=await request(tenant,ownerToken,cursor);assert.equal(response.status,200);
   assert.deepEqual(Object.keys(response.body).sort(),['data','ok']);assert.equal(response.body.ok,true);
   const page=response.body.data;assert.deepEqual(Object.keys(page).sort(),['items','nextCursor','tenantId']);assert.equal(page.tenantId,tenant);assert.ok(page.items.length<=100);
   for(const item of page.items){assert.deepEqual(Object.keys(item).sort(),['bookingId','bookingReference','conflictSeen','reason','receiptId','recordedAt']);assert.equal(item.reason,'late_success_after_failure');assert.match(item.recordedAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);assert.equal(typeof item.conflictSeen,'boolean');if(item.receiptId===receiptId){assert.equal(found,undefined,'receipt must not repeat across pages');found=item;}}
   cursor=page.nextCursor;if(cursor){assert.equal(typeof cursor,'string');assert.ok(!cursors.has(cursor),'pagination must progress');cursors.add(cursor);}assert.ok(++rounds<=100,'bounded fixture pagination');
  }while(cursor);
  assert.deepEqual(found,{receiptId,bookingId:booking,bookingReference:expected[0].reference,reason:'late_success_after_failure',recordedAt:expected[0].recorded_at,conflictSeen:expected[0].conflict_seen});
  assert.equal((await request(foreignTenant,ownerToken)).status,403);
  assert.equal((await request(tenant,foreignToken)).status,403);
  assert.equal((await request(tenant,strangerToken)).status,403);
  assert.equal((await request(tenant,'forged-token-123456')).status,401);
  assert.equal((await request(tenant,ownerToken,null,'https://evil.example')).status,403);
  assert.deepEqual(await snapshot(),before,'owner visibility must not mutate financial state');
 }finally{
  server.closeAllConnections();if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
}

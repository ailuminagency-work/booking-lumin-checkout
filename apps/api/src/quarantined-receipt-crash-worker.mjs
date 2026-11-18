// TEST WORKER ONLY. Disposable loopback, synthetic fixed identities. Never deploy.
import http from 'node:http';
import pg from 'pg';
import {createStripePaymentProvider} from '../../../packages/adapters/src/stripePayment.ts';
import {normalizeStripeReceiptCandidate} from '../../../packages/adapters/src/stripeReceiptCandidate.internal.ts';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??'')||!process.send)throw Error('Disposable child only');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error('Unexpected database override');
const source=process.argv[2]??'a',phase=process.argv[3]??'none';
if(!['a','b','live','platform'].includes(source)||!['none','before_commit','after_commit','db_failure'].includes(phase))throw Error('Unsupported fixture configuration');
const accountId=source==='b'?'acct_fixtureBBBB':'acct_fixtureAAAA',livemode=source==='live';
const platformAccountId=source==='platform'?'acct_platformBBB':'acct_platformAAA';
const verifier=createStripePaymentProvider({secretKey:'unused-synthetic',webhookSecret:'synthetic-crash-signing',directChargeSource:{accountId,livemode},now:()=>1760000000000,fetchImpl:()=>{throw Error('provider network forbidden');}});
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,database:process.env.PGDATABASE,max:8});
async function barrier(at,backendPid){if(phase!==at)return;await new Promise(resolve=>{const resume=m=>{if(m?.type==='resume'){process.off('message',resume);resolve();}};process.on('message',resume);process.send({type:'barrier',phase:at,backendPid});});}
const server=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/receipt'){res.writeHead(404).end();return;}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413).end();return;}chunks.push(chunk);}
 let raw;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));}catch{res.writeHead(400).end();return;}
 let facts;
 try{const event=await verifier.parseWebhook(raw,typeof req.headers['stripe-signature']==='string'?req.headers['stripe-signature']:null);facts=normalizeStripeReceiptCandidate(event.raw,{platformAccountId});}
 catch{res.writeHead(400,{'Content-Type':'application/json'}).end('{"error":"invalid_fixture_event"}');return;}
 let client;
 try{
  client=await pool.connect();await client.query('begin');await client.query('set local role service_role');
  if(phase==='db_failure')await client.query('select 1/0'); // Real DB statement failure, not a claimed network outage.
  const result=(await client.query('select payment_internal.record_quarantined_event($1::jsonb) result',[JSON.stringify(facts)])).rows[0].result;
  const backendPid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;
  await barrier('before_commit',backendPid);
  await client.query('commit');
  await barrier('after_commit',backendPid);
  // Successful durable quarantine STILL does not authorize webhook ACK200.
  res.writeHead(503,{'Content-Type':'application/json','Retry-After':'60'}).end(JSON.stringify({quarantined:true,outcome:result.outcome,conflictSeen:result.conflictSeen}));
 }catch{if(client)await client.query('rollback').catch(()=>{});res.writeHead(503,{'Content-Type':'application/json'}).end('{"error":"receipt_unavailable"}');}
 finally{client?.release();}
});
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',async m=>{if(m?.type==='stop'){server.close();await pool.end();process.exit(0);}});

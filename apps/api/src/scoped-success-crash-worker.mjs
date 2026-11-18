// SUCCESS/FAILURE TEST WORKER. Disposable loopback, synthetic fixed identities. Never deploy.
import http from 'node:http';
import pg from 'pg';
import {createStripePaymentProvider} from '../../../packages/adapters/src/stripePayment.ts';
import {normalizeStripeReceiptCandidate} from '../../../packages/adapters/src/stripeReceiptCandidate.internal.ts';
import {normalizeStripeSucceededReceiptCandidateV2} from '../../../packages/adapters/src/stripeSucceededReceiptCandidateV2.internal.ts';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??'')||!process.send)throw Error('Disposable child only');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error('Unexpected database override');
const source=process.argv[2]??'a',phase=process.argv[3]??'none';
if(!['a','b','live','platform'].includes(source)||!['none','after_receipt_commit','before_processing_commit','after_processing_commit','processing_db_failure'].includes(phase))throw Error('Unsupported fixture configuration');
// Owned immutable construction snapshot. The adapter itself still reads opts
// on each parse; do not claim it is independently immutable.
const supplied={accountId:source==='b'?'acct_fixtureBBBB':'acct_fixtureAAAA',livemode:source==='live',platformAccountId:source==='platform'?'acct_platformBBB':'acct_platformAAA',webhookSecret:'synthetic-failure-crash-signing'};
const endpoint=Object.freeze({...supplied});
const verifierOptions=Object.freeze({secretKey:'unused-synthetic',webhookSecret:endpoint.webhookSecret,directChargeSource:Object.freeze({accountId:endpoint.accountId,livemode:endpoint.livemode}),now:()=>1760000000000,fetchImpl:()=>{throw Error('provider network forbidden');}});
const verifier=createStripePaymentProvider(verifierOptions);
// Deliberately mutate the caller-owned object after construction. Requests must
// still verify against the copied original, never these changed values.
supplied.webhookSecret='mutated-caller-secret';supplied.accountId='acct_mutatedAAAA';supplied.platformAccountId='acct_mutatedPLAT';supplied.livemode=!supplied.livemode;
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,database:process.env.PGDATABASE,max:8});
async function barrier(at,backendPid,decision){if(phase!==at)return;await new Promise(resolve=>{const resume=m=>{if(m?.type==='resume'){process.off('message',resume);resolve();}};process.on('message',resume);process.send({type:'barrier',phase:at,backendPid,decision});});}
const server=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/receipt'){res.writeHead(404,{'Content-Type':'application/json'}).end('{"error":"fixture_not_found"}');return;}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413).end();return;}chunks.push(chunk);}
 let raw;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));}catch{res.writeHead(400).end();return;}
 let facts;
 try{const event=await verifier.parseWebhook(raw,typeof req.headers['stripe-signature']==='string'?req.headers['stripe-signature']:null);facts=(event.raw?.type==='payment_intent.succeeded'?normalizeStripeSucceededReceiptCandidateV2:normalizeStripeReceiptCandidate)(event.raw,{platformAccountId:endpoint.platformAccountId});}
 catch{res.writeHead(400,{'Content-Type':'application/json'}).end('{"error":"invalid_fixture_event"}');return;}
 let client;
 try{
  client=await pool.connect();await client.query('begin');await client.query('set local role service_role');
  const receipt=(await client.query('select payment_internal.record_quarantined_event($1::jsonb) result',[JSON.stringify(facts)])).rows[0].result;
  const backendPid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;
  await client.query('commit');
  await barrier('after_receipt_commit',backendPid);
  // Separate transaction by design: a killed processing attempt must not erase
  // its already-committed receipt. No ACK200 even after successful effects.
  await client.query('begin');await client.query('set local role service_role');
  if(phase==='processing_db_failure')await client.query('select 1/0');
  const processor=facts.eventType==='payment_intent.succeeded'?'process_scoped_success_receipt':'process_scoped_failure_receipt';
  const decision=(await client.query(`select payment_internal.${processor}($1) result`,[receipt.receiptId])).rows[0].result;
  await barrier('before_processing_commit',backendPid,decision.status);
  await client.query('commit');
  await barrier('after_processing_commit',backendPid,decision.status);
  res.writeHead(503,{'Content-Type':'application/json','Retry-After':'60'}).end(JSON.stringify({quarantined:true,outcome:receipt.outcome,conflictSeen:receipt.conflictSeen,decision:decision.status,replayed:decision.replayed,receiptId:receipt.receiptId}));
 }catch{if(client)await client.query('rollback').catch(()=>{});res.writeHead(503,{'Content-Type':'application/json'}).end('{"error":"receipt_unavailable"}');}
 finally{client?.release();}
});
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',async m=>{if(m?.type==='stop'){server.close();await pool.end();process.exit(0);}});

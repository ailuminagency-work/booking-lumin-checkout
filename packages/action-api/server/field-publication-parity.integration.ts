/** Inert on import. Database-owner validator parity, not an application authorization test. */
import assert from 'node:assert/strict';
import {writeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Client} from 'pg';
import {parseFieldPublicationV1} from '../../workflow/src/fieldPublicationV1';
import {semanticCases,storageLimitCases,wireRejectCases,SEMANTIC_COUNT,STORAGE_LIMIT_COUNT,WIRE_REJECT_COUNT} from './field-publication-parity-corpus';
import {textDraftTestProfile,verifyTextDraftDatabase} from './text-field-drafts-test-profile';
import {observeTextDraftConnectionEnd,awaitTextDraftConnectionCleanup} from './text-field-drafts.integration';
export function initialReceipt(){return {schemaVersion:1,kind:'FIELD_PUBLICATION_PARITY',status:'failed',category:'CONFIGURATION_FAILED',semanticCases:0,storageLimitCases:0,wireRejectCases:0,connectionsClosed:false};}
export function configuration(env:NodeJS.ProcessEnv,platform:NodeJS.Platform=process.platform){assert.equal(env.FIELD_PUBLICATION_PARITY_APPROVED,'1');assert.equal(env.TEXT_DRAFT_CONCURRENCY_APPROVED,'1');return {...textDraftTestProfile(env,'TEXT_DRAFT_CONCURRENCY_DATABASE',platform).connection,statement_timeout:7000,lock_timeout:5000,query_timeout:9000,idle_in_transaction_session_timeout:10000,application_name:'lumin_publication_parity'};}
function accepts(input:unknown){try{return {accepted:true,parsed:parseFieldPublicationV1(input)};}catch{return {accepted:false};}}
async function bounded<T>(task:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BOUND')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
export async function main(){
 const result=initialReceipt(),queries=new Set<Promise<unknown>>();let client:Client|undefined,end:ReturnType<typeof observeTextDraftConnectionEnd>|undefined,fault=false,finished=false;
 const watchdog=setTimeout(()=>{if(!finished){writeSync(1,JSON.stringify({...result,status:'failed',category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);}},90000);
 function query(sql:string,params:unknown[]=[]){assert.ok(client);const task=client.query(sql,params);queries.add(task);void task.then(()=>queries.delete(task),()=>queries.delete(task));return task;}
 try{
  assert.equal(process.argv.length,2);const config=configuration(process.env);result.category='CONNECTION_FAILED';client=new Client(config);end=observeTextDraftConnectionEnd(client);client.on('error',()=>{fault=true;});await client.connect();
  await verifyTextDraftDatabase({query:sql=>query(sql)},textDraftTestProfile(process.env,'TEXT_DRAFT_CONCURRENCY_DATABASE'));
  assert.equal((await query("select to_regprocedure('lumin.field_publication_v1_valid(jsonb)') is not null as present")).rows[0].present,true);
  result.category='CASE_FAILED';
  const semantic=semanticCases(),storage=storageLimitCases(),wire=wireRejectCases();assert.equal(semantic.length,SEMANTIC_COUNT);assert.equal(storage.length,STORAGE_LIMIT_COUNT);assert.equal(wire.length,WIRE_REJECT_COUNT);
  assert.equal(new Set([...semantic,...storage,...wire].map(value=>value.name)).size,SEMANTIC_COUNT+STORAGE_LIMIT_COUNT+WIRE_REJECT_COUNT);
  for(const entry of semantic){
   const serialized=JSON.stringify(entry.input),decoded:unknown=JSON.parse(serialized),ts=accepts(decoded);assert.equal(ts.accepted,entry.accepted,entry.name);if(ts.accepted)assert.deepEqual(ts.parsed,decoded,entry.name);
   const sql=(await query('select lumin.field_publication_v1_valid($1::jsonb) as accepted',[serialized])).rows[0].accepted;assert.equal(sql,entry.accepted,entry.name);result.semanticCases++;
  }
  for(const entry of storage){
   const serialized=JSON.stringify(entry.input),decoded:unknown=JSON.parse(serialized),ts=accepts(decoded);assert.equal(ts.accepted,true,entry.name);assert.deepEqual(ts.parsed,decoded,entry.name);
   const sql=(await query("select lumin.field_publication_v1_valid($1::jsonb) as accepted,octet_length(($1::jsonb->'definition')::text) as definition_bytes,octet_length(($1::jsonb)::text) as envelope_bytes",[serialized])).rows[0];
   assert.equal(sql.accepted,false,entry.name);assert.ok(sql.definition_bytes>32768,entry.name);assert.equal(sql.envelope_bytes>65536,entry.envelopeExceedsLimit,entry.name);result.storageLimitCases++;
  }
  for(const entry of wire){
   const serialized=JSON.stringify(entry.input),decoded:unknown=JSON.parse(serialized);assert.equal(accepts(decoded).accepted,false,entry.name);let rejected=false;
   try{await query('select lumin.field_publication_v1_valid($1::jsonb) as accepted',[serialized]);}catch(error){assert.equal((error as {code?:unknown}).code,entry.sqlstate,entry.name);rejected=true;}
   assert.equal(rejected,true,entry.name);result.wireRejectCases++;
  }
  assert.equal(result.semanticCases,SEMANTIC_COUNT);assert.equal(result.storageLimitCases,STORAGE_LIMIT_COUNT);assert.equal(result.wireRejectCases,WIRE_REJECT_COUNT);assert.equal(fault,false);result.status='passed';result.category='COMPLETE';
 }catch{result.status='failed';}
 finally{
  let cleanupFailed=false;
  if(client){try{await bounded(query('rollback'),11000);await bounded(Promise.allSettled([...queries]),9000);assert.equal(queries.size,0);}catch{cleanupFailed=true;}
   try{assert.ok(end);await awaitTextDraftConnectionCleanup([client.end()],[end],7000);result.connectionsClosed=!cleanupFailed&&queries.size===0;}catch{cleanupFailed=true;}}
  if(cleanupFailed){result.status='failed';result.category='CLEANUP_UNOBSERVED';}if(fault){result.status='failed';if(result.category==='COMPLETE')result.category='CONNECTION_FAILED';}finished=true;clearTimeout(watchdog);
 }
 writeSync(1,JSON.stringify(result)+'\n');return result.status==='passed'?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const fatal=()=>{writeSync(1,JSON.stringify({...initialReceipt(),category:'CLEANUP_UNOBSERVED'})+'\n');process.exit(1);};process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);process.exitCode=await main();}

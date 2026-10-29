import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PaidInstallHealth} from '@lumin/contracts';
import {PaidSimpleRender,PaidOptionRender} from '@lumin/workflow';
import {Uuid} from './contracts';
import {FlowError} from './repository';
export type PaidInstallHealthReader=(actor:string,tenant:string,flow:string)=>Promise<PaidInstallHealth>;
const Origin=z.string().refine(s=>{try{return new URL(s).origin===s&&/^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[1-9][0-9]{0,4})?$/.test(s);}catch{return false;}});
const Installation=z.object({installationId:Uuid,allowedOrigins:z.array(Origin).min(1).max(20).refine(a=>new Set(a).size===a.length)}).strict();
/** Evidence only: session issuance is not successful browser loading. The fixed
 * RPC reads private provenance without widening grants or invoking any writer. */
export function createPaidInstallHealthReader(pool:Pool,approvedOrigins:readonly string[]):PaidInstallHealthReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const raw=(await client.query('select public.owner_paid_install_health($1::uuid,$2::uuid,$3::uuid) as result',[actor,tenant,flow])).rows[0]?.result;
  if(!raw||raw.tenantId!==tenant||raw.flowId!==flow||!Uuid.safeParse(raw.versionId).success||!/^\d+$/.test(raw.sourceRevision))throw new FlowError('NOT_AVAILABLE');
  const render=raw.renderSchemaVersion===3?PaidSimpleRender.omit({versionId:true}).safeParse(raw.snapshot):raw.renderSchemaVersion===4?PaidOptionRender.omit({versionId:true}).safeParse(raw.snapshot):null;
  if(!render?.success)throw new FlowError('NOT_AVAILABLE');
  const snapshot=render.data,revision=Number(raw.sourceRevision);
  if(!Number.isSafeInteger(revision)||revision<1||raw.serviceId!==snapshot.service.id||raw.flowServiceId!==raw.serviceId||!isDeepStrictEqual(raw.boundSnapshot,snapshot.service)||!isDeepStrictEqual(raw.config,{key:raw.renderSchemaVersion===3?'paid_simple':'paid_option',steps:[{key:'service',kind:'info',title:snapshot.service.name}]}))throw new FlowError('NOT_AVAILABLE');
  if(snapshot.renderSchemaVersion===3&&snapshot.publication&&snapshot.publication.draftRevision!==revision)throw new FlowError('NOT_AVAILABLE');
  if(!Array.isArray(raw.installations)||raw.installations.length>2)throw new FlowError('NOT_AVAILABLE');
  let receipt:PaidInstallHealth['installation']['receipt']=null;
  if(raw.installations.length===1){const i=Installation.safeParse(raw.installations[0]);if(i.success&&i.data.allowedOrigins.every(o=>approvedOrigins.includes(o)))receipt={versionId:raw.versionId,installationId:i.data.installationId,renderSchemaVersion:raw.renderSchemaVersion,hostedPath:`/checkout/flow/${i.data.installationId}`};}
  const catalog=raw.catalogStatus==='available'?(isDeepStrictEqual(raw.catalogSnapshot,snapshot.service)?'compatible':'incompatible'):raw.catalogStatus;
  const sessionCount=raw.issuedSessionCount,bookingCount=raw.confirmedStagingBookingCount;
  if(!Number.isInteger(sessionCount)||sessionCount<0||sessionCount>1000001||!Number.isInteger(bookingCount)||bookingCount<0||bookingCount>1000001)throw new FlowError('NOT_AVAILABLE');
  const parsed=PaidInstallHealth.safeParse({schemaVersion:1,flowId:flow,versionId:raw.versionId,renderSchemaVersion:raw.renderSchemaVersion,status:receipt&&catalog==='compatible'?'unknown':'degraded',installation:{status:receipt?'available':'unavailable',receipt},catalog:{status:catalog},customerEvidence:{issuedSessionCount:Math.min(1000000,sessionCount),sessionCountCapped:sessionCount>1000000,lastSuccessfulLoadAt:null,loadEvidence:'unavailable',confirmedStagingBookingCount:Math.min(1000000,bookingCount),bookingCountCapped:bookingCount>1000000,lastConfirmedStagingBookingAt:raw.lastConfirmedStagingBookingAt},testPayment:{mode:'staging_mock',simulated:true,enabled:true}});
  if(!parsed.success)throw new FlowError('NOT_AVAILABLE');await client.query('commit');return parsed.data;
 }catch(error){await client.query('rollback').catch(()=>{});if(error instanceof FlowError)throw error;const code=(error as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':'INTERNAL_ERROR');}finally{client.release();}
};}

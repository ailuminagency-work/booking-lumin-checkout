import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PaidSimpleRender,PaidSimplePresentation} from '@lumin/workflow';
import {Uuid} from './contracts';
import {PaidPublicationReceipt} from './paid-publication-reader';
import {FlowError} from './repository';
const Version=z.object({versionId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),name:z.string().min(1).max(200),presentation:PaidSimplePresentation,current:z.boolean(),publication:PaidPublicationReceipt.nullable()}).strict().refine(v=>v.publication===null||v.publication.versionId===v.versionId);
export const PaidVersionHistory=z.object({flowId:Uuid,versions:z.array(Version).min(1).max(50)}).strict().refine(h=>h.versions.filter(v=>v.current).length===1&&new Set(h.versions.map(v=>v.versionId)).size===h.versions.length&&h.versions.every((v,i)=>i===0||h.versions[i-1]!.draftRevision>v.draftRevision));
export type PaidVersionHistory=z.infer<typeof PaidVersionHistory>;
export type PaidVersionHistoryReader=(actor:string,tenant:string,flow:string)=>Promise<PaidVersionHistory>;
const CanonicalOrigin=z.string().refine(s=>{try{return new URL(s).origin===s&&/^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[1-9][0-9]{0,4})?$/.test(s);}catch{return false;}});
const Installation=z.object({installationId:Uuid,allowedOrigins:z.array(CanonicalOrigin).min(1).max(20).refine(a=>new Set(a).size===a.length)}).strict();
type Row={tenantId:string;flowId:string;versionId:string;sourceRevision:string;renderSchemaVersion:number;snapshot:unknown;serviceId:string;boundSnapshot:unknown;config:unknown;installations:unknown};
/** Historical immutable evidence only. A null installation receipt grants no link,
 * retry or rollback authority. No current catalog repricing and no writer RPCs. The fixed owner read RPC
 * preserves private table grants; its share locks require a normal transaction. */
export function createPaidVersionHistoryReader(pool:Pool,approvedOrigins:readonly string[]):PaidVersionHistoryReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read');await client.query('set local role service_role');
  const raw=(await client.query('select public.owner_paid_simple_version_history($1::uuid,$2::uuid,$3::uuid) as result',[actor,tenant,flow])).rows[0]?.result;
  if(!raw||raw.flowId!==flow||raw.currentSchema!==3||!Uuid.safeParse(raw.currentVersionId).success||!Array.isArray(raw.versions))throw new FlowError('NOT_AVAILABLE');
  const access={currentVersionId:raw.currentVersionId as string},result={rows:raw.versions as Row[]};
  if(result.rows.length>50)throw new FlowError('NOT_AVAILABLE');
  const versions=result.rows.map(row=>{
   const parsed=PaidSimpleRender.omit({versionId:true}).safeParse(row.snapshot);
   if(row.tenantId!==tenant||row.flowId!==flow||row.renderSchemaVersion!==3||!parsed.success||!parsed.data.publication||!Uuid.safeParse(row.versionId).success||!/^\d+$/.test(row.sourceRevision))throw new FlowError('NOT_AVAILABLE');
   const render=parsed.data,metadata=render.publication!,revision=Number(row.sourceRevision);
   if(!Number.isSafeInteger(revision)||revision!==metadata.draftRevision||row.serviceId!==render.service.id||!isDeepStrictEqual(row.boundSnapshot,render.service)||!isDeepStrictEqual(row.config,{key:'paid_simple',steps:[{key:'service',kind:'info',title:render.service.name}]}))throw new FlowError('NOT_AVAILABLE');
   let publication:PaidPublicationReceipt|null=null;
   if(Array.isArray(row.installations)&&row.installations.length===1){
    const installation=Installation.safeParse(row.installations[0]);
    if(installation.success&&installation.data.allowedOrigins.every(o=>approvedOrigins.includes(o))){const receipt=PaidPublicationReceipt.safeParse({versionId:row.versionId,installationId:installation.data.installationId,renderSchemaVersion:3,hostedPath:`/checkout/flow/${installation.data.installationId}`});if(receipt.success)publication=receipt.data;}
   }
   return{versionId:row.versionId,draftRevision:revision,name:metadata.name,presentation:metadata.presentation,current:row.versionId===access.currentVersionId,publication};
  });
  const parsed=PaidVersionHistory.safeParse({flowId:flow,versions});if(!parsed.success)throw new FlowError('NOT_AVAILABLE');
  await client.query('commit');return parsed.data;
 }catch(error){await client.query('rollback').catch(()=>{});if(error instanceof FlowError)throw error;const code=(error as {code?:unknown})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':'INTERNAL_ERROR');}finally{client.release();}
};}

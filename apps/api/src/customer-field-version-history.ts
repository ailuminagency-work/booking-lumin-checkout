import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PaidSimpleRender,PaidCustomerFieldRender,PaidSimplePresentation} from '@lumin/workflow';
import {Uuid} from './contracts';
import {FlowError} from './repository';

const Receipt=z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.union([z.literal(3),z.literal(5)]),hostedPath:z.string()}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`);
const base={versionId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),name:PaidCustomerFieldRender.shape.publication.shape.name,presentation:PaidSimplePresentation,current:z.boolean(),publication:Receipt.nullable()};
const Version=z.discriminatedUnion('renderSchemaVersion',[
 z.object({...base,renderSchemaVersion:z.literal(3)}).strict(),
 z.object({...base,renderSchemaVersion:z.literal(5),customerFields:PaidCustomerFieldRender.shape.customerFields}).strict(),
]).refine(v=>v.publication===null||(v.publication.versionId===v.versionId&&v.publication.renderSchemaVersion===v.renderSchemaVersion));
export const CustomerFieldVersionHistory=z.object({flowId:Uuid,versions:z.array(Version).min(1).max(50)}).strict().refine(h=>h.versions.filter(v=>v.current).length===1&&h.versions.some(v=>v.renderSchemaVersion===5)&&new Set(h.versions.map(v=>v.versionId)).size===h.versions.length&&h.versions.every((v,i)=>i===0||h.versions[i-1]!.draftRevision>v.draftRevision));
export type CustomerFieldVersionHistory=z.infer<typeof CustomerFieldVersionHistory>;
export type CustomerFieldVersionHistoryReader=(actor:string,tenant:string,flow:string)=>Promise<CustomerFieldVersionHistory>;
const Origin=z.string().refine(s=>{try{return new URL(s).origin===s&&/^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[1-9][0-9]{0,4})?$/.test(s);}catch{return false;}});
const Installation=z.object({installationId:Uuid,allowedOrigins:z.array(Origin).min(1).max(20).refine(a=>new Set(a).size===a.length)}).strict();
type Row={tenantId:string;flowId:string;versionId:string;sourceRevision:string;renderSchemaVersion:number;snapshot:unknown;serviceId:string;boundSnapshot:unknown;config:unknown;installations:unknown};

/** Immutable history only. No catalog repricing, customer answers, or writer authority. */
export function createCustomerFieldVersionHistoryReader(pool:Pool,approvedOrigins:readonly string[]):CustomerFieldVersionHistoryReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const raw=(await client.query('select public.owner_customer_field_version_history($1::uuid,$2::uuid,$3::uuid) as result',[actor,tenant,flow])).rows[0]?.result;
  if(!raw||raw.flowId!==flow||![3,5].includes(raw.currentSchema)||!Uuid.safeParse(raw.currentVersionId).success||!Array.isArray(raw.versions)||raw.versions.length>50)throw new FlowError('NOT_AVAILABLE');
  const versions=(raw.versions as Row[]).map(row=>{
   const parsed=(row.renderSchemaVersion===3?PaidSimpleRender.omit({versionId:true}):PaidCustomerFieldRender.omit({versionId:true})).safeParse(row.snapshot);
   if(row.tenantId!==tenant||row.flowId!==flow||![3,5].includes(row.renderSchemaVersion)||!parsed.success||!parsed.data.publication||!Uuid.safeParse(row.versionId).success||!/^\d+$/.test(row.sourceRevision))throw new FlowError('NOT_AVAILABLE');
   const render=parsed.data,metadata=render.publication!,revision=Number(row.sourceRevision);
   if(!Number.isSafeInteger(revision)||revision!==metadata.draftRevision||row.serviceId!==render.service.id||!isDeepStrictEqual(row.boundSnapshot,render.service)||!isDeepStrictEqual(row.config,{key:row.renderSchemaVersion===3?'paid_simple':'paid_customer_field',steps:[{key:'service',kind:'info',title:render.service.name}]}))throw new FlowError('NOT_AVAILABLE');
   let publication:z.infer<typeof Receipt>|null=null;
   if(Array.isArray(row.installations)&&row.installations.length===1){const installation=Installation.safeParse(row.installations[0]);if(installation.success&&installation.data.allowedOrigins.every(o=>approvedOrigins.includes(o))){const receipt=Receipt.safeParse({versionId:row.versionId,installationId:installation.data.installationId,renderSchemaVersion:row.renderSchemaVersion,hostedPath:`/checkout/flow/${installation.data.installationId}`});if(receipt.success)publication=receipt.data;}}
   return{versionId:row.versionId,renderSchemaVersion:row.renderSchemaVersion,draftRevision:revision,name:metadata.name,presentation:metadata.presentation,current:row.versionId===raw.currentVersionId,publication,...('customerFields' in render?{customerFields:render.customerFields}:{})};
  });
  const parsed=CustomerFieldVersionHistory.safeParse({flowId:flow,versions});if(!parsed.success||parsed.data.versions.find(v=>v.current)?.renderSchemaVersion!==raw.currentSchema)throw new FlowError('NOT_AVAILABLE');await client.query('commit');return parsed.data;
 }catch(error){await client.query('rollback').catch(()=>{});if(error instanceof FlowError)throw error;const code=(error as {code?:unknown})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':'INTERNAL_ERROR');}finally{client.release();}
};}

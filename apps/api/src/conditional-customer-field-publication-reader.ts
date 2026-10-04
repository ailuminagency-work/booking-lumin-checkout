import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PaidConditionalCustomerFieldRender} from '@lumin/workflow';
import {Uuid,Origin} from './contracts';
import {FlowError} from './repository';

export const ConditionalCustomerFieldPublicationReceipt=z.object({
 flowId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
 publication:z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(6),hostedPath:z.string()}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`),
}).strict();
export type ConditionalCustomerFieldPublicationReceipt=z.infer<typeof ConditionalCustomerFieldPublicationReceipt>;
export type ConditionalCustomerFieldPublicationReader=(actor:string,tenant:string,flow:string)=>Promise<ConditionalCustomerFieldPublicationReceipt|null>;
const Row=z.object({tenantId:Uuid,flowId:Uuid,versionId:Uuid,sourceRevision:z.string().regex(/^[1-9][0-9]*$/),renderSchemaVersion:z.literal(6),snapshot:PaidConditionalCustomerFieldRender.omit({versionId:true}),config:z.unknown(),serviceId:Uuid,boundSnapshot:z.unknown(),installations:z.array(z.object({installationId:Uuid,allowedOrigins:z.array(Origin).min(1).max(20)}).strict()).max(2)}).strict();
/** Read-only immutable evidence. Absence never grants publication retry authority. */
export function createConditionalCustomerFieldPublicationReader(pool:Pool,approvedOrigins:readonly string[]):ConditionalCustomerFieldPublicationReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read');await client.query('set local role service_role');
  const result=await client.query('select public.owner_conditional_customer_field_publication($1::uuid,$2::uuid,$3::uuid) result',[actor,tenant,flow]);
  const parsed=Row.safeParse(result.rows[0]?.result);let receipt:ConditionalCustomerFieldPublicationReceipt|null=null;
  if(parsed.success){const row=parsed.data,render=row.snapshot,revision=Number(row.sourceRevision),installation=row.installations[0];
   if(row.tenantId===tenant&&row.flowId===flow&&Number.isSafeInteger(revision)&&revision===render.publication.draftRevision&&row.serviceId===render.service.id&&isDeepStrictEqual(row.boundSnapshot,render.service)
    &&isDeepStrictEqual(row.config,{key:'paid_conditional_customer_field',steps:[{key:'service',kind:'info',title:render.service.name}]})
    &&row.installations.length===1&&installation&&new Set(installation.allowedOrigins).size===installation.allowedOrigins.length&&installation.allowedOrigins.every(o=>approvedOrigins.includes(o))){
    receipt=ConditionalCustomerFieldPublicationReceipt.parse({flowId:flow,draftRevision:revision,publication:{versionId:row.versionId,installationId:installation.installationId,renderSchemaVersion:6,hostedPath:`/checkout/flow/${installation.installationId}`}});
   }
  }
  await client.query('commit');return receipt;
 }catch(error){await client.query('rollback').catch(()=>{});if(['42501','P0002'].includes(String((error as {code?:unknown})?.code)))return null;throw new FlowError('INTERNAL_ERROR');}finally{client.release();}
};}

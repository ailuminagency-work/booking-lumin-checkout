import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PaidCustomerFieldRender} from '@lumin/workflow';
import {Uuid} from './contracts';
import {FlowError} from './repository';

export const CustomerFieldPublicationReceipt=z.object({
 flowId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
 publication:z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(5),hostedPath:z.string()}).strict()
  .refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`),
}).strict();
export type CustomerFieldPublicationReceipt=z.infer<typeof CustomerFieldPublicationReceipt>;
export type CustomerFieldPublicationReader=(actor:string,tenant:string,flow:string)=>Promise<CustomerFieldPublicationReceipt|null>;
type Row={tenantId:string;flowId:string;versionId:string;installationId:string;sourceRevision:string;renderSchemaVersion:number;snapshot:unknown;config:unknown;allowedOrigins:unknown};

/** Existing current publication evidence only. It cannot authorize retry, create a
 * capability, reprice a booking, or disclose submitted customer information. */
export function createCustomerFieldPublicationReader(pool:Pool,approvedOrigins:readonly string[]):CustomerFieldPublicationReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read read only');
  await client.query('set local role service_role');
  const result=await client.query<Row>(`select t.id as "tenantId",f.id as "flowId",v.id as "versionId",i.id as "installationId",
    v.source_revision::text as "sourceRevision",v.render_schema_version as "renderSchemaVersion",v.paid_snapshot as snapshot,
    v.config,i.allowed_origins as "allowedOrigins"
   from public.tenants t
   join public.flows f on f.tenant_id=t.id and f.id=$3::uuid and f.status='active'
   join public.flow_versions v on v.tenant_id=t.id and v.flow_id=f.id and v.id=f.published_version_id
   join public.flow_installations i on i.tenant_id=t.id and i.flow_id=f.id and i.version_id=v.id
   where t.id=$1::uuid and t.status='active' and v.render_schema_version=5
    and exists(select 1 from public.tenant_members m where m.tenant_id=t.id and m.user_id=$2::uuid and m.role='BUSINESS_OWNER')
   limit 2`,[tenant,actor,flow]);
  let receipt:CustomerFieldPublicationReceipt|null=null;
  if(result.rows.length===1){
   const row=result.rows[0]!,snapshot=PaidCustomerFieldRender.omit({versionId:true}).safeParse(row.snapshot);
   if(row.tenantId===tenant&&row.flowId===flow&&row.renderSchemaVersion===5&&snapshot.success&&/^\d+$/.test(row.sourceRevision)){
    const render=snapshot.data,revision=Number(row.sourceRevision),origins=row.allowedOrigins;
    const config={key:'paid_customer_field',steps:[{key:'service',kind:'info',title:render.service.name}]};
    if(revision===render.publication.draftRevision&&isDeepStrictEqual(row.config,config)
      &&Array.isArray(origins)&&origins.length>0&&origins.length<=20&&new Set(origins).size===origins.length&&origins.every(o=>typeof o==='string'&&approvedOrigins.includes(o))){
     const parsed=CustomerFieldPublicationReceipt.safeParse({flowId:flow,draftRevision:revision,publication:{versionId:row.versionId,installationId:row.installationId,renderSchemaVersion:5,hostedPath:`/checkout/flow/${row.installationId}`}});
     if(parsed.success)receipt=parsed.data;
    }
   }
  }
  await client.query('commit');return receipt;
 }catch{await client.query('rollback').catch(()=>{});throw new FlowError('INTERNAL_ERROR');}finally{client.release();}
};}

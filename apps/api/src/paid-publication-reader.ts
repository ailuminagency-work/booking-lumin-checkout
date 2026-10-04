import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidSimpleRender} from '@lumin/workflow';
import {Uuid} from './contracts';
import {FlowError} from './repository';

export const PaidPublicationReceipt=z.object({
 versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(3),hostedPath:z.string(),
}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`);
export type PaidPublicationReceipt=z.infer<typeof PaidPublicationReceipt>;
export type PaidPublicationReader=(actor:string,tenant:string,flow:string)=>Promise<PaidPublicationReceipt|null>;

/** Recovery is a read of existing publication evidence, never permission to retry
 * publication. Absence, legacy versions and ambiguous installation bindings all
 * return null. Current membership is explicit because service_role bypasses RLS.
 * Installations have no enabled flag: only the active flow's current version is
 * eligible. No private capability function or publication writer is invoked. */
export function createPaidPublicationReader(pool:Pool):PaidPublicationReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin read only');
  await client.query('set local role service_role');
  const result=await client.query<{
   tenantId:string;flowId:string;versionId:string;installationId:string;renderSchemaVersion:number;snapshot:unknown;
  }>(`select t.id as "tenantId",f.id as "flowId",v.id as "versionId",i.id as "installationId",
            v.render_schema_version as "renderSchemaVersion",v.paid_snapshot as snapshot
       from public.tenants t
       join public.flows f on f.tenant_id=t.id and f.id=$3::uuid and f.status='active'
       join public.flow_versions v on v.tenant_id=t.id and v.flow_id=f.id and v.id=f.published_version_id
       join public.flow_installations i on i.tenant_id=t.id and i.flow_id=f.id and i.version_id=v.id
      where t.id=$1::uuid and t.status='active' and v.render_schema_version=3
        and exists(select 1 from public.tenant_members m
                    where m.tenant_id=t.id and m.user_id=$2::uuid and m.role='BUSINESS_OWNER')
      limit 2`,[tenant,actor,flow]);
  let receipt:PaidPublicationReceipt|null=null;
  if(result.rows.length===1){
   const row=result.rows[0]!;
   const snapshot=PaidSimpleRender.omit({versionId:true}).safeParse(row.snapshot);
   const render=PaidSimpleRender.safeParse(snapshot.success?{...snapshot.data,versionId:row.versionId}:null);
   if(row.tenantId===tenant&&row.flowId===flow&&row.renderSchemaVersion===3&&render.success){
    const parsed=PaidPublicationReceipt.safeParse({versionId:row.versionId,installationId:row.installationId,renderSchemaVersion:3,hostedPath:`/checkout/flow/${row.installationId}`});
    if(parsed.success)receipt=parsed.data;
   }
  }
  await client.query('commit');return receipt;
 }catch{
  await client.query('rollback').catch(()=>{});throw new FlowError('INTERNAL_ERROR');
 }finally{client.release();}
};}

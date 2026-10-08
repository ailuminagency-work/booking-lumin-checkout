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
export const PaidPublicationList=z.object({publications:z.array(z.object({flowId:Uuid,name:z.string().min(1).max(200),publication:PaidPublicationReceipt}).strict()).max(50)}).strict().refine(list=>list.publications.every((p,i)=>i===0||list.publications[i-1]!.flowId<p.flowId));
export type PaidPublicationList=z.infer<typeof PaidPublicationList>;
export type PaidPublicationListReader=(actor:string,tenant:string)=>Promise<PaidPublicationList|null>;
type PublicationRow={tenantId:string;flowId:string;versionId:string;installationId:string;renderSchemaVersion:number;snapshot:unknown};
function publicationReceipt(row:PublicationRow,tenant:string,flow:string):PaidPublicationReceipt|null{
 const snapshot=PaidSimpleRender.omit({versionId:true}).safeParse(row.snapshot);
 const render=PaidSimpleRender.safeParse(snapshot.success?{...snapshot.data,versionId:row.versionId}:null);
 if(row.tenantId!==tenant||row.flowId!==flow||row.renderSchemaVersion!==3||!render.success)return null;
 const parsed=PaidPublicationReceipt.safeParse({versionId:row.versionId,installationId:row.installationId,renderSchemaVersion:3,hostedPath:`/checkout/flow/${row.installationId}`});
 return parsed.success?parsed.data:null;
}

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
  const result=await client.query<PublicationRow>(`select t.id as "tenantId",f.id as "flowId",v.id as "versionId",i.id as "installationId",
            v.render_schema_version as "renderSchemaVersion",v.paid_snapshot as snapshot
       from public.tenants t
       join public.flows f on f.tenant_id=t.id and f.id=$3::uuid and f.status='active'
       join public.flow_versions v on v.tenant_id=t.id and v.flow_id=f.id and v.id=f.published_version_id
       join public.flow_installations i on i.tenant_id=t.id and i.flow_id=f.id and i.version_id=v.id
      where t.id=$1::uuid and t.status='active' and v.render_schema_version=3
        and exists(select 1 from public.tenant_members m
                    where m.tenant_id=t.id and m.user_id=$2::uuid and m.role='BUSINESS_OWNER')
      limit 2`,[tenant,actor,flow]);
  const receipt=result.rows.length===1?publicationReceipt(result.rows[0]!,tenant,flow):null;
  await client.query('commit');return receipt;
 }catch{
  await client.query('rollback').catch(()=>{});throw new FlowError('INTERNAL_ERROR');
 }finally{client.release();}
};}

/** Bounded discoverability of existing paid publications only. Empty results are
 * not evidence that no publication is in flight, and never grant retry authority.
 * The complete response fails closed on overflow or any ambiguous binding. */
export function createPaidPublicationListReader(pool:Pool):PaidPublicationListReader{return async(actor,tenant)=>{
 if(![actor,tenant].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read read only');
  await client.query('set local role service_role');
  const authorized=await client.query(`select t.id from public.tenants t where t.id=$1::uuid and t.status='active'
   and exists(select 1 from public.tenant_members m where m.tenant_id=t.id and m.user_id=$2::uuid and m.role='BUSINESS_OWNER')`,[tenant,actor]);
  if(authorized.rows.length!==1){await client.query('commit');return null;}
  const result=await client.query<Omit<PublicationRow,'installationId'>&{name:string;installationIds:string[]|null}>(
   `select t.id as "tenantId",f.id as "flowId",f.name,v.id as "versionId",
           v.render_schema_version as "renderSchemaVersion",v.paid_snapshot as snapshot,
           array(select i.id from public.flow_installations i
                  where i.tenant_id=t.id and i.flow_id=f.id and i.version_id=v.id order by i.id limit 2) as "installationIds"
      from public.tenants t
      join public.flows f on f.tenant_id=t.id and f.status='active'
      join public.flow_versions v on v.tenant_id=t.id and v.flow_id=f.id and v.id=f.published_version_id
     where t.id=$1::uuid and t.status='active' and v.render_schema_version=3
       and exists(select 1 from public.tenant_members m where m.tenant_id=t.id and m.user_id=$2::uuid and m.role='BUSINESS_OWNER')
     order by f.id limit 51`,[tenant,actor]);
  if(result.rows.length>50)throw new FlowError('NOT_AVAILABLE');
  const publications=result.rows.map(row=>{
   if(!Array.isArray(row.installationIds)||row.installationIds.length!==1)throw new FlowError('NOT_AVAILABLE');
   const publication=publicationReceipt({...row,installationId:row.installationIds[0]!},tenant,row.flowId);
   if(!publication)throw new FlowError('NOT_AVAILABLE');
   return{flowId:row.flowId,name:row.name,publication};
  });
  const parsed=PaidPublicationList.safeParse({publications});if(!parsed.success)throw new FlowError('NOT_AVAILABLE');
  await client.query('commit');return parsed.data;
 }catch(error){
  await client.query('rollback').catch(()=>{});
  throw error instanceof FlowError?error:new FlowError('INTERNAL_ERROR');
 }finally{client.release();}
};}

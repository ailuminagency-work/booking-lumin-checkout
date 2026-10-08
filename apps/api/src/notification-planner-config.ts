import {z} from 'zod';
import type {Pool} from 'pg';
import {NotificationPlannerReceipt,SaveNotificationPlannerConfig} from '@lumin/contracts';
export {StrictNotificationPlannerConfig,SaveNotificationPlannerConfig,NotificationPlannerReceipt} from '@lumin/contracts';
import {FlowError} from './repository';
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
export type NotificationPlannerReader=(actor:string,tenant:string)=>Promise<NotificationPlannerReceipt|null>;
export type NotificationPlannerSaver=(actor:string,tenant:string,input:SaveNotificationPlannerConfig)=>Promise<NotificationPlannerReceipt>;
const errorCode=(error:unknown)=>{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='22023'?'INVALID_REQUEST':code==='P0002'?'NOT_AVAILABLE':['40001','23505','40P01','55P03','57014'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');};
async function execute(pool:Pool,actor:string,tenant:string,input?:SaveNotificationPlannerConfig):Promise<NotificationPlannerReceipt|null>{
 const a=uuid.safeParse(actor),t=uuid.safeParse(tenant),body=input===undefined?undefined:SaveNotificationPlannerConfig.safeParse(input);
 if(!a.success||!t.success||body&&!body.success||body?.success&&body.data.config.tenantId!==t.data)throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect().catch(()=>{throw new FlowError('INTERNAL_ERROR');});let broken=false;
 try{await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
 const rows=(await client.query(input===undefined?'select public.owner_notification_planner_config($1::uuid,$2::uuid) as result':'select public.save_notification_planner_config($1::uuid,$2::uuid,$3::bigint,$4::jsonb) as result',body?.success?[a.data,t.data,body.data.expectedRevision,JSON.stringify(body.data.config)]:[a.data,t.data])).rows;
 const value=rows[0]?.result;if(rows.length!==1)throw new FlowError('INTERNAL_ERROR');
 if(input===undefined&&value===null){await client.query('commit');return null;}
 const result=NotificationPlannerReceipt.safeParse(value);if(!result.success||result.data.tenantId!==t.data||body?.success&&(result.data.revision!==body.data.expectedRevision+1||JSON.stringify(result.data.config)!==JSON.stringify(body.data.config)))throw new FlowError('INTERNAL_ERROR');
 await client.query('commit');return result.data;
 }catch(error){try{await client.query('rollback');}catch{broken=true;}throw errorCode(error);}finally{client.release(broken);}
}
export const createNotificationPlannerReader=(pool:Pool):NotificationPlannerReader=>(actor,tenant)=>execute(pool,actor,tenant);
export const createNotificationPlannerSaver=(pool:Pool):NotificationPlannerSaver=>async(actor,tenant,input)=>{if(!SaveNotificationPlannerConfig.safeParse(input).success)throw new FlowError('INVALID_REQUEST');return (await execute(pool,actor,tenant,input))!;};

export interface NotificationPlannerConfigApi {read:NotificationPlannerReader;save(actorId:string,tenantId:string,body:unknown):Promise<NotificationPlannerReceipt>}
export function createNotificationPlannerConfigApi(pool:Pool):NotificationPlannerConfigApi {return {read:createNotificationPlannerReader(pool),save:async(actor,tenant,body)=>{const parsed=SaveNotificationPlannerConfig.safeParse(body);if(!parsed.success)throw new FlowError('INVALID_REQUEST');return createNotificationPlannerSaver(pool)(actor,tenant,parsed.data);}};}

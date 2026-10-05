import {z} from 'zod';
import type {Pool} from 'pg';
import {BusinessTimezone,EVENT_NAMES,NotificationConfig} from '@lumin/contracts';
import {FlowError} from './repository';
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const channels=z.array(z.enum(['email','sms'])).max(2).refine(value=>new Set(value).size===value.length);
const locale=z.string().min(2).max(35).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
const text=(max:number,multiline=false)=>z.string().min(1).max(max).refine(value=>!(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value))&&(multiline||!/[\n\t]/.test(value))&&!/[\ud800-\udfff]/u.test(value));
const variables=new Set(['tenantName','customerName','customerEmail','bookingReference','bookingState','slotStart','slotEnd','slotDate','slotTime','customerPhone','total']);
const templateText=(max:number,multiline=false)=>text(max,multiline).refine(value=>{const rest=value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g,(_whole,key:string)=>variables.has(key)?'':'{{invalid}}');return !/[{}]/.test(rest);});
const template=z.object({trigger:z.enum([...EVENT_NAMES,'reminder']),channel:z.enum(['email','sms']),locale,subject:templateText(200).optional(),body:templateText(4000,true)}).strict().refine(value=>value.channel==='email'||value.subject===undefined);
/** Saved planner data only. Neither schema nor receipt certifies provider readiness. */
export const StrictNotificationPlannerConfig=z.object({tenantId:uuid,locale,timezone:BusinessTimezone,sender:z.object({emailFrom:z.string().email().max(254).optional(),emailFromName:text(100).optional(),smsFrom:z.string().regex(/^\+[1-9][0-9]{6,14}$/).optional()}).strict(),events:z.array(z.object({event:z.enum(EVENT_NAMES),channels}).strict()).max(EVENT_NAMES.length),reminders:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),offsetMinutes:z.number().int().min(1).max(525600),channels:channels.refine(value=>value.length>0)}).strict()).max(10),templates:z.array(template).max(50)}).strict().superRefine((value,context)=>{
 const unique=(items:string[])=>new Set(items).size===items.length;
 if(!unique(value.events.map(row=>row.event))||!unique(value.reminders.map(row=>row.id))||!unique(value.templates.map(row=>row.trigger+':'+row.channel+':'+row.locale)))context.addIssue({code:'custom',message:'Duplicate planner entries'});
 if(value.templates.some(row=>row.locale!==value.locale))context.addIssue({code:'custom',message:'Template locale must equal the saved locale'});
 const has=(trigger:string,channel:string)=>value.templates.some(row=>row.trigger===trigger&&row.channel===channel&&row.locale===value.locale);
 if(value.events.some(row=>row.channels.some(channel=>!has(row.event,channel)))||value.reminders.some(row=>row.channels.some(channel=>!has('reminder',channel))))context.addIssue({code:'custom',message:'Selected channels require explicit matching templates'});
}).refine(value=>NotificationConfig.safeParse(value).success);
export type StrictNotificationPlannerConfig=z.infer<typeof StrictNotificationPlannerConfig>;
export const SaveNotificationPlannerConfig=z.object({expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),config:StrictNotificationPlannerConfig}).strict();
export type SaveNotificationPlannerConfig=z.infer<typeof SaveNotificationPlannerConfig>;
export const NotificationPlannerReceipt=z.object({schemaVersion:z.literal(1),tenantId:uuid,revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),config:StrictNotificationPlannerConfig}).strict().refine(value=>value.tenantId===value.config.tenantId);
export type NotificationPlannerReceipt=z.infer<typeof NotificationPlannerReceipt>;
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

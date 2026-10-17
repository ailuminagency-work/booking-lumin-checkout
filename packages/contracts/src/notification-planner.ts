import {z} from 'zod';
import {BusinessTimezone} from './business-profile';
import {EVENT_NAMES} from './events';
import {NotificationConfig} from './notifications';
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

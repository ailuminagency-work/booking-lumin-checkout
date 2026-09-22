import {z} from 'zod';
const id=z.string().uuid();
export const RosterVersion=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const RosterExpectedVersion=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1);
const pgText=(s:string)=>!Array.from(s).some(c=>c==='\u0000'||(c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff));
export const RosterLabel=z.string().refine(s=>pgText(s)&&Array.from(s).length>=1&&Array.from(s).length<=160&&s.replace(/^ +| +$/g,'').length>0);
/** Exact calendar validation and microsecond comparison; never normalize invalid dates. */
export function rosterInstantMicros(s:string):bigint|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(s);if(!m)return null;
 const y=+m[1]!,mo=+m[2]!,d=+m[3]!,h=+m[4]!,mi=+m[5]!,sec=+m[6]!;const leap=y%4===0&&(y%100!==0||y%400===0);const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||mo<1||mo>12||d<1||d>days[mo-1]!||h>23||mi>59||sec>59)return null;
 const zone=m[8]!;if(zone!=='Z'&&(+zone.slice(1,3)>15||+zone.slice(4)>59))return null;
 const fraction=(m[7]??'').padEnd(6,'0');const base=Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`);if(!Number.isFinite(base))return null;
 const result=BigInt(base)*1000n+BigInt(fraction||'0');const min=BigInt(Date.parse('0001-01-01T00:00:00Z'))*1000n,max=BigInt(Date.parse('9999-12-31T23:59:59Z'))*1000n+999999n;return result>=min&&result<=max?result:null;
}
export const RosterInstant=z.string().refine(s=>rosterInstantMicros(s)!==null);
const zone=z.string().min(1).max(100); // PG registry is authoritative; no Intl restriction.
const expected={expectedRosterVersion:RosterExpectedVersion};
export const RosterWorkerInput=z.object({...expected,displayName:RosterLabel,active:z.boolean()}).strict();
export const RosterCrewInput=z.object({...expected,name:RosterLabel,active:z.boolean()}).strict();
export const RosterMemberInput=z.object({...expected,workerId:id,present:z.boolean()}).strict();
export const RosterEligibilityInput=z.object({...expected,serviceId:id,workerId:id,active:z.boolean(),create:z.boolean()}).strict();
const Shift=z.object({id,workerId:id,kind:z.enum(['available','blocked']),startsAt:RosterInstant,endsAt:RosterInstant,sourceTimeZone:zone,active:z.boolean()}).strict();
const interval=(s:{startsAt:string;endsAt:string})=>{const a=rosterInstantMicros(s.startsAt),b=rosterInstantMicros(s.endsAt);return a!==null&&b!==null&&b>a;};
export const RosterShiftInput=Shift.omit({id:true}).extend(expected).strict().refine(interval);
export const RosterProvisionReceipt=z.object({rosterVersion:RosterVersion}).strict();
export const RosterEntityReceipt=RosterProvisionReceipt.extend({entityId:id}).strict();
export const RosterMemberReceipt=RosterProvisionReceipt.extend({crewId:id,workerId:id,present:z.boolean()}).strict();
export const RosterEligibilityReceipt=RosterProvisionReceipt.extend({serviceId:id,workerId:id,active:z.boolean()}).strict();
export const RosterSnapshot=z.object({rosterVersion:RosterVersion,workers:z.array(z.object({id,displayName:RosterLabel,active:z.boolean()}).strict()).max(100),crews:z.array(z.object({id,name:RosterLabel,active:z.boolean(),workerIds:z.array(id).max(100)}).strict()).max(50),eligibility:z.array(z.object({serviceId:id,workerId:id,active:z.boolean()}).strict()).max(1000),shifts:z.array(Shift.refine(interval)).max(1000),services:z.array(z.object({id,name:z.string(),active:z.boolean()}).strict()).max(100)}).strict().superRefine((s,ctx)=>{
 const fail=()=>ctx.addIssue({code:'custom',message:'Invalid roster snapshot'});const key=(s:string)=>s.toLowerCase();
 const ordered=(ids:string[])=>ids.every((v,i)=>i===0||key(ids[i-1]!)<key(v));
 for(const list of [s.workers,s.crews,s.shifts,s.services])if(!ordered(list.map(x=>x.id)))fail();
 const workers=new Set(s.workers.map(w=>key(w.id))),services=new Set(s.services.map(x=>key(x.id)));
 if(s.crews.reduce((n,c)=>n+c.workerIds.length,0)>500)fail();
 for(const c of s.crews)if(!ordered(c.workerIds)||c.workerIds.some(w=>!workers.has(key(w))))fail();
 if(!ordered(s.eligibility.map(e=>e.serviceId+':'+e.workerId)))fail();
 for(const e of s.eligibility)if(!workers.has(key(e.workerId))||!services.has(key(e.serviceId)))fail();
 for(const shift of s.shifts)if(!workers.has(key(shift.workerId))||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(shift.startsAt)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(shift.endsAt))fail();
 const bytes=(v:string)=>new TextEncoder().encode(v).length;const serviceBytes=s.services.map(x=>bytes(x.name));if(serviceBytes.some(n=>n>4096)||serviceBytes.reduce((a,b)=>a+b,0)>65536)fail();
 const total=serviceBytes.reduce((a,b)=>a+b,0)+s.workers.reduce((n,w)=>n+bytes(w.displayName),0)+s.crews.reduce((n,c)=>n+bytes(c.name),0)+s.shifts.reduce((n,x)=>n+bytes(x.sourceTimeZone)+bytes(x.kind),0);if(total>131072)fail();
});
export type RosterSnapshot=z.infer<typeof RosterSnapshot>;
/** Use at untrusted snapshot boundaries before schema parsing/serialization. */
export function parseRosterSnapshot(value:unknown):RosterSnapshot{
 const pending=[value],seen=new Set<object>();let nodes=0,bytes=0;
 while(pending.length){const v=pending.pop();if(++nodes>30000)throw Error('INVALID_ROSTER_SNAPSHOT');
  if(typeof v==='string'){if(!pgText(v)||v.length>524288)throw Error('INVALID_ROSTER_SNAPSHOT');bytes+=new TextEncoder().encode(v).length;if(bytes>524288)throw Error('INVALID_ROSTER_SNAPSHOT');}
  else if(v&&typeof v==='object'){
   if(seen.has(v)||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))throw Error('INVALID_ROSTER_SNAPSHOT');seen.add(v);
   if(Array.isArray(v)&&v.length>1000)throw Error('INVALID_ROSTER_SNAPSHOT');
   const keys=Reflect.ownKeys(v);if(keys.length>1001||(Array.isArray(v)&&keys.length!==v.length+1))throw Error('INVALID_ROSTER_SNAPSHOT');
   for(const k of keys){if(k==='length'&&Array.isArray(v))continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d||!('value'in d)||!d.enumerable)throw Error('INVALID_ROSTER_SNAPSHOT');pending.push(k,d.value);}
  }
 }
 const result=RosterSnapshot.parse(value);if(new TextEncoder().encode(JSON.stringify(result)).length>524288)throw Error('INVALID_ROSTER_SNAPSHOT');return result;
}
export type RosterWorkerInput=z.infer<typeof RosterWorkerInput>;
export type RosterCrewInput=z.infer<typeof RosterCrewInput>;
export type RosterMemberInput=z.infer<typeof RosterMemberInput>;
export type RosterEligibilityInput=z.infer<typeof RosterEligibilityInput>;
export type RosterShiftInput=z.infer<typeof RosterShiftInput>;

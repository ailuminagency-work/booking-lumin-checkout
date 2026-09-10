/** Server-only local planning DTOs. Not exported from the browser package. */
export type PlanningActorContext=Readonly<{mode:'local_synthetic';userId:string}>;
export type PlanningAllocationRequest=Readonly<{tenantId:string;bookingId:string;crewId:string;targetGeneration:number}>;
export type PlanningAllocationReceipt=Readonly<{schemaVersion:1;groupId:string;generation:number;bookingId:string;status:'held'|'released'|'expired';usable:boolean;expiresAt:string;bookingState:'draft';confirmed:false}>;
export type FailureCode='INVALID_REQUEST'|'FORBIDDEN'|'NOT_FOUND'|'UNSUPPORTED_SCHEDULE'|'LIMIT_EXCEEDED'|'GENERATION_CONFLICT'|'EVIDENCE_CHANGED'|'UNAVAILABLE'|'CORRUPT_STATE'|'PROTOCOL_ERROR'|'DEADLINE'|'ABORTED'|'ACQUISITION_TIMEOUT'|'CONNECTION_FAILED'|'SERVER_TIMEOUT'|'DEADLOCK'|'LOCK_TIMEOUT'|'INTERNAL_ERROR';
export type PlanningAllocationOutcome=
 |Readonly<{kind:'committed';delivery:'receipt';receipt:PlanningAllocationReceipt}>
 |Readonly<{kind:'committed';delivery:'withheld';receipt:null;reason:'ABORTED'|'DEADLINE'|'CLOCK_UNAVAILABLE'}>
 |Readonly<{kind:'failed';code:FailureCode;transaction:'not_started'|'no_commit_submitted'|'rolled_back';backendMayStillRun:boolean}>
 |Readonly<{kind:'unknown_commit';code:'COMMIT_UNCERTAIN';receipt:null;reconciliation:'REAUTHORIZE_SAME_TARGET'}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function planningRecord(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('INVALID_SHAPE');
 const descriptors=Object.getOwnPropertyDescriptors(value);const own=Reflect.ownKeys(value);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k))||keys.some(k=>!descriptors[k]||!('value' in descriptors[k])||!descriptors[k].enumerable))throw Error('INVALID_SHAPE');
 return Object.fromEntries(keys.map(k=>[k,descriptors[k]!.value]));
}
function uuid(v:unknown):v is string{return typeof v==='string'&&UUID.test(v);}
export function copyPlanningInput(actor:unknown,input:unknown):readonly[PlanningActorContext,PlanningAllocationRequest]{
 const a=planningRecord(actor,['mode','userId']);const r=planningRecord(input,['tenantId','bookingId','crewId','targetGeneration']);
 if(a.mode!=='local_synthetic'||!uuid(a.userId)||!uuid(r.tenantId)||!uuid(r.bookingId)||!uuid(r.crewId)||!Number.isSafeInteger(r.targetGeneration)||Number(r.targetGeneration)<1)throw Error('INVALID_INPUT');
 return [Object.freeze(a) as PlanningActorContext,Object.freeze(r) as PlanningAllocationRequest];
}
/** Exact proleptic Gregorian epoch microseconds, including years 0001..0099. */
export function planningExpiryMicroseconds(value:unknown):bigint{
 if(typeof value!=='string')throw Error('INVALID_DATE');
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);if(!m)throw Error('INVALID_DATE');
 const [y,month,d,h,min,sec,micro]=m.slice(1).map(Number) as [number,number,number,number,number,number,number];const leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||d<1||d>days[month-1]!||h>23||min>59||sec>59)throw Error('INVALID_DATE');
 const years=y-1;const before=365*years+Math.floor(years/4)-Math.floor(years/100)+Math.floor(years/400)+days.slice(0,month-1).reduce((a,b)=>a+b,0)+d-1;
 return BigInt(before-719162)*86400000000n+BigInt(h*3600+min*60+sec)*1000000n+BigInt(micro);
}
export function parsePlanningReceipt(result:unknown,request:PlanningAllocationRequest):PlanningAllocationReceipt{
 if(!result||typeof result!=='object')throw Error('INVALID_RESULT');
 // Driver result contains metadata beyond these public properties; JSON rows do not.
 const r=result as {command?:unknown;rowCount?:unknown;rows?:unknown};
 if(r.command!=='SELECT'||r.rowCount!==1||!Array.isArray(r.rows)||r.rows.length!==1)throw Error('INVALID_RESULT');
 const row=planningRecord(r.rows[0],['result']);
 const dto=planningRecord(row.result,['schemaVersion','groupId','generation','bookingId','status','usable','expiresAt','bookingState','confirmed']);
 if(dto.schemaVersion!==1||!uuid(dto.groupId)||!Number.isSafeInteger(dto.generation)||dto.generation!==request.targetGeneration||!uuid(dto.bookingId)||dto.bookingId!==request.bookingId||typeof dto.status!=='string'||!['held','released','expired'].includes(dto.status)||typeof dto.usable!=='boolean'||dto.bookingState!=='draft'||dto.confirmed!==false||(dto.status!=='held'&&dto.usable))throw Error('INVALID_RECEIPT');
 planningExpiryMicroseconds(dto.expiresAt);
 if(Buffer.byteLength(JSON.stringify(dto),'utf8')>2048)throw Error('INVALID_RECEIPT');
 return Object.freeze(dto) as PlanningAllocationReceipt;
}

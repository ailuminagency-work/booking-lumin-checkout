import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createExistingModeSessionValidator as create, EXISTING_SESSION_VALIDATION_SQL as SQL } from '../server/mode-session-validation';
import { createLocalModeSessionAdmission } from '../server/mode-session-admission';
import type { ModeSessionClock } from '../server/mode-session-repository';
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const profile = { profileVersion: 'local-v1', rendererOrigin: 'https://render.example', apiOrigin: 'https://api.example', portalOrigin: 'https://portal.example', loaderUrl: 'https://render.example/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' };
const request = { installationId: uuid(1), deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: null, expectedVersionId: uuid(2), expectedTargetRevision: 1, expectedPolicyRevision: 1 };
const actor = { mode: 'local_synthetic', userId: uuid(4) }, historyRequest = { tenantId: uuid(3), flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 10 };
const render = { versionId: uuid(2), config: { key: 'cleaning', steps: [{ key: 'rooms', questionKey: 'rooms', kind: 'question', required: true }] }, service: { id: uuid(5), name: 'Cleaning', durationMinutes: 60, questions: [{ id: 'rooms', prompt: 'Rooms', kind: 'quantity', required: true, choices: [], minQty: 0, maxQty: 10000 }] } };
const issued = { schemaVersion: 1, sessionId: uuid(6), installationId: uuid(1), mode: 'hosted', deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: null, versionId: uuid(2), targetRevision: 1, policyRevision: 1, issuedAt: '2026-09-10T12:00:00.000000Z', expiresAt: '2026-09-10T12:15:00.000000Z', render };

const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v));
const input = () => ({ tokenHash: 'a'.repeat(64), request: clone(request), baseline: { sessionId: issued.sessionId, issuedAt: issued.issuedAt, expiresAt: issued.expiresAt } });
const deferred = <T>() => { let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject}; };
const tick = async () => { for(let i=0;i<60;i++)await Promise.resolve(); };
class Clock implements ModeSessionClock {
 now=0;epoch=Date.parse(issued.issuedAt); timers=new Map<object,{fn:()=>void,at:number}>();
 monotonic=()=>this.now;wall=()=>this.epoch;
 setTimer=(fn:()=>void,ms:number)=>{const h={};this.timers.set(h,{fn,at:this.now+ms});return h;};
 clearTimer=(h:unknown)=>{this.timers.delete(h as object);};
 advance(ms:number){this.now+=ms;this.epoch+=ms;for(const[h,t]of [...this.timers])if(t.at<=this.now){this.timers.delete(h);t.fn();}}
}
class Client extends EventEmitter {
 calls:Array<{sql:string,values?:unknown[]}>=[];releases:Array<Error|undefined>=[];value:any=clone(issued);
 hook?:(sql:string)=>unknown;releaseHook?:()=>void;
 async query(sql:string,values?:unknown[]){this.calls.push({sql,values});const result=this.hook?.(sql);if(result!==undefined)return await result;return{command:sql.startsWith('SELECT')?'SELECT':sql.startsWith('SET')?'SET':sql.startsWith('BEGIN')?'BEGIN':sql,rowCount:sql.startsWith('SELECT')?1:null,rows:sql.startsWith('SELECT')?[{result:this.value}]:[]};}
 release(error?:Error){this.releases.push(error);this.releaseHook?.();if(error)this.emit('end');}
}
class Pool extends EventEmitter {
 calls=0;ends=0;clients:Client[]=[];hook?:()=>Promise<Client>;configure?:(c:Client)=>void;
 async connect(){this.calls++;if(this.hook)return this.hook();const c=new Client();this.configure?.(c);this.clients.push(c);return c;}
 async end(){this.ends++;}
}
function setup(shared=false){const pool=new Pool(),clock=new Clock();const admission=shared?createLocalModeSessionAdmission(pool,clock):undefined;const validator=create({pool:admission?.pool??pool,profiles:[profile],clock});return{pool,clock,admission,validator};}
const sqlError=(code:string,message:string)=>Object.assign(Error(message),{code});

describe('existing session validation shape and exact transaction',()=>{
 it('returns a copied pinned receipt and sends only the eleven-argument no-create read',async()=>{
  const s=setup();const out=await s.validator.validateExisting(input());expect(out).toEqual({kind:'completed',delivery:'data',data:issued});expect(Object.isFrozen(out)).toBe(true);
  const c=s.pool.clients[0]!;expect(c.calls.map(x=>x.sql)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'",'SET LOCAL ROLE service_role',SQL,'SET CONSTRAINTS ALL IMMEDIATE','COMMIT']);
  expect(c.calls[5]!.values).toEqual(['a'.repeat(64),issued.sessionId,request.installationId,request.rendererOrigin,null,profile.profileVersion,request.expectedVersionId,1,1,issued.issuedAt,issued.expiresAt]);expect(c.releases).toEqual([undefined]);expect(s.clock.timers.size).toBe(0);expect(c.listenerCount('error')).toBe(0);s.validator.close();expect(s.pool.ends).toBe(0);
 });
 it.each(['extra','hash','upper-id','timestamp','lifetime','profile','request-extra','undefined'] as const)('rejects invalid %s without connect',async kind=>{
  const s=setup(),v:any=input();if(kind==='extra')v.extra=true;if(kind==='hash')v.tokenHash='A'.repeat(64);if(kind==='upper-id')v.baseline.sessionId='ABCDEF00-0000-0000-0000-000000000001';if(kind==='timestamp')v.baseline.expiresAt='2026-09-10T12:15:00.000Z';if(kind==='lifetime')v.baseline.expiresAt=issued.issuedAt;if(kind==='profile')v.request.deploymentProfileVersion='other';if(kind==='request-extra')v.request.extra=1;
  expect(await s.validator.validateExisting(kind==='undefined'?undefined:v)).toEqual({kind:'failed',code:'INVALID_REQUEST',data:null,transaction:'not_started',backendMayStillRun:false});expect(s.pool.calls).toBe(0);s.validator.close();
 });
 it.each(['getter','proxy','cycle','oversize'] as const)('rejects hostile %s without invoking callbacks',async kind=>{
  const s=setup(),v:any=input(),spy=vi.fn(()=>{throw Error('secret');});if(kind==='getter')Object.defineProperty(v,'tokenHash',{get:spy});if(kind==='cycle')v.baseline=v;if(kind==='oversize')v.tokenHash='x'.repeat(8193);const raw=kind==='proxy'?new Proxy(v,{get:spy,ownKeys:spy}):v;
  expect(await s.validator.validateExisting(raw)).toMatchObject({kind:'failed',code:'INVALID_REQUEST'});expect(spy).not.toHaveBeenCalled();expect(s.pool.calls).toBe(0);
 });
 it.each(['sessionId','issuedAt','expiresAt','installationId','versionId','render','extra'] as const)('withholds corrupt receipt %s',async field=>{
  const s=setup();s.pool.configure=c=>{if(field==='extra')c.value.extra=1;else if(field==='render')c.value.render.service.questions=[];else if(field==='issuedAt')c.value.issuedAt='2026-09-10T12:00:00.000001Z';else if(field==='expiresAt')c.value.expiresAt='2026-09-10T12:15:00.000001Z';else c.value[field]=uuid(99);};
  expect(await s.validator.validateExisting(input())).toMatchObject({kind:'failed',code:'INTERNAL_ERROR',data:null,transaction:'no_commit_submitted',backendMayStillRun:true});expect(s.pool.clients[0]!.calls.some(x=>x.sql==='COMMIT')).toBe(false);
 });
 it('binds original historical target instead of changing the input from current policy',async()=>{const s=setup();const v=input();v.request.expectedTargetRevision=3;s.pool.configure=c=>{c.value.targetRevision=3;};expect(await s.validator.validateExisting(v)).toMatchObject({kind:'completed',delivery:'data'});});
});

describe('read certainty and actual shared quarantine',()=>{
 it.each([['42501','MODE_SESSION_FORBIDDEN','FORBIDDEN'],['22023','MODE_SESSION_INVALID','INVALID_REQUEST'],['22023','MODE_SESSION_INVALID_ORIGIN','INVALID_REQUEST'],['40P01','DEADLOCK','DEADLOCK'],['55P03','LOCK_TIMEOUT','LOCK_TIMEOUT'],['57014','SERVER_TIMEOUT','SERVER_TIMEOUT'],['42501','FORBIDDEN','INTERNAL_ERROR'],['40001','MODE_REQUEST_CONFLICT','INTERNAL_ERROR'],['55000','secret','INTERNAL_ERROR']])('maps %s/%s',async(code,label,expected)=>{
  const s=setup(true);s.pool.configure=c=>{c.hook=sql=>{if(sql===SQL)throw sqlError(code!,label!);};};expect(await s.validator.validateExisting(input())).toEqual({kind:'failed',code:expected,data:null,transaction:'no_commit_submitted',backendMayStillRun:true});expect(s.pool.clients[0]!.calls.some(x=>x.sql==='ROLLBACK')).toBe(false);expect(s.admission!.snapshot().quarantined).toBe(1);s.validator.close();await s.admission!.close();
 });
 it.each(['ROLLBACK','COMMIT','bad','reject'] as const)('classifies COMMIT response %s',async tag=>{
  const s=setup(true);s.pool.configure=c=>{c.hook=sql=>{if(sql==='COMMIT')return tag==='reject'?Promise.reject(Error('private')):{command:tag};};};const out=await s.validator.validateExisting(input());if(tag==='ROLLBACK')expect(out).toEqual({kind:'failed',code:'INTERNAL_ERROR',data:null,transaction:'rolled_back',backendMayStillRun:false});else if(tag==='COMMIT')expect(out).toMatchObject({kind:'completed',delivery:'data'});else expect(out).toEqual({kind:'completion_uncertain',code:'READ_COMPLETION_UNCERTAIN',data:null,backendMayStillRun:true});s.validator.close();await s.admission!.close();
 });
 it('exhausts eight denied leases and never retries rollback or replaces pool',async()=>{
  const s=setup(true);s.pool.configure=c=>{c.hook=sql=>{if(sql===SQL)throw sqlError('42501','MODE_SESSION_FORBIDDEN');};};for(let i=0;i<8;i++)expect(await s.validator.validateExisting(input())).toMatchObject({code:'FORBIDDEN'});expect(await s.validator.validateExisting(input())).toMatchObject({code:'CONNECTION_FAILED',transaction:'not_started',backendMayStillRun:false});expect(s.pool.calls).toBe(8);expect(s.admission!.snapshot()).toMatchObject({quarantined:8,free:0});s.validator.close();await s.admission!.close();
 });
 it('distinguishes masked raw release throw from observable wrapper release throw',async()=>{
  for(const shared of [false,true]){const s=setup(shared);s.pool.configure=c=>{c.releaseHook=()=>{throw Error('private');};};const out=await s.validator.validateExisting(input());expect(out).toMatchObject(shared?{kind:'completed',delivery:'data'}:{kind:'completed',delivery:'withheld',reason:'CONNECTION_FAILED',data:null});if(shared)expect(s.admission!.snapshot().quarantined).toBe(1);s.validator.close();await s.admission?.close();}
 });
});

describe('logical reservations, clocks and final settlement',()=>{
 it('reserves two before connect and rejects third without queue',async()=>{const s=setup(true),gate=deferred<Client>();s.pool.hook=()=>gate.promise;const a=s.validator.validateExisting(input()),b=s.validator.validateExisting(input());expect(await s.validator.validateExisting(input())).toMatchObject({code:'CONTEXT_BUSY'});expect(s.pool.calls).toBe(2);s.validator.close();expect(await a).toMatchObject({code:'CLOSED',transaction:'not_started'});expect(await b).toMatchObject({code:'CLOSED'});gate.reject(Error('private'));await tick();expect(s.admission!.snapshot().quarantined).toBe(2);await s.admission!.close();});
 it.each([2999,3000] as const)('observes acquisition boundary %s',async ms=>{const s=setup(),gate=deferred<Client>();s.pool.hook=()=>gate.promise;const result=s.validator.validateExisting(input());s.clock.now=ms;s.clock.epoch+=ms;const c=new Client();gate.resolve(c);const out=await result;expect(out).toMatchObject(ms===2999?{kind:'completed'}:{code:'ACQUISITION_TIMEOUT',transaction:'not_started'});if(ms===3000)expect(c.calls).toHaveLength(0);});
 it.each([9999,10000] as const)('samples after COMMIT cleanup at %s',async ms=>{const s=setup();s.pool.configure=c=>{c.releaseHook=()=>{s.clock.now=ms;};};const out=await s.validator.validateExisting(input());expect(out).toMatchObject(ms===9999?{kind:'completed',delivery:'data'}:{kind:'completed',delivery:'withheld',reason:'DEADLINE'});});
 it.each([0,1] as const)('samples final wall expiry with %s ms remaining',async remaining=>{const s=setup();s.pool.configure=c=>{c.releaseHook=()=>{s.clock.epoch=Date.parse(issued.expiresAt)-remaining;};};const out=await s.validator.validateExisting(input());expect(out).toMatchObject(remaining?{delivery:'data'}:{kind:'completed',delivery:'withheld',reason:'EXPIRED'});});
 it('floors submillisecond remaining lifetime to immediate expiry without SQL',async()=>{const s=setup(),v=input();v.baseline.issuedAt='2026-09-10T12:00:00.000500Z';v.baseline.expiresAt='2026-09-10T12:15:00.000500Z';s.clock.epoch=Date.parse(issued.expiresAt);expect(await s.validator.validateExisting(v)).toMatchObject({code:'EXPIRED',transaction:'not_started'});expect(s.pool.calls).toBe(0);});
 it('does not add issuedAt-before-now validation',async()=>{const s=setup();s.clock.epoch-=1000;expect(await s.validator.validateExisting(input())).toMatchObject({delivery:'data'});});
 it.each(['negative','nan','throw','wall-regress'] as const)('terminally rejects clock %s and never rebases',async kind=>{const s=setup();if(kind==='negative')s.clock.now=-1;if(kind==='nan')s.clock.now=NaN;if(kind==='throw'){const t=setup();t.clock.monotonic=()=>{throw Error();};/* captured methods cannot be replaced */expect(await t.validator.validateExisting(input())).toMatchObject({delivery:'data'});s.clock.now=Infinity;}if(kind==='wall-regress'){expect(await s.validator.validateExisting(input())).toMatchObject({delivery:'data'});s.clock.epoch--;}
 expect(await s.validator.validateExisting(input())).toMatchObject({code:'CLOCK_UNAVAILABLE'});s.clock.now=100;s.clock.epoch=Date.parse(issued.issuedAt)+100;expect(await s.validator.validateExisting(input())).toMatchObject({code:'CLOCK_UNAVAILABLE'});});
 it('contains timer clear failure, terminally stops siblings and withholds known COMMIT',async()=>{const pool=new Pool(),clock=new Clock();let clears=0;clock.clearTimer=h=>{clock.timers.delete(h as object);if(++clears===2)throw Error('private');};const validator=create({pool,profiles:[profile],clock});expect(await validator.validateExisting(input())).toMatchObject({kind:'completed',delivery:'withheld',reason:'CLOCK_UNAVAILABLE'});expect(await validator.validateExisting(input())).toMatchObject({code:'CLOCK_UNAVAILABLE'});validator.close();});
 it('contains synchronous timer firing and cleans the handle returned afterward',async()=>{const pool=new Pool(),clock=new Clock();clock.setTimer=(fn,_ms)=>{const h={};clock.timers.set(h,{fn,at:0});fn();return h;};const validator=create({pool,profiles:[profile],clock});expect(await validator.validateExisting(input())).toMatchObject({code:'DEADLINE'});expect(pool.calls).toBe(0);expect(clock.timers.size).toBe(0);});
});

describe('late ownership and stop-only close',()=>{
 it.each(['BEGIN','SELECT','COMMIT'] as const)('late %s cannot mutate a later successful validation',async phase=>{
  const s=setup(true),gate=deferred<unknown>();let first=true;s.pool.configure=c=>{if(first){first=false;c.hook=sql=>{if(sql.startsWith(phase))return gate.promise;};}};const result=s.validator.validateExisting(input());await tick();s.clock.advance(10000);expect(await result).toMatchObject(phase==='COMMIT'?{kind:'completion_uncertain'}:{kind:'failed',code:'DEADLINE',transaction:'no_commit_submitted'});
  const next=await s.validator.validateExisting(input());expect(next).toMatchObject({delivery:'data'});const before=s.admission!.snapshot();gate.resolve({command:phase,rows:[],rowCount:0});await tick();expect(s.admission!.snapshot()).toEqual(before);expect(next).toMatchObject({delivery:'data'});s.validator.close();await s.admission!.close();
 });
 it('aborts native signals and rejects fake or accessor options without invocation',async()=>{const s=setup();const c=new AbortController();c.abort();expect(await s.validator.validateExisting(input(),{signal:c.signal})).toMatchObject({code:'ABORTED'});expect(await s.validator.validateExisting(input(),{signal:{} as AbortSignal})).toMatchObject({code:'INVALID_REQUEST'});const spy=vi.fn();const options=Object.defineProperty({},'signal',{get:spy});expect(await s.validator.validateExisting(input(),options)).toMatchObject({code:'INVALID_REQUEST'});expect(spy).not.toHaveBeenCalled();expect(s.pool.calls).toBe(0);});
 it('close returns void, stops every call and never ends shared pool',async()=>{const s=setup(),gate=deferred<Client>();s.pool.hook=()=>gate.promise;const a=s.validator.validateExisting(input()),b=s.validator.validateExisting(input());expect(s.validator.close()).toBeUndefined();expect(s.validator.close()).toBeUndefined();expect(await a).toMatchObject({code:'CLOSED'});expect(await b).toMatchObject({code:'CLOSED'});expect(s.pool.ends).toBe(0);expect(s.pool.listenerCount('error')).toBe(0);expect(await s.validator.validateExisting(input())).toMatchObject({code:'CLOSED'});gate.reject(Error('private'));await tick();});
});

describe('acquisition cleanup boundary and captured clocks',()=>{
 it.each([2999,3000] as const)('keeps acquisition ownership through timer cleanup at %s',async at=>{
  const pool=new Pool(),clock=new Clock();let clears=0;clock.clearTimer=h=>{clock.timers.delete(h as object);if(++clears===1)clock.now=at;};const validator=create({pool,profiles:[profile],clock});
  expect(await validator.validateExisting(input())).toMatchObject(at===2999?{delivery:'data'}:{code:'ACQUISITION_TIMEOUT',transaction:'not_started',backendMayStillRun:false});if(at===3000)expect(pool.clients[0]!.calls).toHaveLength(0);validator.close();
 });
 it.each(['monotonic','wall','setTimer'] as const)('terminally handles captured %s throwing',async method=>{
  const pool=new Pool(),clock=new Clock();clock[method]=(()=>{throw Error('private');}) as any;const validator=create({pool,profiles:[profile],clock});expect(await validator.validateExisting(input())).toMatchObject({code:'CLOCK_UNAVAILABLE'});expect(await validator.validateExisting(input())).toMatchObject({code:'CLOCK_UNAVAILABLE'});expect(pool.calls).toBe(0);
 });
 it('captures methods once instead of following replacements on caller clock',async()=>{const s=setup();s.clock.monotonic=()=>{throw Error();};s.clock.wall=()=>{throw Error();};s.clock.setTimer=()=>{throw Error();};s.clock.clearTimer=()=>{throw Error();};expect(await s.validator.validateExisting(input())).toMatchObject({delivery:'data'});s.validator.close();});
});

describe('all transaction phase stops and result minimization',()=>{
 const phases=['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'",'SET LOCAL ROLE service_role',SQL,'SET CONSTRAINTS ALL IMMEDIATE','COMMIT'];
 for(const action of ['abort','deadline','close'] as const)it.each(phases)('%s '+action+' preserves dispatch certainty',async phase=>{
  const s=setup(true),gate=deferred<unknown>(),abort=new AbortController();s.pool.configure=c=>{c.hook=sql=>sql===phase?gate.promise:undefined;};const result=s.validator.validateExisting(input(),{signal:abort.signal});await tick();expect(s.pool.clients[0]!.calls.at(-1)!.sql).toBe(phase);
  if(action==='abort')abort.abort();else if(action==='deadline')s.clock.advance(10000);else s.validator.close();
  expect(await result).toMatchObject(phase==='COMMIT'?{kind:'completion_uncertain',data:null,backendMayStillRun:true}:{kind:'failed',code:action==='abort'?'ABORTED':action==='deadline'?'DEADLINE':'CLOSED',data:null,transaction:'no_commit_submitted',backendMayStillRun:true});
  gate.reject(Error('private'));await tick();expect(s.pool.clients[0]!.calls.at(-1)!.sql).toBe(phase);expect(s.admission!.snapshot().quarantined).toBe(1);s.validator.close();await s.admission!.close();
 });
 it('does not invoke hostile result metadata accessors',async()=>{const s=setup(),spy=vi.fn();s.pool.configure=c=>{c.hook=sql=>sql===SQL?Object.defineProperty({},'command',{get:spy}):undefined;};expect(await s.validator.validateExisting(input())).toMatchObject({code:'INTERNAL_ERROR',data:null});expect(spy).not.toHaveBeenCalled();});
 it('does not project raw query errors or mismatched SQL labels',async()=>{const s=setup(),spy=vi.fn();s.pool.configure=c=>{c.hook=sql=>{if(sql===SQL)throw Object.defineProperty({message:'private'},'code',{get:spy});};};const out=await s.validator.validateExisting(input());expect(out).toMatchObject({code:'INTERNAL_ERROR'});expect(JSON.stringify(out)).not.toContain('private');expect(spy).not.toHaveBeenCalled();});
 it('contains each close cleanup fault and still stops both operations',async()=>{const pool=new Pool(),clock=new Clock(),gate=deferred<Client>();pool.hook=()=>gate.promise;clock.clearTimer=()=>{throw Error('private');};let removals=0;pool.removeListener=()=>{removals++;throw Error('private');};const validator=create({pool,profiles:[profile],clock});const a=validator.validateExisting(input()),b=validator.validateExisting(input());expect(()=>validator.close()).not.toThrow();expect(await a).toMatchObject({code:'CLOCK_UNAVAILABLE'});expect(await b).toMatchObject({code:'CLOCK_UNAVAILABLE'});expect(removals).toBe(1);expect(pool.ends).toBe(0);gate.reject(Error('private'));await tick();});
 it('reserves logical slots before reentrant clock calls',async()=>{const pool=new Pool(),clock=new Clock(),gate=deferred<Client>();pool.hook=()=>gate.promise;let validator:ReturnType<typeof create>;let entered=false;let inner:Promise<unknown>|undefined;let third:Promise<unknown>|undefined;clock.monotonic=()=>{if(!entered&&validator){entered=true;inner=validator.validateExisting(input());third=validator.validateExisting(input());}return 0;};validator=create({pool,profiles:[profile],clock});const first=validator.validateExisting(input());expect(await third).toMatchObject({code:'CONTEXT_BUSY'});expect(pool.calls).toBe(2);validator.close();await Promise.all([first,inner]);gate.reject(Error('private'));await tick();});
 it('zero-profile validator fails input before SQL',async()=>{const pool=new Pool(),clock=new Clock(),validator=create({pool,profiles:[],clock});expect(await validator.validateExisting(input())).toMatchObject({code:'INVALID_REQUEST'});expect(pool.calls).toBe(0);validator.close();});
});

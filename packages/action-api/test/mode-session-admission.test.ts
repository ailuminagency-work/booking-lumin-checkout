import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { createLocalModeSessionAdmission as create, type AdmissionClock } from '../server/mode-session-admission';
const deferred = <T>() => { let resolve!: (v:T)=>void, reject!: (e:unknown)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
class Clock implements AdmissionClock {
    now=0; callbacks: Array<()=>void>=[]; clears=0;
    monotonic(){return this.now;}
    setTimer(fn:()=>void,_ms:number){this.callbacks.push(fn);return fn;}
    clearTimer(_handle:unknown){this.clears++;}
}
class Client extends EventEmitter {
    queries=0; releases=0; releaseHook?:()=>void; queryHook?:()=>Promise<unknown>;
    query(){this.queries++;return this.queryHook?.()??Promise.resolve({command:'COMMIT'});}
    release(_error?:Error){this.releases++;this.releaseHook?.();}
}
class Pool extends EventEmitter {
    connects=0; ends=0; clients:Client[]=[]; connectHook?:()=>Promise<Client>; endHook?:()=>Promise<void>;
    async connect(){this.connects++;if(this.connectHook)return this.connectHook();const c=new Client();this.clients.push(c);return c;}
    end(){this.ends++;return this.endHook?.()??Promise.resolve();}
}
const setup=()=>{const pool=new Pool(),clock=new Clock();return {pool,clock,a:create(pool,clock)};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

describe('fixed admission and lease ownership',()=>{
 it('reserves eight before underlying acquisition and never queues a ninth',async()=>{
  const s=setup(),gate=deferred<Client>();s.pool.connectHook=()=>gate.promise;
  const work=Array.from({length:8},()=>s.a.pool.connect());expect(s.a.snapshot()).toMatchObject({active:8,free:0});
  await expect(s.a.pool.connect()).rejects.toThrow('ADMISSION_EXHAUSTED');expect(s.pool.connects).toBe(8);
  gate.reject(Error('private'));await Promise.all(work.map(p=>expect(p).rejects.toThrow('ADMISSION_ACQUISITION_FAILED')));
  expect(s.a.snapshot()).toMatchObject({quarantined:8,active:0});await expect(s.a.pool.connect()).rejects.toThrow('ADMISSION_EXHAUSTED');await s.a.close();
 });
 it('normal fulfilled serial work recycles and stale wrapper cannot touch successor',async()=>{
  const s=setup(),first=await s.a.pool.connect();await first.query('COMMIT');first.release();
  const second=await s.a.pool.connect();const before=s.a.snapshot();await expect(first.query('BEGIN')).rejects.toThrow('LEASE_INVALID');expect(()=>first.release()).toThrow('LEASE_INVALID');
  expect(()=>first.on('error',()=>{})).toThrow();first.removeListener('error',()=>{});expect(s.a.snapshot()).toEqual(before);expect(s.pool.clients[1]!.releases).toBe(0);expect(s.pool.clients[0]!.queries).toBe(1);second.release();await s.a.close();
 });
 it.each(['query-reject','release-error','pending-release','release-throw','end','error'] as const)('quarantines %s permanently',async kind=>{
  const s=setup(),c=await s.a.pool.connect(),raw=s.pool.clients[0]!;const gate=deferred<unknown>();
  if(kind==='query-reject'){raw.queryHook=()=>Promise.reject(Error('secret'));await expect(c.query('SELECT')).rejects.toThrow('ADMISSION_QUERY_FAILED');c.release();}
  else if(kind==='pending-release'){raw.queryHook=()=>gate.promise;const p=c.query('SELECT');c.release();gate.resolve({});await p;}
  else if(kind==='release-throw'){raw.releaseHook=()=>{throw Error('secret');};c.release();}
  else if(kind==='release-error')c.release(Error('private'));
  else{raw.emit(kind,Error('private'));c.release();}
  expect(s.a.snapshot()).toMatchObject({quarantined:1,free:7});raw.emit('end');expect(s.a.snapshot().quarantined).toBe(1);await s.a.close();expect(s.a.snapshot().quarantined).toBe(1);
 });
 it('rejects concurrent query without a second driver call and keeps charge',async()=>{
  const s=setup(),c=await s.a.pool.connect(),g=deferred<unknown>();s.pool.clients[0]!.queryHook=()=>g.promise;const p=c.query('first');await expect(c.query('second')).rejects.toThrow('LEASE_INVALID');expect(s.pool.clients[0]!.queries).toBe(1);g.resolve({});await p;c.release();expect(s.a.snapshot().quarantined).toBe(1);await s.a.close();
 });
 it('captures release per checkout on a reused physical client',async()=>{
  const s=setup(),raw=new Client();let first=0,second=0;s.pool.connectHook=async()=>raw;raw.release=()=>{first++;};const c=await s.a.pool.connect();await c.query('COMMIT');c.release();raw.release=()=>{second++;};const next=await s.a.pool.connect();expect(()=>c.release()).toThrow();expect(second).toBe(0);next.release();expect([first,second]).toEqual([1,1]);await s.a.close();
 });
 it('late acquisition after close is discarded once and never delivered',async()=>{
  const s=setup(),g=deferred<Client>();s.pool.connectHook=()=>g.promise;const p=s.a.pool.connect();await s.a.close();const c=new Client();g.resolve(c);await expect(p).rejects.toThrow();expect(c.releases).toBe(1);expect(c.queries).toBe(0);expect(s.a.snapshot().quarantined).toBe(1);
 });
});

describe('bounded event isolation',()=>{
 it('returns own views, zero arguments and own receiver; bounded identity registries',async()=>{
  const s=setup(),c=await s.a.pool.connect();const seen:unknown[]=[];function fn(this:unknown,...args:unknown[]){seen.push(this,args,s.a.snapshot().quarantined);}
  expect(c.on('error',fn)).toBe(c);expect(c.on('error',fn)).toBe(c);expect(()=>c.on('error',()=>{})).toThrow();expect(()=>c.on('notice',fn)).toThrow();
  s.pool.clients[0]!.emit('error',Error('secret'),s.pool);expect(seen).toEqual([c,[],1]);expect(c.removeListener('error',fn)).toBe(c);
  const poolSeen:unknown[]=[];function p(this:unknown,...args:unknown[]){poolSeen.push(this,args);}
  expect(s.a.pool.on('error',p)).toBe(s.a.pool);s.a.pool.on('error',p);s.a.pool.on('error',()=>{});expect(()=>s.a.pool.on('error',()=>{})).toThrow();expect(()=>s.a.pool.on('connect',p)).toThrow();s.pool.emit('error',Error('secret'),s.pool);expect(poolSeen).toEqual([s.a.pool,[]]);expect(s.a.pool.removeListener('error',p)).toBe(s.a.pool);c.release();await s.a.close();
 });
 it('observes synchronous end during release before FREE',async()=>{
  const s=setup(),c=await s.a.pool.connect(),raw=s.pool.clients[0]!;raw.releaseHook=()=>raw.emit('end');c.release();expect(s.a.snapshot().quarantined).toBe(1);await s.a.close();
 });
 it('detach failure quarantines; close timeout keeps private consumers',async()=>{
  const s=setup(),raw=new Client();raw.removeListener=()=>{throw Error('private');};s.pool.connectHook=async()=>raw;const c=await s.a.pool.connect();c.release();expect(s.a.snapshot().quarantined).toBe(1);expect(raw.listenerCount('error')).toBe(1);const closing=s.a.close();expect(await closing).toEqual({driverEnd:'fulfilled'});expect(raw.listenerCount('error')).toBe(1);expect(s.a.snapshot().accepting).toBe(false);
 });
});

describe('construction and bounded close',()=>{
 it('memoizes facade and both close promises without reset',async()=>{
  const s=setup();expect(create(s.pool,new Clock())).toBe(s.a);const a=s.a.close(),b=s.a.pool.end();expect(s.a.close()).toBe(a);expect(s.a.pool.end()).toBe(b);expect(await a).toEqual({driverEnd:'fulfilled'});expect(await b).toBeUndefined();expect(s.pool.ends).toBe(1);expect(create(s.pool)).toBe(s.a);await expect(s.a.pool.connect()).rejects.toThrow('ADMISSION_CLOSED');
 });
 it.each(['getter','proxy','missing','deep'] as const)('rejects %s method shape without invoking getters/connect',kind=>{
  let calls=0;const p:any=new Pool();if(kind==='getter')Object.defineProperty(p,'connect',{get(){calls++;throw Error();}});if(kind==='missing')p.connect=0;
  let value:any=kind==='proxy'?new Proxy(p,{}):p;if(kind==='deep'){for(let i=0;i<9;i++)value=Object.create(value);}
  expect(()=>create(value,new Clock())).toThrow('ADMISSION_CONSTRUCTION_FAILED');expect(calls).toBe(0);expect(p.connects).toBe(0);
 });
 it('attach-then-throw fails once, exact cleanup and one end',async()=>{
  const p=new Pool(),clock=new Clock();let attaches=0;p.on=function(event:string,fn:any){attaches++;superOn.call(this,event,fn);throw Error('private');};
  expect(()=>create(p,clock)).toThrow('ADMISSION_CONSTRUCTION_FAILED');expect(()=>create(p,clock)).toThrow('ADMISSION_CONSTRUCTION_FAILED');await tick();expect(attaches).toBe(1);expect(p.ends).toBe(1);expect(p.listenerCount('error')).toBe(0);
 });
 it.each([9999,10000,10001])('uses final monotonic sample at %i even if timer delayed',async time=>{
  const s=setup(),g=deferred<void>();s.pool.endHook=()=>g.promise;const p=s.a.close();s.clock.now=time;g.resolve();expect(await p).toEqual({driverEnd:time<10000?'fulfilled':'unobserved'});
 });
 it.each(['setup-throw','synchronous','clock-throw','early'] as const)('settles %s unobserved and still ends once',async kind=>{
  const p=new Pool(),clock=new Clock();if(kind==='setup-throw')clock.setTimer=()=>{throw Error();};if(kind==='synchronous')clock.setTimer=fn=>{fn();return fn;};if(kind==='clock-throw')clock.monotonic=()=>{throw Error();};
  const a=create(p,clock);const result=a.close();if(kind==='early')clock.callbacks[0]!();expect(await result).toEqual({driverEnd:'unobserved'});expect(p.ends).toBe(1);if(kind==='synchronous')expect(clock.clears).toBe(1);
 });
 it.each(['fulfilled','rejected'] as const)('clear failure preserves %s observed fact',async kind=>{
  const p=new Pool(),clock=new Clock();clock.clearTimer=()=>{throw Error();};if(kind==='rejected')p.endHook=()=>Promise.reject(Error('private'));const a=create(p,clock);expect(await a.close()).toEqual({driverEnd:kind});clock.callbacks[0]!();expect(await a.close()).toEqual({driverEnd:kind});
 });
 it('captures trusted clock methods before caller mutation',async()=>{
  const s=setup();s.clock.monotonic=()=>{throw Error();};s.clock.setTimer=()=>{throw Error();};expect(await s.a.close()).toEqual({driverEnd:'fulfilled'});
 });
 it('reentrant end observes both memoized promises',async()=>{
  const p=new Pool(),clock=new Clock();const a=create(p,clock);let observed:Promise<void>|undefined;p.endHook=()=>{observed=a.pool.end();expect(a.close()).toBe(a.close());return Promise.resolve();};const close=a.close();expect(a.pool.end()).toBe(observed);expect(await close).toEqual({driverEnd:'fulfilled'});expect(p.ends).toBe(1);
 });
});
const superOn=EventEmitter.prototype.on;
it.each(['negative','nonfinite','backward','throw'] as const)('fails closed on final close clock %s',async kind=>{
 const pool=new Pool(),clock=new Clock(),gate=deferred<void>();pool.endHook=()=>gate.promise;
 let calls=0;clock.monotonic=()=>{calls++;if(calls<=2)return 10;if(kind==='throw')throw Error('private');return kind==='negative'?-1:kind==='nonfinite'?NaN:9;};
 const a=create(pool,clock),closing=a.close();gate.resolve();expect(await closing).toEqual({driverEnd:'unobserved'});expect(pool.ends).toBe(1);
});
it('same-callback removal cannot remove a different listener or leak return values',async()=>{
 const s=setup(),c=await s.a.pool.connect();let calls=0;const fn=()=>calls++;c.on('error',fn);c.removeListener('error',()=>{});s.pool.clients[0]!.emit('error',s.pool);expect(calls).toBe(1);c.removeListener('error',fn);s.pool.clients[0]!.emit('error',s.pool);expect(calls).toBe(1);expect(()=>c.removeListener('notice',fn)).toThrow();c.release();await s.a.close();
});
it('constructor reentry sees constructing and cannot allocate another facade',async()=>{
 const pool=new Pool(),clock=new Clock();let tries=0;pool.on=function(event:string,fn:any){tries++;expect(()=>create(pool,clock)).toThrow('ADMISSION_CONSTRUCTION_FAILED');superOn.call(this,event,fn);return this;};
 const a=create(pool,clock);expect(create(pool,clock)).toBe(a);expect(tries).toBe(1);expect(pool.connects).toBe(0);await a.close();
});
it('private observers are attached through release and detached before free',async()=>{
 const s=setup(),c=await s.a.pool.connect(),raw=s.pool.clients[0]!;raw.releaseHook=()=>{expect(raw.listenerCount('error')).toBe(1);expect(raw.listenerCount('end')).toBe(1);expect(s.a.snapshot().active).toBe(1);};c.release();expect(raw.listenerCount('error')).toBe(0);expect(raw.listenerCount('end')).toBe(0);expect(s.a.snapshot().free).toBe(8);await s.a.close();
});
it('consumer event throw is contained after private quarantine',async()=>{
 const s=setup(),c=await s.a.pool.connect();c.on('error',()=>{throw Error('private');});expect(()=>s.pool.clients[0]!.emit('error',Error('secret'))).not.toThrow();expect(s.a.snapshot().quarantined).toBe(1);c.release();await s.a.close();
});
it.each(['throw','invalid'] as const)('raw end %s is one rejected observation',async kind=>{
 const pool=new Pool(),clock=new Clock();if(kind==='throw')pool.endHook=()=>{throw Error('private');};else pool.endHook=(()=>undefined) as any;
 // Override rather than the helper's fallback for the malformed-result control.
 if(kind==='invalid')pool.end=(()=>{pool.ends++;return undefined;}) as any;
 const a=create(pool,clock);expect(await a.close()).toEqual({driverEnd:'rejected'});expect(await a.pool.end()).toBeUndefined();expect(pool.ends).toBe(1);
});

it('reentrant duplicate release quarantines the owning lease before rejection',async()=>{
 const s=setup(),c=await s.a.pool.connect(),raw=s.pool.clients[0]!;
 raw.releaseHook=()=>{expect(()=>c.release()).toThrow('LEASE_INVALID');};
 c.release();expect(raw.releases).toBe(1);expect(s.a.snapshot()).toMatchObject({quarantined:1,free:7});await s.a.close();
});
it('default cleanup uses the native clearTimeout captured at module load',async()=>{
 const pool=new Pool(),a=create(pool);const replacement=vi.fn(()=>{throw Error('mutable global');});
 const saved=globalThis.clearTimeout;
 try{globalThis.clearTimeout=replacement as any;expect(await a.close()).toEqual({driverEnd:'fulfilled'});expect(replacement).not.toHaveBeenCalled();}
 finally{globalThis.clearTimeout=saved;}
});

const allowedPairs=[['42501','MODE_SESSION_FORBIDDEN'],['42501','FORBIDDEN'],['22023','MODE_SESSION_INVALID'],['22023','MODE_SESSION_INVALID_ORIGIN'],['22023','MODE_REQUEST_INVALID_ANSWERS'],['22023','MODE_REQUEST_INVALID_CUSTOMER'],['22023','MODE_REQUEST_INVALID_TIME'],['40001','MODE_SESSION_CONFLICT'],['40001','MODE_REQUEST_CONFLICT'],['P0002','MODE_REQUEST_NOT_FOUND'],['54000','MODE_SESSION_LIMIT']];
it.each(['throw','reject'] as const)('projects every approved SQL pair on %s without raw fields',async mode=>{
 for(const [code,message] of allowedPairs){
  const s=setup(),c=await s.a.pool.connect(),raw=Object.assign(new Error(message),{code,detail:'private',cause:'private'});
  s.pool.clients[0]!.queryHook=()=>{if(mode==='throw')throw raw;return Promise.reject(raw);};
  const error=await c.query('SELECT').catch(e=>e);expect(error).not.toBe(raw);expect(error.message).toBe(message);expect(error.code).toBe(code);expect(error.detail).toBeUndefined();expect(error.cause).toBeUndefined();expect(error.stack).not.toBe(raw.stack);expect(s.a.snapshot().quarantined).toBe(1);c.release();await s.a.close();
 }
});
it.each([['40P01','DEADLOCK'],['55P03','LOCK_TIMEOUT'],['57014','SERVER_TIMEOUT']])('canonicalizes code-only SQL class %s',async(code,label)=>{
 const s=setup(),c=await s.a.pool.connect();s.pool.clients[0]!.queryHook=()=>Promise.reject({code,message:'arbitrary private message'});await expect(c.query('SELECT')).rejects.toMatchObject({code,message:label});c.release();await s.a.close();
});
it('rejects mismatched Cartesian SQL pairs and malicious/noncanonical errors',async()=>{
 const valid=new Set(allowedPairs.map(([c,m])=>c+'/'+m));const invalid:unknown[]=[];
 for(const code of new Set(allowedPairs.map(p=>p[0])))for(const message of new Set(allowedPairs.map(p=>p[1])))if(!valid.has(code+'/'+message))invalid.push({code,message});
 let getters=0;const getter={get code(){getters++;return '42501';},message:'FORBIDDEN'};
 invalid.push(getter,new Proxy({code:'42501',message:'FORBIDDEN'},{}),{code:'42501',message:'FORBIDDEN '},{code:'42501',message:'x'.repeat(129)},{code:'unknown',message:'FORBIDDEN'},{code:'57014'},Object.create({code:'42501',message:'FORBIDDEN'}));
 for(const value of invalid){const s=setup(),c=await s.a.pool.connect();s.pool.clients[0]!.queryHook=()=>Promise.reject(value);const error=await c.query('SELECT').catch(e=>e);expect(error.message).toBe('ADMISSION_QUERY_FAILED');expect(error.code).toBeUndefined();c.release();await s.a.close();}expect(getters).toBe(0);
});

it.each(['end-before','end-after','error-before','error-after'] as const)('bounded partial detach repair for %s stops all admission',async fault=>{
 const s=setup(),raw=new Client();const remove=EventEmitter.prototype.removeListener;const events:string[]=[];let onCount=0;
 raw.on=function(event:string,fn:any){onCount++;superOn.call(this,event,fn);return this;};
 raw.removeListener=function(event:string,fn:any){events.push(event);if(fault.startsWith(event)&&fault.endsWith('before'))throw Error('private');remove.call(this,event,fn);if(fault.startsWith(event))throw Error('private');return this;};
 s.pool.connectHook=async()=>raw;const c=await s.a.pool.connect();c.release();await s.a.close();
 expect(events).toEqual(fault.startsWith('end')?['end']:['end','error']);expect(raw.releases).toBe(1);expect(s.pool.ends).toBe(1);expect(s.a.snapshot()).toMatchObject({quarantined:1,accepting:false});
 const registered=onCount;raw.emit('end');raw.emit('end');await s.a.pool.end();expect(onCount).toBe(registered);expect(events).toHaveLength(fault.startsWith('end')?1:2);expect(registered).toBeLessThanOrEqual(4);
 expect(create(s.pool)).toBe(s.a);await expect(s.a.pool.connect()).rejects.toThrow('ADMISSION_CLOSED');expect(s.a.snapshot().quarantined).toBe(1);
});
it('repair attach-then-throw is attempted once, never retried by end or close',async()=>{
 const s=setup(),raw=new Client();let attached=0;raw.on=function(event:string,fn:any){attached++;superOn.call(this,event,fn);if(attached>2)throw Error('private');return this;};
 raw.removeListener=()=>{throw Error('private');};s.pool.connectHook=async()=>raw;const c=await s.a.pool.connect();c.release();expect(attached).toBe(3);raw.emit('end');raw.emit('end');await s.a.close();expect(attached).toBe(3);expect(raw.releases).toBe(1);expect(s.pool.ends).toBe(1);
});
it('detach synchronous state ambiguity stops removal and quarantines globally',async()=>{
 const s=setup(),raw=new Client();let removes=0;raw.removeListener=function(event:string,fn:any){removes++;this.emit('error',Error('private'));EventEmitter.prototype.removeListener.call(this,event,fn);return this;};s.pool.connectHook=async()=>raw;
 const c=await s.a.pool.connect();c.release();expect(removes).toBe(1);expect(s.a.snapshot()).toMatchObject({quarantined:1,accepting:false});await s.a.close();expect(s.pool.ends).toBe(1);
});

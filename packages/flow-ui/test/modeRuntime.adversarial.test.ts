import {createModePolicyTransport, type ModePolicyOutcome} from '../src/modePolicyTransport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { installModeLoader, type ModeLoaderIdentity, type ModeLoaderClock } from '../src/modeLoader';
import { createModeController } from '../src/modeController';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: Window & typeof globalThis };
};
const R = 'https://renderer.mode.test:19443';
const A = 'https://api.mode.test:19444';
const P = 'https://portal.mode.test:19445';
const M = 'https://merchant.mode.test:19446';
const ID = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const LOADER = R + '/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js';
const identity: ModeLoaderIdentity = { abiVersion: 1, rendererOrigin: R, apiOrigin: A, portalOrigin: P, profileVersion: 'runtime-test-v1' };
const profile = { profileVersion: identity.profileVersion, rendererOrigin: R, apiOrigin: A, portalOrigin: P, loaderUrl: LOADER };
const windows: Array<Window & typeof globalThis> = [];
const controllers: Array<ReturnType<typeof createModeController>> = [];
function scheduler() {
  let now = 0, serial = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const api: ModeLoaderClock = { now: () => now, setTimer(fn, ms) { const id = ++serial; tasks.set(id, { at: now + ms, fn }); return id; }, clearTimer(id) { tasks.delete(id as number); } };
  return { api, tasks, set(value: number) { now = value; }, advance(to: number) {
    let steps = 0;
    for (;;) { const next = [...tasks].filter(([, t]) => t.at <= to).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break;
      if (++steps > 256) throw Error('CONTROLLED_TIMER_BOUND'); now = next[1].at; tasks.delete(next[0]); next[1].fn();
    } now = to;
  } };
}
function realm(url = M) { const w = new JSDOM('<!doctype html><body></body>', { url, pretendToBeVisual: true }).window; windows.push(w); return w; }
function snippet(w: Window & typeof globalThis, id = ID, height = '640') {
  const container = w.document.createElement('div'); container.setAttribute('data-booking-lumin-installation', id); container.setAttribute('data-booking-lumin-height', height);
  const script = w.document.createElement('script'); script.setAttribute('src', LOADER); script.defer = true; w.document.body.append(container, script);
  Object.defineProperty(w.document, 'currentScript', { configurable: true, get: () => script });
  return { container, script };
}
function entropy(bytes: Uint8Array) { bytes.fill(0x37); }
function entry(w: Window & typeof globalThis, c = scheduler()) { return { api: installModeLoader({ identity, window: w, clock: c.api, entropy }), c }; }
async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
function policy(mode: 'hosted' | 'iframe' = 'hosted') { return { schemaVersion: 1, installationId: ID, mode, deploymentProfileVersion: profile.profileVersion, rendererOrigin: R, apiOrigin: A, loaderUrl: LOADER, currentVersionId: VERSION, targetRevision: 1, policyRevision: 1, allowedParentOrigins: mode === 'hosted' ? [] : [M], enabled: true }; }
function response(value: unknown = policy()) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
function child(fetcher: typeof fetch, c = scheduler()) {
  const w = realm(R + '/checkout/flow/' + ID);
  const template = w.document.createElement('template'); template.id = 'lumin-mode-bootstrap'; template.content.textContent = JSON.stringify({ schemaVersion: 1, kind: 'installation_document', operational: false, policy: policy() }); w.document.body.append(template);
  const controller = createModeController({ profile, window: w, fetch: fetcher, clock: c.api }); controllers.push(controller); return { w, controller, c };
}
afterEach(async () => { await Promise.all(controllers.splice(0).map(c => c.dispose())); for (const w of windows.splice(0)) { w.dispatchEvent(new w.PageTransitionEvent('pagehide')); w.close(); } vi.restoreAllMocks(); });

describe('independent runtime controls (trusted DOM and deterministic clock; no real browser claims)', () => {
  it('executes a paired entry and exposes only the frozen minimal API', () => {
    const w = realm(); const s = snippet(w); const { api } = entry(w);
    expect(api).not.toBeNull(); expect(Object.keys(api!).sort()).toEqual(['mount', 'protocolVersion', 'unmount']); expect(Object.isFrozen(api)).toBe(true);
    const frame = s.container.querySelector('iframe')!; expect(frame).not.toBeNull(); expect(frame.src).toBe(R + '/embed/flow/' + ID);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin'); expect(frame.title).toBe('Booking form');
    expect(api!.mount(s.container)).toBe('already_mounted'); const stranger = w.document.createElement('div'); w.document.body.append(stranger); expect(api!.mount(stranger)).toBe('unregistered');
    expect(api!.unmount(s.container)).toBe(true); expect(api!.unmount(s.container)).toBe(false); expect(api!.mount(s.container)).toBe('mounted');
  });
  it.each(['0640', '+640', '640.0', '6.4e2', ' 640', '640 ', '319', '1601'])('denies noncanonical height %s without erasing content', height => {
    const w = realm(); const s = snippet(w, ID, height); entry(w); expect(s.container.querySelector('iframe')).toBeNull();
  });
  it.each(['320', '640', '1600'])('accepts height neighbor %s', height => { const w = realm(); const s = snippet(w, ID, height); const { api } = entry(w); expect(s.container.querySelector('iframe')!.height).toBe(height); expect(api!.unmount(s.container)).toBe(true); });
  it('does not erase existing merchant content or scan unrelated candidates', () => {
    const w = realm(); const prior = snippet(w); const current = snippet(w); current.container.append(w.document.createElement('strong')); entry(w);
    expect(prior.container.children.length).toBe(0); expect(current.container.firstElementChild!.tagName).toBe('STRONG'); expect(w.document.querySelectorAll('iframe').length).toBe(0);
  });
  it.each(['/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js', LOADER + '?', LOADER + '#', LOADER.replace('renderer.', 'forbidden.')])('denies unsupported raw script identity', src => {
    const w = realm(); const s = snippet(w); s.script.setAttribute('src', src); entry(w); expect(s.container.querySelector('iframe')).toBeNull();
  });
  it('denies missing currentScript and module entry without registering arbitrary DOM', () => {
    const w = realm(); expect(entry(w).api).toBeNull(); const s = snippet(w); s.script.type = 'module'; expect(entry(w).api).toBeNull(); expect(s.container.children.length).toBe(0);
  });
  it('shares exactly eight slots across duplicate script executions and admits denied registration only explicitly', () => {
    const w = realm(), c = scheduler(); const items = Array.from({ length: 9 }, () => { const s = snippet(w); const api = entry(w, c).api!; return { ...s, api }; });
    expect(w.document.querySelectorAll('iframe').length).toBe(8); expect(items[8]!.api.mount(items[8]!.container)).toBe('capacity');
    expect(items[0]!.api.unmount(items[0]!.container)).toBe(true); expect(items[8]!.container.children.length).toBe(0);
    expect(items[8]!.api.mount(items[8]!.container)).toBe('mounted'); expect(w.document.querySelectorAll('iframe').length).toBe(8);
  });
  it('reserves capacity before entropy and cleans an entropy throw without a frame', () => {
    const w = realm(); const s = snippet(w); const c = scheduler(); let calls = 0;
    const api = installModeLoader({ identity, window: w, clock: c.api, entropy: () => { calls++; throw Error('CONTROLLED_ENTROPY'); } });
    expect(calls).toBe(1); expect(s.container.querySelector('iframe')).toBeNull(); expect(api!.mount(s.container)).toBe('unavailable');
  });
  it('sweeps detached owned frames but never removes merchant replacements', () => {
    const w = realm(); const s = snippet(w); const { api, c } = entry(w); const frame = s.container.querySelector('iframe')!; frame.remove();
    const replacement = w.document.createElement('p'); s.container.append(replacement); c.advance(250);
    expect(s.container.firstChild).toBe(replacement); expect(api!.unmount(s.container)).toBe(false); expect(c.tasks.size).toBe(0);
  });
  it('pagehide disposes all channels; controlled persisted pageshow never automatically remounts', () => {
    const w = realm(); const s = snippet(w); const { api, c } = entry(w); w.dispatchEvent(new w.PageTransitionEvent('pagehide'));
    expect(s.container.children.length).toBe(0); expect(api!.mount(s.container)).toBe('suspended'); expect(c.tasks.size).toBe(0);
    w.dispatchEvent(new w.PageTransitionEvent('pageshow', { persisted: true })); expect(s.container.children.length).toBe(0); expect(api!.mount(s.container)).toBe('mounted');
  });
  it('global collision is fail closed without replacing merchant value', () => {
    const w = realm(); const s = snippet(w); const existing = Object.freeze({ unrelated: true }); Object.defineProperty(w, 'BookingLumin', { value: existing, configurable: false });
    expect(entry(w).api).toBeNull(); expect((w as unknown as { BookingLumin: unknown }).BookingLumin).toBe(existing); expect(s.container.children.length).toBe(0);
  });
  it('child hosted fresh policy reaches channel READY but never operational', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); const { controller } = child(fetcher); await flush();
    expect(controller.state).toBe('READY'); expect(controller.operational).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('child target or policy revision change is terminal with no new ready', async () => {
    let reads = 0; const fetcher = vi.fn<typeof fetch>(async () => response({ ...policy(), policyRevision: ++reads })); const { controller, c } = child(fetcher); await flush(); expect(controller.state).toBe('READY');
    c.advance(30000); await flush(); expect(fetcher).toHaveBeenCalledTimes(2); expect(controller.state).toBe('TERMINAL'); c.advance(60000); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('child late underlying fetch remains terminal after its one two-second budget', async () => {
    let resolve!: (value: Response) => void; const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(r => { resolve = r; })); const { controller, c } = child(fetcher);
    await flush(); c.advance(2000); await flush(); expect(controller.state).toBe('TERMINAL'); resolve(response()); await flush(); expect(controller.state).toBe('TERMINAL'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('parent emits exactly ten correlated retries and no send at the five-second boundary', () => {
    const w=realm(); const s=snippet(w); const {c}=entry(w); const frame=s.container.querySelector('iframe')!;
    const post=vi.fn(); Object.defineProperty(frame.contentWindow!, 'postMessage', {value:post,configurable:true}); frame.dispatchEvent(new w.Event('load'));
    expect(post).toHaveBeenCalledTimes(1); c.advance(4500); expect(post).toHaveBeenCalledTimes(10);
    for(const [payload,target] of post.mock.calls){expect(target).toBe(R);expect(payload).toEqual({type:'lumin:init',protocolVersion:1,installationId:ID,instanceId:'37'.repeat(16)});}
    c.advance(5000);expect(post).toHaveBeenCalledTimes(10);expect(s.container.children.length).toBe(0);expect(c.tasks.size).toBe(0);
  });
  it.each([4999,5000])('ready boundary %i is independently checked before delivery', at => {
    const w=realm();const s=snippet(w);const {c}=entry(w);const frame=s.container.querySelector('iframe')!;frame.dispatchEvent(new w.Event('load'));c.set(at);
    w.dispatchEvent(new w.MessageEvent('message',{origin:R,source:frame.contentWindow,data:{type:'lumin:ready',protocolVersion:1,installationId:ID,instanceId:'37'.repeat(16)}}));
    expect(s.container.querySelector('iframe')!==null).toBe(at===4999);
  });
  it('parent four-per-second resize applies latest trailing value and disposal invalidates it',()=>{
    const w=realm();const s=snippet(w);const {api,c}=entry(w);const frame=s.container.querySelector('iframe')!;frame.dispatchEvent(new w.Event('load'));
    const send=(type:string,height?:number)=>w.dispatchEvent(new w.MessageEvent('message',{origin:R,source:frame.contentWindow,data:{type,protocolVersion:1,installationId:ID,instanceId:'37'.repeat(16),...(height===undefined?{}:{height})}}));
    send('lumin:ready');for(const h of [400,401,402,403,404,405])send('lumin:resize',h);expect(frame.height).toBe('403');c.advance(999);expect(frame.height).toBe('403');c.advance(1000);expect(frame.height).toBe('405');
    for(const h of [500,501,502,503])send('lumin:resize',h);api!.unmount(s.container);c.advance(2000);expect(s.container.children.length).toBe(0);expect(c.tasks.size).toBe(0);
  });
  it('wrong source and origin leave a live neighboring valid channel untouched',()=>{
    const w=realm();const s=snippet(w);const {c}=entry(w);const frame=s.container.querySelector('iframe')!;frame.dispatchEvent(new w.Event('load'));
    const payload={type:'lumin:ready',protocolVersion:1,installationId:ID,instanceId:'37'.repeat(16)};
    w.dispatchEvent(new w.MessageEvent('message',{origin:R,source:w,data:payload}));w.dispatchEvent(new w.MessageEvent('message',{origin:M,source:frame.contentWindow,data:payload}));
    c.advance(500);expect(s.container.children.length).toBe(1);w.dispatchEvent(new w.MessageEvent('message',{origin:R,source:frame.contentWindow,data:payload}));c.advance(5000);expect(s.container.children.length).toBe(1);
  });
  it('second frame load terminates an already-ready generation',()=>{
    const w=realm();const s=snippet(w);entry(w);const frame=s.container.querySelector('iframe')!;frame.dispatchEvent(new w.Event('load'));
    w.dispatchEvent(new w.MessageEvent('message',{origin:R,source:frame.contentWindow,data:{type:'lumin:ready',protocolVersion:1,installationId:ID,instanceId:'37'.repeat(16)}}));frame.dispatchEvent(new w.Event('load'));expect(s.container.children.length).toBe(0);
  });
  it.each([-1,NaN,Infinity])('negative or nonfinite clock rejects first admission (%s)', value=>{
    const w=realm();const s=snippet(w);const c=scheduler();c.set(value);const {api}=entry(w,c);expect(s.container.children.length).toBe(0);expect(api!.mount(s.container)).toBe('unavailable');
  });
  it('backward clock between calls irreversibly closes existing owner',()=>{
    const w=realm();const s=snippet(w);const {api,c}=entry(w);c.set(10);expect(api!.mount(s.container)).toBe('already_mounted');c.set(9);expect(api!.mount(s.container)).toBe('unavailable');c.set(11);expect(api!.mount(s.container)).toBe('unavailable');expect(s.container.children.length).toBe(0);
  });
  it('failed timer cleanup terminates owner and prevents further allocation',()=>{
    const w=realm();const s=snippet(w);const c=scheduler();const api=installModeLoader({identity,window:w,clock:{...c.api,clearTimer(){throw Error('CONTROLLED_CLEAR');}},entropy});expect(api!.unmount(s.container)).toBe(true);expect(api!.mount(s.container)).toBe('unavailable');expect(s.container.children.length).toBe(0);
  });
});





describe('independent shared policy transport deadline and retained ownership',()=>{
  const route={installationId:ID,mode:'hosted' as const};
  function transport(fetcher:typeof fetch,c=scheduler(),maxActive:1|16=1){return createModePolicyTransport<ModePolicyOutcome,undefined>({profiles:[profile],fetch:fetcher,clock:c.api,maxActive,project:value=>value});}
  it.each([1999,2000])('fresh cleanup sample at %i controls final delivery',async at=>{
    const c=scheduler();const clear=c.api.clearTimer;Object.defineProperty(c.api,'clearTimer',{value:(handle:unknown)=>{clear(handle);c.set(at);},configurable:true});const t=transport(async()=>response(),c);
    try{expect((await t.read(route,{entryTime:0,context:undefined})).status).toBe(at===1999?200:503);}finally{await t.close();}
  });
  it.each([1,16] as const)('retains exactly %i hung fetch owners after outward deadline',async cap=>{
    const c=scheduler();const resolves:Array<(r:Response)=>void>=[];const fetcher=vi.fn<typeof fetch>(()=>new Promise(r=>resolves.push(r)));const t=transport(fetcher,c,cap);
    const pending=Array.from({length:cap},()=>t.read(route,{entryTime:0,context:undefined}));await flush();expect(fetcher).toHaveBeenCalledTimes(cap);c.advance(2000);expect((await Promise.all(pending)).every(x=>x.status===503)).toBe(true);
    expect((await t.read(route,{entryTime:2000,context:undefined})).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(cap);
    for(const resolve of resolves)resolve(response());await flush();
    const next=t.read(route,{entryTime:2000,context:undefined});await flush();expect(fetcher).toHaveBeenCalledTimes(cap+1);resolves[cap]!(response());expect((await next).status).toBe(200);await t.close();
  });
  it('retains a native stream cancellation owner until cancel really settles',async()=>{
    const c=scheduler();let release!:()=>void;const cancellation=new Promise<void>(r=>release=r);let calls=0;
    const fetcher=vi.fn<typeof fetch>(async()=>{calls++;return calls===1?new Response(new ReadableStream<Uint8Array>({cancel:()=>cancellation}),{status:404}):response();});const t=transport(fetcher,c);
    const pending=t.read(route,{entryTime:0,context:undefined});await flush();c.advance(2000);expect((await pending).status).toBe(503);expect((await t.read(route,{entryTime:2000,context:undefined})).status).toBe(503);expect(calls).toBe(1);
    release();await flush();expect((await t.read(route,{entryTime:2000,context:undefined})).status).toBe(200);expect(calls).toBe(2);await t.close();
  });
  it.each(['now','setTimer','clearTimer'] as const)('throwing %s closes admission irreversibly',async method=>{
    const c=scheduler();Object.defineProperty(c.api,method,{value:()=>{throw Error('CONTROLLED_CLOCK');},configurable:true});const fetcher=vi.fn<typeof fetch>(async()=>response());const t=transport(fetcher,c);
    expect((await t.read(route,{entryTime:0,context:undefined})).status).toBe(503);const count=fetcher.mock.calls.length;expect((await t.read(route,{entryTime:0,context:undefined})).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(count);expect(t.isClosed).toBe(true);await t.close();
  });
  it('caller abort retains its occupied slot until the late response settles',async()=>{
    const c=scheduler();let resolve!:(r:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(r=>resolve=r));const t=transport(fetcher,c);const abort=new AbortController();const pending=t.read(route,{entryTime:0,context:undefined,signal:abort.signal});await flush();abort.abort();expect((await pending).status).toBe(503);expect((await t.read(route,{entryTime:0,context:undefined})).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(1);resolve(response());await flush();await t.close();
  });
  it.each([{...policy(),enabled:false},{...policy(),enabled:false,unexpected:true},{...policy(),enabled:false,apiOrigin:'https://other.mode.test'}])('valid disabled is404 while malformed disabled is503',async value=>{
    const t=transport(async()=>response(value));try{expect((await t.read(route,{entryTime:0,context:undefined})).status).toBe(Object.hasOwn(value,'unexpected')||value.apiOrigin!==A?503:404);}finally{await t.close();}
  });
});

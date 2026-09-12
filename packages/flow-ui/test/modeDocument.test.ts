// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createModeDocumentHandler, type ModeDocumentClock } from '../src/modeDocument';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const version = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profile = Object.freeze({ profileVersion: 'test-v1', rendererOrigin: 'https://renderer.test',
  apiOrigin: 'https://api.test', portalOrigin: 'https://portal.test',
  loaderUrl: 'https://renderer.test/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' });
function policy(extra: Record<string, unknown> = {}) {
  return { schemaVersion: 1, installationId: id, mode: 'hosted', deploymentProfileVersion: profile.profileVersion,
    rendererOrigin: profile.rendererOrigin, apiOrigin: profile.apiOrigin, loaderUrl: profile.loaderUrl,
    currentVersionId: version, targetRevision: 1, policyRevision: 1, allowedParentOrigins: [], enabled: true, ...extra };
}
function json(value: unknown = policy()) { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
function request(path = '/checkout/flow/' + id, options?: RequestInit) { return new Request(profile.rendererOrigin + path, options); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function controlledClock() {
  let time = 0, counter = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: ModeDocumentClock = {
    now: () => time,
    setTimer(callback, milliseconds) { const id = ++counter; timers.set(id, { at: time + milliseconds, callback }); return id; },
    clearTimer(id) { timers.delete(id as number); },
  };
  return { clock, set(timeValue: number) { time = timeValue; }, advance(timeValue: number) {
    time = timeValue;
    for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
  } };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('dedicated inert document', () => {
  it('round trips minimized bootstrap, exact CSP and no executable resources', async () => {
    const fetcher = vi.fn(async () => json());
    const handler = createModeDocumentHandler({ profiles: [profile], fetch: fetcher });
    const r = await handler.handle(request());
    expect(r.status).toBe(200);
    const html = await r.text(); const dom = new DOMParser().parseFromString(html, 'text/html');
    const template = dom.querySelector('template')!;
    expect(template.textContent).toBe('');
    expect(JSON.parse(template.content.textContent!)).toEqual({ schemaVersion: 1, kind: 'installation_document', operational: false, policy: policy() });
    expect(dom.querySelectorAll('script,style,form,iframe,img,link,a').length).toBe(0);
    expect(r.headers.get('content-length')).toBe(String(new TextEncoder().encode(html).length));
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('content-security-policy')).toContain("connect-src 'none'");
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('cache-control')).toBe('no-store,max-age=0');
    expect(r.headers.get('cdn-cache-control')).toBe('no-store');
    expect(r.headers.get('netlify-cdn-cache-control')).toBe('no-store');
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(profile.apiOrigin + '/api/public/installation-policies/' + id);
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
    await handler.close();
  });
  it('iframe exact ancestors and HEAD parity, no framing claim for top-level navigation', async () => {
    const data = policy({ mode: 'iframe', allowedParentOrigins: ['https://merchant.test', 'https://second.test'] });
    const handler = createModeDocumentHandler({ profiles: [profile], fetch: async () => json(data) });
    const get = await handler.handle(request('/embed/flow/' + id));
    const head = await handler.handle(request('/embed/flow/' + id, { method: 'HEAD' }));
    expect(get.status).toBe(200); expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]); expect(await head.text()).toBe('');
    expect(get.headers.get('x-frame-options')).toBeNull();
    expect(get.headers.get('content-security-policy')).toContain('frame-ancestors https://merchant.test https://second.test');
    await handler.close();
  });
  it.each([
    ['/index.html', 404], ['/checkout/index.html', 404], ['/checkout/flow/' + id + '/', 400],
    ['/checkout/flow/' + id + '?', 400], ['/checkout/flow/' + id + '?x=1', 400],
    ['/checkout/flow/' + id + '#x', 400], ['/checkout/flow/%61' + id.slice(1), 400],
    ['/checkout//flow/' + id, 400], ['/embed/flow/INVALID', 400], ['/checkout/flow/' + id.toUpperCase(), 400],
  ])('terminal route %s -> %s without upstream', async (path, status) => {
    const fetcher = vi.fn(); const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher });
    expect((await h.handle(request(path))).status).toBe(status); expect(fetcher).not.toHaveBeenCalled(); await h.close();
  });
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('rejects %s and retains HEAD denial semantics', async method => {
    const fetcher = vi.fn(); const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher });
    const r = await h.handle(request(undefined, { method })); expect(r.status).toBe(405); expect(r.headers.get('allow')).toBe('GET, HEAD');
    expect(fetcher).not.toHaveBeenCalled(); await h.close();
  });
  it.each([{ cookie: 'synthetic=x' }, { authorization: 'synthetic' }, { host: 'evil.test' }, { 'transfer-encoding': 'chunked' }, { 'content-length': '1' }])('rejects observable unsafe headers %o', async headers => {
    const fetcher = vi.fn(); const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher });
    expect((await h.handle(request(undefined, { headers: Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled(); await h.close();
  });
  it.each([
    [policy({ enabled: false }), 404], [policy({ mode: 'iframe', allowedParentOrigins: ['https://merchant.test'] }), 404],
    [policy({ installationId: version, enabled: false }), 503], [policy({ rendererOrigin: 'https://evil.test' }), 503],
    [policy({ extra: 1 }), 503], [policy({ policyRevision: 0 }), 503],
    [policy({ mode: 'iframe', allowedParentOrigins: ['https://z.test', 'https://a.test'] }), 503],
    [policy({ mode: 'iframe', allowedParentOrigins: ['https://xn--bcher-kva.test'] }), 503],
  ])('strict upstream binding and semantic status (%s)', async (data, status) => {
    const h = createModeDocumentHandler({ profiles: [profile], fetch: async () => json(data) });
    const r = await h.handle(request()); expect(r.status).toBe(status); expect(r.headers.get('x-frame-options')).toBe('DENY'); await h.close();
  });
  it('does not cache policy and never returns bootstrap on errors', async () => {
    let enabled = true; const fetcher = vi.fn(async () => json(policy({ enabled })));
    const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher });
    expect((await h.handle(request())).status).toBe(200); enabled = false;
    const r = await h.handle(request()); expect(r.status).toBe(404); expect(await r.text()).not.toContain('lumin-mode-bootstrap'); expect(fetcher).toHaveBeenCalledTimes(2); await h.close();
  });
});

describe('bounded reader and configuration', () => {
  it('empty profile denies without fetch; copied registry cannot be retargeted', async () => {
    const fetcher = vi.fn(async () => json()); const empty = createModeDocumentHandler({ profiles: [], fetch: fetcher });
    expect((await empty.handle(request())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled(); await empty.close();
    const mutable: { -readonly [K in keyof typeof profile]: string } = { ...profile }; const h = createModeDocumentHandler({ profiles: [mutable], fetch: fetcher }); mutable.apiOrigin = 'https://evil.test';
    expect((await h.handle(request())).status).toBe(200); expect((fetcher.mock.calls as unknown[][])[0]?.[0]).toBe(profile.apiOrigin + '/api/public/installation-policies/' + id); await h.close();
  });
  it('rejects accessor/symbol/oversized registry without reading descendants', () => {
    let reads = 0; const array: unknown[] = []; Object.defineProperty(array, '0', { get() { reads++; return profile; }, enumerable: true });
    expect(() => createModeDocumentHandler({ profiles: array })).toThrow();
    const many = new Array(2); Object.defineProperty(many, '0', { get() { reads++; return profile; } });
    expect(() => createModeDocumentHandler({ profiles: many })).toThrow();
    const value = { ...profile, [Symbol('bad')]: 1 };
    expect(() => createModeDocumentHandler({ profiles: [value] })).toThrow();
    const options = Object.defineProperty({}, 'profiles', { get() { reads++; return []; }, enumerable: true });
    expect(() => createModeDocumentHandler(options as never)).toThrow(); expect(reads).toBe(0);
  });
  it.each([204, 301, 302, 307, 308, 429, 500])('upstream %s fails closed without retry', async status => {
    const fetcher = vi.fn(async () => new Response(null, { status })); const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher });
    expect((await h.handle(request())).status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1); await h.close();
  });
  it.each([
    ['text/html', undefined, JSON.stringify(policy())], ['application/json', 'gzip', JSON.stringify(policy())],
    ['application/json', undefined, '{'],
  ])('rejects upstream type/encoding/JSON', async (type, encoding, body) => {
    const headers: Record<string, string> = { 'content-type': type! }; if (encoding) headers['content-encoding'] = encoding;
    const h = createModeDocumentHandler({ profiles: [profile], fetch: async () => new Response(body, { headers }) });
    expect((await h.handle(request())).status).toBe(503); await h.close();
  });
  it('bounds actual body at16384 bytes, counts BOM and validates content length and fatal UTF8', async () => {
    const valid = JSON.stringify(policy());
    for (const [body, length, status] of [
      [valid.padEnd(16384, ' '), '16384', 200], [valid.padEnd(16385, ' '), undefined, 503],
      ['\ufeff' + valid, String(new TextEncoder().encode('\ufeff' + valid).length), 200],
      [valid, '1', 503], [new Uint8Array([0xc3, 0x28]), undefined, 503],
    ] as const) {
      const headers: Record<string,string> = { 'content-type': 'application/json' }; if (length) headers['content-length'] = length;
      const h = createModeDocumentHandler({ profiles: [profile], fetch: async () => new Response(body, { headers }) });
      expect((await h.handle(request())).status).toBe(status); await h.close();
    }
  });
  it('response timeout retains all16 pending fetch slots until their cleanup settles', async () => {
    const time = controlledClock(); const calls: ReturnType<typeof deferred<Response>>[] = [];
    const fetcher = vi.fn(() => { const d = deferred<Response>(); calls.push(d); return d.promise; });
    const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock: time.clock });
    const pending = Array.from({ length: 16 }, () => h.handle(request()));
    time.advance(2000); expect((await Promise.all(pending)).every(r => r.status === 503)).toBe(true);
    expect((await h.handle(request())).status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(16);
    calls[0]!.resolve(json()); await flush();
    const next = h.handle(request()); expect(fetcher).toHaveBeenCalledTimes(17);
    calls[16]!.resolve(json()); expect((await next).status).toBe(200);
    for (const call of calls.slice(1,16)) call.resolve(json()); await flush(); await h.close();
  });
  it('pending cancel retains slot after response even if fetch itself finished', async () => {
    const time = controlledClock(); const cancellation = deferred<void>();
    let callCount = 0;
    const fetcher = vi.fn(async () => { callCount++; return new Response(new ReadableStream({ cancel: () => cancellation.promise }), { headers: { 'content-type': 'application/json' } }); });
    const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock: time.clock });
    const reads = Array.from({ length: 16 }, () => h.handle(request())); await flush(); time.advance(2000);
    expect((await Promise.all(reads)).every(r => r.status === 503)).toBe(true);
    expect((await h.handle(request())).status).toBe(503); expect(callCount).toBe(16);
    cancellation.resolve(); await flush(); await h.close();
  });
  it('backwards clock across calls permanently closes admission; rejected fetch deadline also closes caller', async () => {
    const time = controlledClock(); time.set(100); const fetcher = vi.fn(async () => json());
    const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock: time.clock });
    expect((await h.handle(request())).status).toBe(200); time.set(99);
    expect((await h.handle(request())).status).toBe(503); time.set(200);
    expect((await h.handle(request())).status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1); await h.close();
    const late = deferred<Response>(); const clock2 = controlledClock();
    const h2 = createModeDocumentHandler({ profiles: [profile], fetch: () => late.promise, clock: clock2.clock });
    const result = h2.handle(request()); clock2.set(2000); late.reject(Error('private detail'));
    expect((await result).status).toBe(503); await h2.close();
  });
  it('disconnect aborts upstream and a late body cannot deliver success', async () => {
    const late = deferred<Response>(); let signal: AbortSignal | undefined;
    const h = createModeDocumentHandler({ profiles: [profile], fetch: async (_url, init) => { signal = init?.signal as AbortSignal; return late.promise; } });
    const caller = new AbortController(); const result = h.handle(request(undefined, { signal: caller.signal })); caller.abort();
    expect((await result).status).toBe(503); expect(signal?.aborted).toBe(true); late.resolve(json()); await flush(); await h.close();
    expect((await h.handle(request())).status).toBe(503);
  });
});

 it('redirected404 is transport failure, plain404 unavailable; captured clock methods cannot be replaced', async () => {
  const time = controlledClock();
  const original = time.clock.now;
  let redirected = true;
  const fetcher = vi.fn(async () => {
    const r = new Response(null, { status: 404 });
    Object.defineProperty(r, 'redirected', { value: redirected });
    return r;
  });
  const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock: time.clock });
  time.clock.now = () => { throw Error('changed dependency'); };
  time.clock.setTimer = () => { throw Error('changed timer'); };
  time.clock.clearTimer = () => { throw Error('changed clear'); };
  expect((await h.handle(request())).status).toBe(503); redirected = false;
  expect((await h.handle(request())).status).toBe(404);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(original()).toBe(0); await h.close();
 });

 it.each([NaN, Infinity, -1])('nonfinite/negative clock %s aborts active caller and never reopens', async bad => {
   const time = controlledClock(); const late = deferred<Response>();
   const fetcher = vi.fn(() => late.promise);
   const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock: time.clock });
   const first = h.handle(request()); time.set(bad);
   expect((await h.handle(request())).status).toBe(503); expect((await first).status).toBe(503);
   time.set(3000); expect((await h.handle(request())).status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1);
   late.resolve(json()); await flush(); await h.close();
 });
 it('body deadline is shared with headers and pre-dispatch exhaustion causes no fetch', async () => {
   const time = controlledClock(); const late = deferred<Response>(); let body!: ReadableStreamDefaultController<Uint8Array>;
   const h = createModeDocumentHandler({ profiles: [profile], fetch: () => late.promise, clock: time.clock });
   const pending = h.handle(request()); time.set(1500);
   late.resolve(new Response(new ReadableStream({ start(c) { body = c; } }), { headers: { 'content-type': 'application/json' } }));
   await flush(); time.advance(2000); expect((await pending).status).toBe(503); await h.close();
   const clock2 = controlledClock(); let reads = 0;
   clock2.clock.now = () => ++reads === 1 ? 0 : 2000;
   const fetcher = vi.fn(); const h2 = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock: clock2.clock });
   expect((await h2.handle(request())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled(); await h2.close();
 });
 it('fresh sample after valid parse cannot deliver a policy beyond deadline', async () => {
   let time = 0, postDone = 0;
   const control = controlledClock();
   control.clock.now = () => time;
   const value = new TextEncoder().encode(JSON.stringify(policy()));
   let emitted = false;
   const body = new ReadableStream<Uint8Array>({ pull(c) {
     if (!emitted) { emitted = true; c.enqueue(value); }
     else { c.close(); postDone++; time = 2000; }
   } });
   const h = createModeDocumentHandler({ profiles: [profile], clock: control.clock, fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) });
   expect((await h.handle(request())).status).toBe(503); expect(postDone).toBe(1); await h.close();
 });
 it('close aborts active calls, is idempotent and waits bounded cleanup before settling', async () => {
   const late = deferred<Response>(); const h = createModeDocumentHandler({ profiles: [profile], fetch: () => late.promise });
   const pending = h.handle(request()); const closing = h.close(); expect(h.close()).toBe(closing);
   expect((await pending).status).toBe(503); expect((await h.handle(request())).status).toBe(503);
   let ended = false; void closing.then(() => { ended = true; }); await flush(); expect(ended).toBe(false);
   late.resolve(json()); await closing; expect(ended).toBe(true);
 });

 it('close returns within its real10s cap even if a trusted fetch never settles', async () => {
   const h = createModeDocumentHandler({ profiles: [profile], fetch: () => new Promise<Response>(() => {}) });
   const output = h.handle(request()); const start = performance.now();
   await h.close(); const elapsed = performance.now() - start;
   expect(elapsed).toBeGreaterThanOrEqual(9900); expect(elapsed).toBeLessThan(11500);
   expect((await output).status).toBe(503); expect((await h.handle(request())).status).toBe(503);
 }, 15000);
 it('accepts20 longest supported parent hosts and rejects21 before rendering', async () => {
   const host = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
   const origins = Array.from({ length:20 }, (_,i) => 'https://' + String(i).padStart(2,'0') + host.slice(2)).sort();
   // Each hostname is253 characters with a63-character first label.
   const data = policy({ mode:'iframe', allowedParentOrigins:origins });
   const h = createModeDocumentHandler({ profiles:[profile], fetch:async () => json(data) });
   const r = await h.handle(request('/embed/flow/' + id)); expect(r.status).toBe(200);
   expect(new TextEncoder().encode(await r.text()).length).toBeLessThan(32768); await h.close();
   const h2 = createModeDocumentHandler({ profiles:[profile], fetch:async () => json(policy({mode:'iframe',allowedParentOrigins:[...origins,'https://z.test']})) });
   expect((await h2.handle(request('/embed/flow/' + id))).status).toBe(503); await h2.close();
 });

 it('failed timer clear closes admission and bounds retained scheduler callbacks', async () => {
   const callbacks: (() => void)[] = [];
   const clock: ModeDocumentClock = { now: () => 0, setTimer(fn) { callbacks.push(fn); return callbacks.length; }, clearTimer() { throw Error('scheduler failure'); } };
   const fetcher = vi.fn(async () => json());
   const h = createModeDocumentHandler({ profiles: [profile], fetch: fetcher, clock });
   for (let i=0;i<20;i++) expect((await h.handle(request())).status).toBe(503);
   expect(fetcher).toHaveBeenCalledTimes(1); expect(callbacks).toHaveLength(1);
   callbacks[0]!(); expect((await h.handle(request())).status).toBe(503); await h.close();
 });

 it.each([1999,2000])('final cleanup at%s cannot deliver a document after its2s deadline', async finishTime => {
   let now=0;
   const clock: ModeDocumentClock = { now:()=>now, setTimer:()=>undefined, clearTimer(){now=finishTime;} };
   const h=createModeDocumentHandler({profiles:[profile],clock,fetch:async()=>json()});
   const result=await h.handle(request());expect(result.status).toBe(finishTime===1999?200:503);
   if(finishTime===2000)expect(await result.text()).not.toContain('lumin-mode-bootstrap');
   await h.close();
 });

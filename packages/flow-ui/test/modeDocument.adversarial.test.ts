import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModeDocumentHandler, type ModeDocumentClock, type ModeDocumentHandler } from '../src/modeDocument';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const R = 'https://renderer.example.test';
const A = 'https://api.example.test';
const profile = { profileVersion: 'local-s1', rendererOrigin: R, apiOrigin: A, portalOrigin: 'https://portal.example.test', loaderUrl: R + '/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' };
const policy = () => ({ schemaVersion: 1, installationId: ID, mode: 'hosted', deploymentProfileVersion: profile.profileVersion, rendererOrigin: R, apiOrigin: A, loaderUrl: profile.loaderUrl, currentVersionId: OTHER, targetRevision: 1, policyRevision: 1, allowedParentOrigins: [] as string[], enabled: true });
const enc = new TextEncoder();
function wire(value: unknown = policy(), headers: Record<string, string> = {}) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...headers } }); }
function request(path = '/checkout/flow/' + ID, init?: RequestInit) { return new Request(R + path, init); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function clock() {
  let now = 0;
  const timers = new Map<number, () => void>(); let id = 0;
  const api: ModeDocumentClock = { now: () => now, setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: h => { timers.delete(h as number); } };
  return { api, timers, set: (n: number) => { now = n; }, fire: () => { for (const fn of [...timers.values()]) fn(); } };
}
const handlers: ModeDocumentHandler[] = [];
function handler(fetcher: typeof fetch = vi.fn(async () => wire()), profiles: unknown = [profile], c = clock()) {
  const h = createModeDocumentHandler({ profiles, fetch: fetcher, clock: c.api }); handlers.push(h); return { h, c, fetcher };
}
afterEach(async () => { await Promise.all(handlers.splice(0).map(h => h.close())); vi.restoreAllMocks(); });

describe('independent portable document boundary (controlled network, no TLS/browser claim)', () => {
  it('copies one profile; zero fails without fetch and two reject startup', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => wire()); const empty = handler(fetcher, []);
    expect((await empty.h.handle(request())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
    expect(() => createModeDocumentHandler({ profiles: [profile, profile] })).toThrow();
    const mutable = { ...profile }; const one = handler(fetcher, [mutable]); mutable.apiOrigin = 'https://changed.example.test';
    expect((await one.h.handle(request())).status).toBe(200); expect(fetcher.mock.calls[0]?.[0]).toBe(A + '/api/public/installation-policies/' + ID);
  });
  it('does not execute getters, toJSON or iterators in constructor data', () => {
    const hit = vi.fn(() => { throw Error('SENTINEL'); });
    const accessor = { ...profile }; Object.defineProperty(accessor, 'apiOrigin', { enumerable: true, get: hit });
    for (const profiles of [[accessor], [{ ...profile, toJSON: hit }], Object.assign([profile], { [Symbol.iterator]: hit }), new Array(1)]) expect(() => createModeDocumentHandler({ profiles })).toThrow();
    expect(hit).not.toHaveBeenCalled();
    const trapped = new Proxy([], { ownKeys() { throw Error('SENTINEL'); } });
    expect(() => createModeDocumentHandler({ profiles: trapped })).toThrow('INVALID_MODE_DOCUMENT_CONFIGURATION');
  });
  it.each(['https://xn--abc.example.test', 'https://127.0.0.1', 'https://name.0xabc'])('rejects non-S1 registry origin %s', origin => {
    expect(() => createModeDocumentHandler({ profiles: [{ ...profile, apiOrigin: origin }] })).toThrow();
  });
  it.each(['?', '#', '?x=1', '#x', '/', '/extra', '%2f', '%41'])('rejects observable route suffix %s without fetch', async suffix => {
    const x = handler(); expect((await x.h.handle(request('/checkout/flow/' + ID + suffix))).status).toBe(400); expect(x.fetcher).not.toHaveBeenCalled();
  });
  it.each(['authorization', 'cookie'])('rejects even empty %s', async name => {
    const x = handler(); expect((await x.h.handle(request(undefined, { headers: { [name]: '' } }))).status).toBe(400); expect(x.fetcher).not.toHaveBeenCalled();
  });
  it('separates unknown, malformed, unsupported method and empty registry', async () => {
    const x = handler(); expect((await x.h.handle(request('/index.html'))).status).toBe(404);
    expect((await x.h.handle(request('/embed/flow/no', { method: 'POST' }))).status).toBe(400);
    const method = await x.h.handle(request(undefined, { method: 'POST' })); expect(method.status).toBe(405); expect(method.headers.get('allow')).toBe('GET, HEAD');
    expect(x.fetcher).not.toHaveBeenCalled();
  });
  it('uses one fixed credential-free GET and ignores navigation validators', async () => {
    const f = vi.fn<typeof fetch>(async () => wire()); const x = handler(f);
    expect((await x.h.handle(request(undefined, { headers: { origin: 'https://foreign.test', referer: 'https://foreign.test/private', range: 'bytes=0-1', 'if-none-match': '*' } }))).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1); const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(A + '/api/public/installation-policies/' + ID);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect([...new Headers(init?.headers)]).toEqual([['accept', 'application/json']]);
  });
  it.each([201, 301, 302, 401, 429, 500])('maps upstream %s to generic503', async status => {
    const x = handler(vi.fn(async () => new Response('PRIVATE_SENTINEL', { status })));
    const out = await x.h.handle(request()); expect(out.status).toBe(503); expect(await out.text()).not.toContain('PRIVATE_SENTINEL');
  });
  it('maps genuine404 to404 with no retry', async () => { const x = handler(vi.fn(async () => new Response(null, { status: 404 }))); expect((await x.h.handle(request())).status).toBe(404); expect(x.fetcher).toHaveBeenCalledTimes(1); });
  it.each(['text/json', 'application/json; charset=latin1', 'application/json; charset=utf-8; extra=x', 'application/json, application/json'])('rejects content type %s', async type => {
    const x = handler(vi.fn(async () => wire(policy(), { 'Content-Type': type }))); expect((await x.h.handle(request())).status).toBe(503);
  });
  it.each(['0', '01', '1, 1', '16385', '-1', '1'])('rejects invalid/mismatched declared length %s', async length => { const x = handler(vi.fn(async () => wire(policy(), { 'Content-Length': length }))); expect((await x.h.handle(request())).status).toBe(503); });
  it('accepts BOM with length including BOM but rejects invalid UTF8', async () => {
    const bytes = enc.encode('\uFEFF' + JSON.stringify(policy())); const good = handler(vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(bytes.length) } })));
    expect((await good.h.handle(request())).status).toBe(200);
    for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xf0, 0x9f])]) { const bad = handler(vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'application/json' } }))); expect((await bad.h.handle(request())).status).toBe(503); }
  });
  it.each([16383, 16384, 16385])('enforces actual stream boundary %s with valid whitespace padded JSON', async size => {
    const json = JSON.stringify(policy()); const bytes = enc.encode(json + ' '.repeat(size - enc.encode(json).length));
    const x = handler(vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'application/json' } })));
    expect((await x.h.handle(request())).status).toBe(size <= 16384 ? 200 : 503);
  });
  it.each(['installationId', 'deploymentProfileVersion', 'rendererOrigin', 'apiOrigin', 'loaderUrl'])('invalid disabled policy binding %s is503 before semantic404', async key => {
    const value = { ...policy(), enabled: false, [key]: key === 'installationId' ? OTHER : 'invalid' };
    const x = handler(vi.fn(async () => wire(value))); expect((await x.h.handle(request())).status).toBe(503);
  });
  it('returns404 only for structurally valid disabled or mode mismatch', async () => {
    const disabled = handler(vi.fn(async () => wire({ ...policy(), enabled: false }))); expect((await disabled.h.handle(request())).status).toBe(404);
    const mismatch = handler(); expect((await mismatch.h.handle(request('/embed/flow/' + ID))).status).toBe(404);
  });
  it('requires sorted unique parent origins and excludes profile origins', async () => {
    for (const parents of [['https://b.example.test', 'https://a.example.test'], ['https://a.example.test', 'https://a.example.test'], [profile.portalOrigin], ['https://xn--abc.example.test']]) {
      const x = handler(vi.fn(async () => wire({ ...policy(), mode: 'iframe', allowedParentOrigins: parents }))); expect((await x.h.handle(request('/embed/flow/' + ID))).status).toBe(503);
    }
  });
  it('fresh reads produce current CSP; old document remains a snapshot', async () => {
    let revision = 1; const x = handler(vi.fn(async () => wire({ ...policy(), mode: 'iframe', policyRevision: revision, allowedParentOrigins: [`https://parent${revision}.example.test`] })));
    const old = await x.h.handle(request('/embed/flow/' + ID)); revision++;
    const fresh = await x.h.handle(request('/embed/flow/' + ID)); expect(old.headers.get('content-security-policy')).toContain('https://parent1.example.test'); expect(fresh.headers.get('content-security-policy')).toContain('https://parent2.example.test'); expect(fresh.headers.has('x-frame-options')).toBe(false); expect(x.fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([200, 404, 503])('GET and HEAD preserve exact headers and byte length for %s', async status => {
    const x = handler(vi.fn(async () => status === 200 ? wire() : new Response(null, { status })));
    const get = await x.h.handle(request()); const head = await x.h.handle(request(undefined, { method: 'HEAD' }));
    expect(head.status).toBe(status); expect([...head.headers]).toEqual([...get.headers]); expect(await head.text()).toBe('');
    expect(Number(get.headers.get('content-length'))).toBe(enc.encode(await get.text()).length);
    for (const [name, value] of [['cache-control', 'no-store,max-age=0'], ['cdn-cache-control', 'no-store'], ['netlify-cdn-cache-control', 'no-store'], ['referrer-policy', 'no-referrer'], ['x-content-type-options', 'nosniff']]) expect(get.headers.get(name!)).toBe(value);
    for (const name of ['set-cookie', 'etag', 'last-modified', 'location', 'access-control-allow-origin']) expect(get.headers.has(name)).toBe(false);
    expect(get.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
  it('retains sixteen hung fetch slots after outward deadlines and releases only actual settled work', async () => {
    const pending = Array.from({ length: 16 }, () => deferred<Response>()); let count = 0;
    const x = handler(vi.fn(() => pending[count++]!.promise)); const outputs = Array.from({ length: 16 }, () => x.h.handle(request()));
    x.c.set(2000); x.c.fire(); expect((await Promise.all(outputs)).every(r => r.status === 503)).toBe(true);
    expect((await x.h.handle(request())).status).toBe(503); expect(count).toBe(16);
    for (const p of pending) p.resolve(new Response(null, { status: 404 })); await flush();
    expect(x.c.timers.size).toBe(0);
  });
  it('retains pending body cancellation after caller deadline', async () => {
    const cancellation = deferred<void>(); let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull() {}, cancel() { cancelled++; return cancellation.promise; } });
    const x = handler(vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } })));
    const result = x.h.handle(request()); await flush(); x.c.set(2000); x.c.fire(); expect((await result).status).toBe(503); expect(cancelled).toBe(1);
    cancellation.resolve(); await flush(); expect(x.c.timers.size).toBe(0);
  });
  it('enforces cumulative read deadline on late successful body and rejection', async () => {
    for (const rejection of [false, true]) {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
      const x = handler(vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } })));
      const out = x.h.handle(request()); await flush(); x.c.set(2000);
      if (rejection) controller.error(Error('PRIVATE_SENTINEL')); else { controller.enqueue(enc.encode(JSON.stringify(policy()))); controller.close(); }
      expect((await out).status).toBe(503);
    }
  });
  it.each([-1, NaN, Infinity])('terminal bad clock %s never reopens', async bad => {
    const x = handler(); x.c.set(10); expect((await x.h.handle(request())).status).toBe(200); x.c.set(bad);
    expect((await x.h.handle(request())).status).toBe(503); x.c.set(100); expect((await x.h.handle(request())).status).toBe(503); expect(x.fetcher).toHaveBeenCalledTimes(1);
  });
  it('detects backward clock across completed operations', async () => {
    const x = handler(); x.c.set(50); expect((await x.h.handle(request())).status).toBe(200); x.c.set(49); expect((await x.h.handle(request())).status).toBe(503); x.c.set(100); expect((await x.h.handle(request())).status).toBe(503); expect(x.fetcher).toHaveBeenCalledTimes(1);
  });
  it('aborts pending fetch, removes listener/timer, and consumes its late rejection', async () => {
    const pending = deferred<Response>(); const f = vi.fn<typeof fetch>(() => pending.promise); const x = handler(f); const control = new AbortController();
    const req = request(undefined, { signal: control.signal }); const remove = vi.spyOn(req.signal, 'removeEventListener'); const out = x.h.handle(req); control.abort();
    expect((await out).status).toBe(503); expect((f.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(x.c.timers.size).toBe(0);
    pending.reject(Error('PRIVATE_SENTINEL')); await flush();
  });
  it('pre-aborted native signal dispatches nothing; close stays idempotent and terminal', async () => {
    const x = handler(); const abort = new AbortController(); abort.abort(); expect((await x.h.handle(request(undefined, { signal: abort.signal }))).status).toBe(503); expect(x.fetcher).not.toHaveBeenCalled();
    const first = x.h.close(); expect(x.h.close()).toBe(first); await first; expect((await x.h.handle(request())).status).toBe(503);
  });
});

describe('independent lifecycle and DOM controls', () => {
  it('parses inert template content as exact bootstrap with no executable DOM', async () => {
    // Existing jsdom is used only as a unit DOM parser, not Chromium/TLS evidence.
    const { createRequire } = await import('node:module');
    const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: { document: Document; close(): void } } };
    const x = handler(); const html = await (await x.h.handle(request())).text();
    const dom = new JSDOM(html);
    try {
      const doc = dom.window.document; const template = doc.querySelector<HTMLTemplateElement>('#lumin-mode-bootstrap')!;
      expect(template.textContent).toBe(''); expect(JSON.parse(template.content.textContent!)).toEqual({ schemaVersion: 1, kind: 'installation_document', operational: false, policy: policy() });
      expect(doc.querySelectorAll('script,style,iframe,img,form,a,link')).toHaveLength(0); expect(doc.querySelector('html')?.lang).toBe('en'); expect(doc.querySelector('main h1')).not.toBeNull();
    } finally { dom.window.close(); }
  });
  it.each(['</template><script>PRIVATE_SENTINEL</script>', 'https://merchant.test/" onload="x'])('rejects injection before emitting bootstrap: %s', async value => {
    const x = handler(vi.fn(async () => wire({ ...policy(), mode: 'iframe', allowedParentOrigins: [value] })));
    const out = await x.h.handle(request('/embed/flow/' + ID)); expect(out.status).toBe(503); expect(await out.text()).not.toContain('PRIVATE_SENTINEL');
  });
  it('rejects redirected404 rather than certifying missing installation', async () => {
    const upstream = new Response(null, { status: 404 }); Object.defineProperty(upstream, 'redirected', { value: true });
    const x = handler(vi.fn(async () => upstream)); expect((await x.h.handle(request())).status).toBe(503);
  });
  it('captures clock methods against later trusted object replacement', async () => {
    const x = handler(); x.c.api.now = () => { throw Error('REPLACED'); }; x.c.api.setTimer = () => { throw Error('REPLACED'); }; x.c.api.clearTimer = () => { throw Error('REPLACED'); };
    expect((await x.h.handle(request())).status).toBe(200);
  });
  it('clearTimer failure is terminal and cannot accumulate callbacks through repeated admission', async () => {
    const c = clock(); const retained: Array<() => void> = [];
    c.api.setTimer = fn => { retained.push(fn); return retained.length; }; c.api.clearTimer = () => { throw Error('CLEAR_SENTINEL'); };
    const x = handler(vi.fn(async () => wire()), [profile], c);
    expect((await x.h.handle(request())).status).toBe(503);
    for (let i = 0; i < 20; i++) expect((await x.h.handle(request())).status).toBe(503);
    expect(x.fetcher).toHaveBeenCalledTimes(1); expect(retained).toHaveLength(1);
  });
  it('clock throw stops active requests and never starts a recovery baseline', async () => {
    const pending = deferred<Response>(); let fails = false; const c = clock(); c.api.now = () => { if (fails) throw Error('CLOCK_SENTINEL'); return 1; };
    const x = handler(vi.fn(() => pending.promise), [profile], c); const first = x.h.handle(request()); fails = true;
    expect((await x.h.handle(request())).status).toBe(503); expect((await first).status).toBe(503); fails = false;
    expect((await x.h.handle(request())).status).toBe(503); pending.resolve(new Response(null, { status: 404 })); await flush();
  });
  it('reentrant fetch cannot bypass reserved slot and settled cleanup admits a new call', async () => {
    const pending: Array<ReturnType<typeof deferred<Response>>> = []; const nested: Array<Promise<Response>> = []; let h!: ModeDocumentHandler;
    const f = vi.fn<typeof fetch>(() => { const p = deferred<Response>(); pending.push(p); if (pending.length <= 16) nested.push(h.handle(request())); return p.promise; });
    const x = handler(f); h = x.h; const first = h.handle(request()); expect(pending).toHaveLength(16); expect((await nested[0]!).status).toBe(503);
    pending[0]!.resolve(new Response(null, { status: 404 })); await flush(); const fresh = h.handle(request()); expect(pending).toHaveLength(17);
    for (const p of pending) p.resolve(new Response(null, { status: 404 })); await Promise.all([first, fresh, ...nested]);
  });
  it('exhausted entry deadline prevents fetch even without firing the timer', async () => {
    let calls = 0; const c = clock(); c.api.now = () => calls++ === 0 ? 0 : 2000;
    const x = handler(vi.fn(async () => wire()), [profile], c); expect((await x.h.handle(request())).status).toBe(503); expect(x.fetcher).not.toHaveBeenCalled();
  });
  it('zero and one-byte native chunks preserve byte accounting', async () => {
    const data = enc.encode(JSON.stringify(policy()));
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array()); for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const x = handler(vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(data.length) } })));
    expect((await x.h.handle(request())).status).toBe(200);
  });
  it.each(['gzip', 'br', 'identity, identity'])('rejects unsupported content encoding %s', async encoding => {
    const x = handler(vi.fn(async () => wire(policy(), { 'Content-Encoding': encoding }))); expect((await x.h.handle(request())).status).toBe(503);
  });
  it('close bounds truly uncooperative fetch and cancellation without claiming they stopped', async () => {
    const pending = deferred<Response>(); const cancel = deferred<void>();
    const h1 = handler(vi.fn(() => pending.promise));
    const h2 = handler(vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ pull() {}, cancel: () => cancel.promise }), { headers: { 'Content-Type': 'application/json' } })));
    const a = h1.h.handle(request()); const b = h2.h.handle(request()); await flush();
    const start = performance.now(); await Promise.all([h1.h.close(), h2.h.close()]);
    expect(performance.now() - start).toBeLessThan(11000); expect((await a).status).toBe(503); expect((await b).status).toBe(503);
    expect((await h1.h.handle(request())).status).toBe(503); pending.resolve(new Response(null, { status: 404 })); cancel.resolve(); await flush();
  }, 15000);
});

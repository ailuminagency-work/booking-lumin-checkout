/** Anonymous minimized policy reads only; no owner or session HTTP capability. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { createInstallationContracts, parseInstallationProfile, parseInstallationOrigin, type InstallationProfile, type InstallationPolicy } from '@lumin/contracts';
import { modeRecord, type ReadOutcome } from './mode-installation-contracts';
import type { ModeClock, ModeOptions } from './mode-installation-repository';

export interface ModePolicyReader {
  publicPolicy(request: unknown, options?: ModeOptions): Promise<ReadOutcome<InstallationPolicy>>;
  close(): Promise<void>;
}
export interface ModePolicyHttpHandler {
  handle(request: IncomingMessage, response: ServerResponse): void;
  close(): Promise<void>;
}
const stringify = JSON.stringify, byteLength = Buffer.byteLength.bind(Buffer), from = Buffer.from.bind(Buffer);
const nativeSet = setTimeout, nativeClear = clearTimeout, ownKeys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE = '/api/public/installation-policies/';
export function modePolicyOrigin(value: string): void {
  if (value.length > 300 || !/^[\x00-\x7f]+$/.test(value)) throw Error('INVALID_POLICY_PROFILE');
  parseInstallationOrigin(value);
  const host = new URL(value).hostname, labels = host.split('.'), last = labels[labels.length - 1]!;
  if (host.includes(':') || labels.some(x => x.startsWith('xn--')) || !/[a-z]/.test(last) || /^0x[0-9a-f]*$/.test(last)) throw Error('INVALID_POLICY_PROFILE');
}
/** Server-internal startup parser; no registration from requests. */
export function modePolicyProfiles(value: unknown): readonly InstallationProfile[] {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw Error('INVALID_POLICY_PROFILE');
  const length = descriptor(value, 'length');
  if (!length || !('value' in length) || ![0, 1].includes(length.value) || ownKeys(value).length !== length.value + 1) throw Error('INVALID_POLICY_PROFILE');
  if (!length.value) return Object.freeze([]);
  const item = descriptor(value, '0');
  if (!item || !('value' in item) || !item.enumerable) throw Error('INVALID_POLICY_PROFILE');
  const raw = modeRecord(item.value, ['profileVersion', 'rendererOrigin', 'apiOrigin', 'portalOrigin', 'loaderUrl']);
  const profile = parseInstallationProfile(raw);
  for (const origin of [profile.rendererOrigin, profile.apiOrigin, profile.portalOrigin]) modePolicyOrigin(origin);
  return Object.freeze([profile]);
}
type Code = 'INVALID_REQUEST' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'UNAVAILABLE';
const statuses: Record<Code, number> = { INVALID_REQUEST: 400, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405, FORBIDDEN: 403, RATE_LIMITED: 429, UNAVAILABLE: 503 };
const errors = Object.fromEntries(Object.keys(statuses).map(code => [code, from(stringify({ schemaVersion: 1, error: { code } }))])) as Record<Code, Buffer>;
interface Window { start: number; count: number }
interface Active { stop(): void; cleanup: Promise<void> }
export function createModePolicyHttpHandler(options: { reader: ModePolicyReader; profiles: unknown; clock?: ModeClock }): ModePolicyHttpHandler {
  const profiles = modePolicyProfiles(options.profiles), profile = profiles[0];
  const contracts = createInstallationContracts(profiles);
  const read = options.reader.publicPolicy.bind(options.reader);
  const supplied = options.clock ?? { monotonic: () => performance.now(), setTimer: (fn: () => void, ms: number) => nativeSet(fn, ms), clearTimer: (timer: unknown) => nativeClear(timer as ReturnType<typeof setTimeout>) };
  const clock: ModeClock = { monotonic: supplied.monotonic.bind(supplied), setTimer: supplied.setTimer.bind(supplied), clearTimer: supplied.clearTimer.bind(supplied) };
  const addresses = new Map<string, Window>(), installations = new Map<string, Window>(), active = new Set<Active>();
  let closed = false, last = -1, databaseActive = 0, closing: Promise<void> | undefined;
  function terminal() { closed = true; for (const item of active) item.stop(); }
  function sample(): number {
    try { const now = clock.monotonic(); if (!Number.isFinite(now) || now < 0 || now < last) throw Error(); last = now; return now; }
    catch { terminal(); throw Error('CLOCK_UNAVAILABLE'); }
  }
  function prune(now: number) { for (const map of [addresses, installations]) for (const [key, window] of map) if (now - window.start >= 60000) map.delete(key); }
  function rate(map: Map<string, Window>, key: string, maximum: number, now: number): number | undefined {
    prune(now);
    const old = map.get(key);
    if (old) { if (old.count >= maximum) return Math.max(1, Math.ceil((old.start + 60000 - now) / 1000)); old.count++; return undefined; }
    if (addresses.size + installations.size >= 10000) {
      let expiry = now + 60000;
      for (const group of [addresses, installations]) for (const window of group.values()) expiry = Math.min(expiry, window.start + 60000);
      return Math.max(1, Math.ceil((expiry - now) / 1000));
    }
    map.set(key, { start: now, count: 1 }); return undefined;
  }
  function handle(req: IncomingMessage, res: ServerResponse): void {
    const head = req.method === 'HEAD';
    let entry: number;
    const baseHeaders = () => {
      res.setHeader('Cache-Control', 'no-store,max-age=0'); res.setHeader('CDN-Cache-Control', 'no-store'); res.setHeader('Netlify-CDN-Cache-Control', 'no-store');
      const origins: string[] = [];
      for (let i=0;i<req.rawHeaders.length;i+=2) if (req.rawHeaders[i]!.toLowerCase() === 'origin') origins.push(req.rawHeaders[i+1]!);
      if (profile && origins.length === 1 && origins[0] === profile.rendererOrigin) { res.setHeader('Access-Control-Allow-Origin', profile.rendererOrigin); res.setHeader('Vary', 'Origin'); }
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    };
    const direct = (code: Code, retry?: number) => {
      if (res.destroyed || res.writableEnded) return;
      baseHeaders(); res.statusCode = statuses[code]; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', errors[code].length);
      if (code === 'METHOD_NOT_ALLOWED') res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      if (retry) res.setHeader('Retry-After', String(retry));
      res.end(head ? undefined : errors[code]);
    };
    try { entry = sample(); } catch { direct('UNAVAILABLE'); return; }
    if (closed || !profile) { direct('UNAVAILABLE'); return; }
    const peer = req.socket.remoteAddress;
    if (!peer || peer.length > 128) { direct('INVALID_REQUEST'); return; }
    const addressRetry = rate(addresses, peer, 120, entry);
    if (addressRetry) { direct('RATE_LIMITED', addressRetry); return; }
    if (active.size >= 16) { direct('RATE_LIMITED', 1); return; }
    const controller = new AbortController();
    let responded = false, pending = false, removed = false, timer: unknown, cors = false;
    let resolveCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { resolveCleanup = resolve; });
    const remove = () => { if (!removed && !pending) { removed = true; active.delete(item); resolveCleanup(); } };
    function finish(code?: Code, data?: Buffer, retry?: number, preflight = false): void {
      if (responded) return;
      responded = true;
      let clearFailed = false;
      try { clock.clearTimer(timer); } catch { clearFailed = true; }
      if (clearFailed) { code = 'UNAVAILABLE'; data = undefined; preflight = false; terminal(); }
      if (code !== 'UNAVAILABLE') {
        try { if (closed || sample() - entry >= 2000) { code = 'UNAVAILABLE'; data = undefined; preflight = false; } }
        catch { code = 'UNAVAILABLE'; data = undefined; preflight = false; }
      }
      req.removeListener('aborted', stop); req.removeListener('error', stop); res.removeListener('close', disconnected);
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent) res.destroy();
        else {
          baseHeaders();
          if (cors) { res.setHeader('Access-Control-Allow-Origin', profile!.rendererOrigin); res.setHeader('Vary', 'Origin'); }
          if (preflight) {
            res.statusCode = 204; res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD'); res.setHeader('Access-Control-Max-Age', '60'); res.end();
          } else if (code) direct(code, retry);
          else { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', data!.length); res.end(head ? undefined : data); }
        }
      }
      remove();
    }
    function stop(): void { controller.abort(); finish('UNAVAILABLE'); }
    function disconnected(): void { if (!res.writableFinished) stop(); }
    function guard(): boolean {
      if (responded) return false;
      try { if (closed || controller.signal.aborted || sample() - entry >= 2000) { stop(); return false; } return true; }
      catch { stop(); return false; }
    }
    const item: Active = { stop, cleanup };
    active.add(item);
    req.once('aborted', stop); req.once('error', stop); res.once('close', disconnected);
    try { timer = clock.setTimer(stop, Math.max(0, 2000 - (sample() - entry))); }
    catch { terminal(); }
    if (!guard()) { remove(); return; }
    const target = req.url ?? '';
    if (target.length > 256 || !/^[\x20-\x7e]+$/.test(target) || !target.startsWith('/') || /[%?#\\]/.test(target) || target.includes('//') || target.split('/').some(x => x === '.' || x === '..')) { finish('INVALID_REQUEST'); return; }
    if (!target.startsWith(BASE)) { finish('NOT_FOUND'); return; }
    const id = target.slice(BASE.length);
    if (!UUID.test(id)) { finish('INVALID_REQUEST'); return; }
    let installationRetry: number | undefined;
    try { installationRetry = rate(installations, id, 600, sample()); } catch { finish('UNAVAILABLE'); return; }
    if (installationRetry) { finish('RATE_LIMITED', undefined, installationRetry); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) { finish('METHOD_NOT_ALLOWED'); return; }
    const values: Record<string, string> = Object.create(null);
    const sensitive = new Set(['host', 'origin', 'authorization', 'cookie', 'content-length', 'transfer-encoding', 'access-control-request-method', 'access-control-request-headers']);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i]!.toLowerCase(), value = req.rawHeaders[i + 1]!;
      if (sensitive.has(key)) { if (Object.hasOwn(values, key)) { finish('INVALID_REQUEST'); return; } values[key] = value; }
    }
    if (values.host !== new URL(profile.apiOrigin).host || values.authorization !== undefined || values.cookie !== undefined || values['transfer-encoding'] !== undefined ||
      (values['content-length'] !== undefined && values['content-length'] !== '0')) { finish('INVALID_REQUEST'); return; }
    if (values.origin !== undefined) {
      if (values.origin !== profile.rendererOrigin) { finish('FORBIDDEN'); return; }
      cors = true;
    }
    if (req.method === 'OPTIONS') {
      if (!cors) { finish('FORBIDDEN'); return; }
      if (!['GET', 'HEAD'].includes(values['access-control-request-method'] ?? '') || (values['access-control-request-headers'] ?? '') !== '') { finish('INVALID_REQUEST'); return; }
      if (guard()) finish(undefined, undefined, undefined, true); return;
    }
    if (databaseActive >= 2) { finish('RATE_LIMITED', undefined, 1); return; }
    if (!guard()) return;
    pending = true; databaseActive++;
    void (async () => {
      try {
        const outcome = await read(Object.freeze({ installationId: id }), { signal: controller.signal });
        if (!guard()) return;
        if (outcome.kind === 'failed' && outcome.code === 'UNAVAILABLE') { finish('NOT_FOUND'); return; }
        if (outcome.kind !== 'completed' || outcome.delivery !== 'data') { finish('UNAVAILABLE'); return; }
        const policy = contracts.parsePolicy(outcome.data);
        if (!policy.enabled || policy.installationId !== id) throw Error();
        for (const origin of [policy.rendererOrigin, policy.apiOrigin, ...policy.allowedParentOrigins]) modePolicyOrigin(origin);
        if (byteLength(stringify(policy.allowedParentOrigins), 'utf8') > 8192 || policy.allowedParentOrigins.some((value, i, list) => i > 0 && value <= list[i - 1]!)) throw Error();
        const body = from(stringify(policy)); if (body.length > 16384) throw Error();
        if (guard()) finish(undefined, body);
      } catch { if (guard()) finish('UNAVAILABLE'); }
      finally { pending = false; databaseActive--; remove(); }
    })();
  }
  return Object.freeze({ handle, close() {
    if (closing) return closing;
    terminal();
    closing = new Promise<void>(resolve => {
      let done = false;
      const complete = () => { if (!done) { done = true; nativeClear(timer); resolve(); } };
      const timer = nativeSet(complete, 10000);
      void Promise.all([...active].map(item => item.cleanup)).then(complete, complete);
    });
    return closing;
  } });
}

import {
  createInstallationContracts, parseInstallationOrigin, parseInstallationProfile,
  parseInstallationRoute, type InstallationPolicy, type InstallationProfile,
} from '@lumin/contracts';

/** Platform Request/fetch/clock are trusted composition, never request-derived seams. */
export interface ModeDocumentClock {
  now(): number;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
}
export interface ModeDocumentOptions {
  profiles: unknown;
  fetch?: typeof globalThis.fetch;
  clock?: ModeDocumentClock;
}
export interface ModeDocumentHandler {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}
const encode = new TextEncoder();
const stringify = JSON.stringify;
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf;
const freeze = Object.freeze;
const isView = ArrayBuffer.isView;
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;
const nativeSetTimer = globalThis.setTimeout.bind(globalThis);
const nativeClearTimer = globalThis.clearTimeout.bind(globalThis);
const nativeNow = performance.now.bind(performance);
const defaultClock: ModeDocumentClock = freeze({
  now: nativeNow,
  setTimer: (callback: () => void, ms: number) => nativeSetTimer(callback, ms),
  clearTimer: (handle: unknown) => nativeClearTimer(handle as ReturnType<typeof setTimeout>),
});
function invalid(): never { throw new Error('INVALID_MODE_DOCUMENT_CONFIGURATION'); }
function originSubset(value: string): void {
  if (value.length > 300 || !/^[\x00-\x7f]+$/.test(value)) invalid();
  parseInstallationOrigin(value);
  const host = new URL(value).hostname;
  const labels = host.split('.');
  const last = labels[labels.length - 1]!;
  if (host.includes(':') || host.startsWith('[') || labels.some(x => x.startsWith('xn--')) ||
    !/[a-z]/.test(last) || /^0x[0-9a-f]*$/.test(last)) invalid();
}
function profilesSnapshot(value: unknown): readonly InstallationProfile[] {
  try {
    if (!Array.isArray(value) || prototype(value) !== Array.prototype) invalid();
    const length = descriptor(value, 'length');
    if (!length || !('value' in length) || (length.value !== 0 && length.value !== 1)) invalid();
    if (ownKeys(value).length !== length.value + 1) invalid();
    if (length.value === 0) return freeze([]);
    const item = descriptor(value, '0');
    if (!item || !('value' in item) || !item.enumerable) invalid();
    const profile = parseInstallationProfile(item.value);
    for (const value of [profile.rendererOrigin, profile.apiOrigin, profile.portalOrigin]) originSubset(value);
    return freeze([profile]);
  } catch { return invalid(); }
}
const policies = ["default-src 'none'", "base-uri 'none'", "object-src 'none'", "script-src 'none'",
  "style-src 'none'", "img-src 'none'", "font-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"];
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function response(status: number, head: boolean, policy?: InstallationPolicy): Response {
  const message = status === 400 ? 'Invalid document request.' : status === 404 ? 'Booking experience unavailable.' :
    status === 405 ? 'Method not allowed.' : 'Booking experience is not available yet.';
  let bootstrap = '';
  if (policy) {
    const json = stringify({ schemaVersion: 1, kind: 'installation_document', operational: false, policy });
    if (encode.encode(json).byteLength > 17408) throw Error('DOCUMENT_LIMIT');
    bootstrap = `<template id="lumin-mode-bootstrap">${escapeText(json)}</template>`;
  }
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Booking experience</title></head>' +
    `<body><main><h1>Booking experience</h1><p>${message}</p>${bootstrap}</main></body></html>`;
  const bytes = encode.encode(html);
  if (bytes.byteLength > (status === 200 ? 32768 : 1024)) throw Error('DOCUMENT_LIMIT');
  const iframe = status === 200 && policy?.mode === 'iframe';
  const ancestors = iframe ? policy.allowedParentOrigins.join(' ') : "'none'";
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'no-store,max-age=0', 'CDN-Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': [...policies, `frame-ancestors ${ancestors}`].join('; '),
  });
  if (!iframe) headers.set('X-Frame-Options', 'DENY');
  if (status === 405) headers.set('Allow', 'GET, HEAD');
  return new Response(head ? null : bytes, { status, headers });
}
interface Operation {
  stop(): void;
  cleanup: Promise<void>;
}
/** Dedicated inert document only. No session runtime, legacy SPA fallback or Edge registration. */
export function createModeDocumentHandler(options: ModeDocumentOptions): ModeDocumentHandler {
  // Reflection may run Proxy traps; caught failures reject, accessors themselves are never read.
  let copied: Record<string, unknown>;
  try {
    if (!options || (prototype(options) !== Object.prototype && prototype(options) !== null)) invalid();
    const keys = ownKeys(options);
    if (keys.length > 3 || !keys.includes('profiles')) invalid();
    copied = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== 'string' || !['profiles', 'fetch', 'clock'].includes(key)) invalid();
      const d = descriptor(options, key);
      if (!d || !('value' in d) || !d.enumerable) invalid();
      copied[key] = d.value;
    }
  } catch { return invalid(); }
  const profiles = profilesSnapshot(copied.profiles);
  const profile = profiles[0];
  const contracts = createInstallationContracts(profiles);
  const fetcher = (copied.fetch ?? globalThis.fetch.bind(globalThis)) as typeof globalThis.fetch;
  const suppliedClock = (copied.clock ?? defaultClock) as ModeDocumentClock;
  const clock: ModeDocumentClock = freeze({
    now: suppliedClock.now.bind(suppliedClock),
    setTimer: suppliedClock.setTimer.bind(suppliedClock),
    clearTimer: suppliedClock.clearTimer.bind(suppliedClock),
  });
  if (typeof fetcher !== 'function') invalid();
  let closed = false;
  let lastTime = -1;
  let closing: Promise<void> | undefined;
  const active = new Set<Operation>();
  function clear(timer: unknown): boolean {
    try { clock.clearTimer(timer); return true; }
    catch { return false; }
  }
  function terminal(): void {
    closed = true;
    for (const operation of active) operation.stop();
  }
  function sample(): number {
    try {
      const now = clock.now();
      if (!Number.isFinite(now) || now < 0 || now < lastTime) throw Error();
      lastTime = now;
      return now;
    } catch { terminal(); throw Error('DOCUMENT_CLOCK_UNAVAILABLE'); }
  }
  async function handle(request: Request): Promise<Response> {
    const head = request.method === 'HEAD';
    let entry: number;
    try { entry = sample(); } catch { return response(503, head); }
    if (closed || !profile) return response(503, head);
    let route: ReturnType<typeof parseInstallationRoute>;
    try {
      const url = new URL(request.url);
      const target = request.url.slice(url.origin.length);
      if (url.origin !== profile.rendererOrigin || target.length > 256 || !/^[\x20-\x7e]+$/.test(target) ||
        /[?%#\\]/.test(target) || target.includes('//') || target.split('/').some(p => p === '.' || p === '..')) return response(400, head);
      try { route = parseInstallationRoute(target); }
      catch { return response(target.startsWith('/checkout/flow') || target.startsWith('/embed/flow') ? 400 : 404, head); }
      if (request.url !== profile.rendererOrigin + target) return response(400, head);
      if (request.method !== 'GET' && request.method !== 'HEAD') return response(405, head);
      const host = request.headers.get('host');
      if ((host !== null && host !== new URL(profile.rendererOrigin).host) || request.headers.has('cookie') ||
        request.headers.has('authorization') || request.headers.has('transfer-encoding') ||
        (request.headers.has('content-length') && request.headers.get('content-length') !== '0') || request.body !== null) return response(400, head);
    } catch { return response(400, head); }
    if (request.signal.aborted) return response(503, head);
    if (active.size >= 16) return response(503, head);
    const controller = new AbortController();
    let resolveResponse!: (value: Response) => void;
    const output = new Promise<Response>(resolve => { resolveResponse = resolve; });
    let timer: unknown;
    let settled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancel: Promise<unknown> | undefined;
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    function cancelBody(): void {
      if (reader && !cancel) {
        try { cancel = Promise.resolve(reader.cancel()).catch(() => {}); } catch { cancel = Promise.resolve(); }
      }
    }
    function settle(status: number, policy?: InstallationPolicy): void {
      if (settled) return;
      let result: Response;
      try { result = response(status, head, policy); }
      catch { result = response(503, head); }
      if (status !== 503 && !guard()) return;
      // Mark settlement before terminal scheduler cleanup, so a failed clear cannot recurse.
      settled = true;
      if (!clear(timer)) {
        result = response(503, head);
        terminal();
      }
      request.signal.removeEventListener('abort', stop);
      resolveResponse(result);
    }
    function stop(): void {
      if (!controller.signal.aborted) controller.abort();
      cancelBody();
      settle(503);
    }
    function guard(): boolean {
      if (settled) return false;
      try {
        if (sample() - entry >= 2000 || closed || request.signal.aborted) { stop(); return false; }
        return true;
      } catch { stop(); return false; }
    }
    const operation: Operation = { stop, cleanup };
    active.add(operation);
    request.signal.addEventListener('abort', stop, { once: true });
    try { timer = clock.setTimer(stop, Math.max(0, 2000 - (sample() - entry))); }
    catch { terminal(); }
    // Slot ownership lasts through late fetch/read/cancel settlement, not merely HTTP output.
    void (async () => {
      try {
        if (!guard()) return;
        const upstream = await fetcher(profile.apiOrigin + '/api/public/installation-policies/' + route.installationId, {
          method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (upstream.body) reader = upstream.body.getReader();
        if (!guard()) { cancelBody(); return; }
        if (upstream.redirected || upstream.type === 'opaque' || upstream.type === 'opaqueredirect') throw Error();
        if (upstream.status === 404) { settle(404); cancelBody(); return; }
        if (upstream.status !== 200 ||
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(upstream.headers.get('content-type') ?? '') ||
          (upstream.headers.has('content-encoding') && upstream.headers.get('content-encoding') !== 'identity')) throw Error();
        const declared = upstream.headers.get('content-length');
        if (declared !== null && (!/^[1-9][0-9]{0,4}$/.test(declared) || Number(declared) > 16384)) throw Error();
        if (!reader) throw Error();
        const buffer = new Uint8Array(16384);
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (!guard()) { cancelBody(); return; }
          if (part.done) break;
          if ((!isView(part.value) || typedArrayName.call(part.value) !== 'Uint8Array') || size + part.value.byteLength > 16384) throw Error();
          buffer.set(part.value, size);
          size += part.value.byteLength;
        }
        if (declared !== null && size !== Number(declared)) throw Error();
        const bytes = buffer.subarray(0, size);
        const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const policy = contracts.parsePolicy(raw);
        for (const origin of [policy.rendererOrigin, policy.apiOrigin, ...policy.allowedParentOrigins]) originSubset(origin);
        if (encode.encode(stringify(policy.allowedParentOrigins)).byteLength > 8192 ||
          policy.allowedParentOrigins.some((origin, i, list) => i > 0 && origin <= list[i - 1]!)) throw Error();
        if (policy.installationId !== route.installationId) throw Error();
        if (!guard()) return;
        if (!policy.enabled || policy.mode !== route.mode) settle(404);
        else settle(200, policy);
      } catch { if (guard()) settle(503); cancelBody(); }
      finally {
        if (cancel) await cancel;
        try { reader?.releaseLock(); } catch { /* Never reuse an unsettled stream. */ }
        active.delete(operation);
        releaseCleanup();
      }
    })();
    return output;
  }
  return freeze({
    handle,
    close(): Promise<void> {
      if (closing) return closing;
      terminal();
      closing = new Promise<void>(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; nativeClearTimer(timer); resolve(); } };
        const timer = nativeSetTimer(finish, 10000);
        void Promise.all([...active].map(operation => operation.cleanup)).then(finish, finish);
      });
      return closing;
    },
  });
}

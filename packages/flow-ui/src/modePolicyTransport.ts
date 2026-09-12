import {
  createInstallationContracts, parseInstallationOrigin, parseInstallationProfile,
  parseInstallationRoute, type InstallationPolicy, type InstallationProfile,
} from '@lumin/contracts';

export interface ModePolicyClock {
  now(): number;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
}
export type ModePolicyOutcome = Readonly<{status: 200; policy: InstallationPolicy}> | Readonly<{status: 404 | 503}>;
export interface ModePolicyTransport<T, C extends boolean | undefined> {
  sample(): number;
  readonly isClosed: boolean;
  read(route: {installationId: string; mode: 'hosted' | 'iframe'}, options: {signal?: AbortSignal; entryTime: number; context: C}): Promise<T>;
  close(): Promise<void>;
}
interface Options<T, C extends boolean | undefined> {
  profiles: unknown;
  fetch?: typeof globalThis.fetch;
  clock?: ModePolicyClock;
  maxActive: 1 | 16;
  /** Internal pure output construction, never an action or merchant callback. */
  project(outcome: ModePolicyOutcome, context: C): T;
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
const defaultClock: ModePolicyClock = freeze({
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
export function modePolicyProfiles(value: unknown): readonly InstallationProfile[] {
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
export function captureModePolicyClock(supplied: ModePolicyClock | undefined): ModePolicyClock {
  const clock = supplied ?? defaultClock;
  return freeze({now: clock.now.bind(clock), setTimer: clock.setTimer.bind(clock), clearTimer: clock.clearTimer.bind(clock)});
}
interface Operation {
  stop(): void;
  cleanup: Promise<void>;
}
/** Shared internal policy reader. It is intentionally absent from package exports. */
export function createModePolicyTransport<T, C extends boolean | undefined>(options: Options<T, C>): ModePolicyTransport<T, C> {
  const profiles = modePolicyProfiles(options.profiles);
  const profile = profiles[0];
  const contracts = createInstallationContracts(profiles);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const clock = captureModePolicyClock(options.clock);
  const project = options.project;
  const maxActive = options.maxActive;
  if (typeof fetcher !== 'function' || typeof project !== 'function' || (maxActive !== 1 && maxActive !== 16)) invalid();
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
  async function read(route: {installationId: string; mode: 'hosted' | 'iframe'}, call: {signal?: AbortSignal; entryTime: number; context: C}): Promise<T> {
    const signal = call.signal;
    const entry = call.entryTime;
    const context = call.context;
    const unavailable = () => project(freeze({status: 503 as const}), context);
    try {
      if (!route || typeof route !== 'object' || Reflect.ownKeys(route).length !== 2) return unavailable();
      const idValue = descriptor(route, 'installationId');
      const modeValue = descriptor(route, 'mode');
      if (!idValue || !modeValue || !idValue.enumerable || !modeValue.enumerable || !('value' in idValue) || !('value' in modeValue) ||
        typeof idValue.value !== 'string' || !['hosted', 'iframe'].includes(modeValue.value)) return unavailable();
      route = {installationId: idValue.value, mode: modeValue.value};
      parseInstallationRoute((route.mode === 'hosted' ? '/checkout/flow/' : '/embed/flow/') + route.installationId);
      if (!Number.isFinite(entry) || entry < 0 || (lastTime < entry && sample() < entry)) return unavailable();
      if (closed || !profile || signal?.aborted || active.size >= maxActive) return unavailable();
    } catch { return unavailable(); }
    const controller = new AbortController();
    let resolveResponse!: (value: T) => void;
    let rejectResponse!: (error: unknown) => void;
    const output = new Promise<T>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    let timer: unknown;
    let settled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancel: Promise<unknown> | undefined;
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    function cancelBody(): void {
      if (reader && !cancel) {
        try { cancel = Promise.resolve(reader.cancel()).catch(() => { terminal(); }); } catch { cancel = Promise.resolve(); terminal(); }
      }
    }
    function releaseReader(): boolean {
      if (!reader) return true;
      const owned = reader;
      reader = undefined;
      try { owned.releaseLock(); return true; }
      catch { terminal(); return false; }
    }
    function settle(status: number, policy?: InstallationPolicy): void {
      if (settled) return;
      let result: T;
      try { result = project(freeze(status === 200 && policy ? {status: 200 as const, policy} : {status: status === 404 ? 404 as const : 503 as const}), context); }
      catch {
        try { result = unavailable(); } catch { settled = true; clear(timer); terminal(); rejectResponse(Error('INVALID_POLICY_PROJECTION')); return; }
      }
      if (status !== 503 && !guard()) return;
      // Mark settlement before terminal scheduler cleanup, so a failed clear cannot recurse.
      settled = true;
      if (!clear(timer)) {
        result = unavailable();
        terminal();
      }
      // Cleanup is part of the caller budget; a fresh sample can only withhold delivery.
      if (status !== 503) {
        try {
          if (closed || signal?.aborted || controller.signal.aborted || sample() - entry >= 2000) result = unavailable();
        } catch { result = unavailable(); }
      }
      signal?.removeEventListener('abort', stop);
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
        if (sample() - entry >= 2000 || closed || signal?.aborted) { stop(); return false; }
        return true;
      } catch { stop(); return false; }
    }
    const operation: Operation = { stop, cleanup };
    active.add(operation);
    signal?.addEventListener('abort', stop, { once: true });
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
        if (upstream.status === 404) {
          cancelBody();
          if (cancel) await cancel;
          if (releaseReader() && guard()) settle(404);
          return;
        }
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
        if (!releaseReader() || !guard()) return;
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
        releaseReader();
        active.delete(operation);
        releaseCleanup();
      }
    })();
    return output;
  }
  return freeze({
    read,
    sample,
    get isClosed() { return closed; },
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

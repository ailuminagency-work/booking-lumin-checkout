import {
  INSTALLATION_LIMITS as LIMITS,
  parseInstallationMessage,
  parseInstallationOrigin,
  parseInstallationRoute,
} from '../../contracts/src/installation';

/** Trusted build identity deliberately excludes the loader's own final digest. */
export type ModeLoaderIdentity = Readonly<{
  abiVersion: 1;
  rendererOrigin: string;
  apiOrigin: string;
  portalOrigin: string;
  profileVersion: string;
}>;
export type ModeLoaderClock = Readonly<{
  now(): number;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
}>;
export type ModeMountResult = 'mounted' | 'already_mounted' | 'unregistered' |
  'invalid_container' | 'capacity' | 'suspended' | 'unavailable';
export type ModeLoaderApi = Readonly<{
  protocolVersion: 1;
  mount(container: unknown): ModeMountResult;
  unmount(container: unknown): boolean;
}>;
export type ModeLoaderOptions = Readonly<{
  identity: ModeLoaderIdentity;
  window?: Window & typeof globalThis;
  clock?: ModeLoaderClock;
  entropy?: (bytes: Uint8Array) => void;
}>;

type Browser = Window & typeof globalThis;
type Binding = Readonly<{ id: string; height: number; rawHeight: string | null; loaderUrl: string }>;
type Registration = { binding: Binding; attempted: boolean };
type Timer = { handle: unknown; cancelled: boolean };
type Slot = {
  container: HTMLDivElement;
  registration: Registration;
  generation: number;
  state: 'reserving' | 'loading' | 'handshake' | 'ready' | 'terminal';
  frame: HTMLIFrameElement | null;
  source: Window | null;
  instanceId: string;
  load: () => void;
  loadedAt: number;
  handshakeTimer: Timer | null;
  resizeTimer: Timer | null;
  resizeStart: number;
  resizeCount: number;
  pendingHeight: number | null;
};
type Coordinator = Readonly<{
  identity: string;
  api: ModeLoaderApi;
  register(script: HTMLScriptElement): void;
}>;
const OWNER = Symbol.for('booking-lumin.mount-owner.v1');
const INSTALLATION = 'data-booking-lumin-installation';
const HEIGHT = 'data-booking-lumin-height';
const PROFILE = /^[a-z][a-z0-9-]{0,63}$/;
const LOADER_PATH = /^\/assets\/booking-lumin-loader\.[0-9a-f]{64}\.js$/;

function identitySnapshot(value: ModeLoaderIdentity): ModeLoaderIdentity {
  const keys = ['abiVersion', 'rendererOrigin', 'apiOrigin', 'portalOrigin', 'profileVersion'];
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== keys.length) throw Error();
  const data: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error();
    data[key] = descriptor.value;
  }
  if (data.abiVersion !== 1 || typeof data.profileVersion !== 'string' ||
      !PROFILE.test(data.profileVersion)) throw Error();
  const rendererOrigin = parseInstallationOrigin(data.rendererOrigin);
  const apiOrigin = parseInstallationOrigin(data.apiOrigin);
  const portalOrigin = parseInstallationOrigin(data.portalOrigin);
  if (new Set([rendererOrigin, apiOrigin, portalOrigin]).size !== 3) throw Error();
  return Object.freeze({ abiVersion: 1, rendererOrigin, apiOrigin, portalOrigin, profileVersion: data.profileVersion });
}

function scriptMatches(win: Browser, script: unknown, identity: ModeLoaderIdentity): script is HTMLScriptElement {
  if (!(script instanceof win.HTMLScriptElement) || script.ownerDocument !== win.document ||
      !script.isConnected || script.getRootNode() !== win.document ||
      (script.getAttribute('type') ?? '') !== '') return false;
  const src = script.getAttribute('src');
  if (!src || src.length > 4096) return false;
  const url = new URL(src);
  return src === url.href && url.origin === identity.rendererOrigin && !url.search && !url.hash &&
    src === identity.rendererOrigin + url.pathname && LOADER_PATH.test(url.pathname);
}

function merchantMatches(win: Browser, identity: ModeLoaderIdentity): boolean {
  const origin = parseInstallationOrigin(win.location.origin);
  return win.parent === win && origin !== identity.rendererOrigin && origin !== identity.apiOrigin &&
    origin !== identity.portalOrigin;
}

/** Classic entry: call synchronously while document.currentScript identifies the paired script.
 * Optional browser/clock/entropy are trusted construction seams, never merchant mount options.
 */
export function installModeLoader(options: ModeLoaderOptions): ModeLoaderApi | null {
  const win = options.window ?? window;
  const script = win.document.currentScript;
  try {
    const identity = identitySnapshot(options.identity);
    if (!merchantMatches(win, identity) || !scriptMatches(win, script, identity)) return null;
    const key = JSON.stringify(identity);
    const existing = Object.getOwnPropertyDescriptor(win, OWNER);
    const published = Object.getOwnPropertyDescriptor(win, 'BookingLumin');
    if (existing || published) {
      if (!existing || !published || !('value' in existing) || !('value' in published) ||
          existing.writable || existing.configurable || existing.enumerable ||
          published.writable || published.configurable || published.enumerable) return null;
      const owner = existing.value as Coordinator;
      if (!owner || !Object.isFrozen(owner) || Reflect.ownKeys(owner).length !== 3) return null;
      const id = Object.getOwnPropertyDescriptor(owner, 'identity');
      const api = Object.getOwnPropertyDescriptor(owner, 'api');
      const register = Object.getOwnPropertyDescriptor(owner, 'register');
      if (!id || !api || !register || !('value' in id) || !('value' in api) || !('value' in register) ||
          id.value !== key || api.value !== published.value || !Object.isFrozen(api.value) ||
          typeof register.value !== 'function') return null;
      register.value(script);
      return api.value as ModeLoaderApi;
    }
    const owner = createOwner(win, identity, key, options.clock, options.entropy);
    // Define the coordinator first. A partial installation never registers a frame.
    Object.defineProperty(win, OWNER, { value: owner });
    Object.defineProperty(win, 'BookingLumin', { value: owner.api });
    owner.register(script);
    return owner.api;
  } catch {
    return null;
  }
}

function createOwner(win: Browser, identity: ModeLoaderIdentity, key: string,
  suppliedClock?: ModeLoaderClock, suppliedEntropy?: (bytes: Uint8Array) => void): Coordinator {
  const nativeSetTimer = win.setTimeout.bind(win);
  const nativeClearTimer = win.clearTimeout.bind(win);
  const clock = suppliedClock ?? {
    now: win.performance.now.bind(win.performance),
    setTimer: nativeSetTimer,
    clearTimer: (handle: unknown) => nativeClearTimer(handle as number),
  };
  const now = clock.now.bind(clock);
  const setTimer = clock.setTimer.bind(clock);
  const clearTimer = clock.clearTimer.bind(clock);
  const fill = suppliedEntropy ?? win.crypto.getRandomValues.bind(win.crypto);
  const registrations = new WeakMap<HTMLDivElement, Registration>();
  const slots = new Map<HTMLDivElement, Slot>();
  const timers = new Set<Timer>();
  let closed = false;
  let suspended = false;
  let lastTime = -Infinity;
  let generation = 0;
  let scanTimer: Timer | null = null;
  let listening = false;
  let lifecycleInstalled = false;

  function stopTimer(timer: Timer | null): void {
    if (!timer || timer.cancelled) return;
    timer.cancelled = true;
    timers.delete(timer);
    try { clearTimer(timer.handle); } catch { terminal(); }
  }
  function terminal(): void {
    if (closed) return;
    closed = true;
    for (const slot of [...slots.values()]) dispose(slot);
    for (const timer of [...timers]) stopTimer(timer);
    win.removeEventListener('message', onMessage);
    listening = false;
  }
  function sample(): number | null {
    if (closed) return null;
    try {
      const time = now();
      if (!Number.isFinite(time) || time < 0 || time < lastTime) throw Error();
      lastTime = time;
      return time;
    } catch { terminal(); return null; }
  }
  function schedule(callback: () => void, milliseconds: number): Timer | null {
    if (closed) return null;
    const timer: Timer = { handle: undefined, cancelled: false };
    timers.add(timer);
    try {
      timer.handle = setTimer(() => {
        if (timer.cancelled) return;
        timer.cancelled = true;
        timers.delete(timer);
        if (!closed) callback();
      }, Math.max(0, milliseconds));
      return timer;
    } catch {
      timer.cancelled = true;
      timers.delete(timer);
      terminal();
      return null;
    }
  }
  function element(value: unknown): value is HTMLDivElement {
    return value instanceof win.HTMLDivElement && value.ownerDocument === win.document &&
      value.isConnected && value.getRootNode() === win.document;
  }
  function attributes(container: HTMLDivElement): { id: string; height: number; rawHeight: string | null } | null {
    for (const name of container.getAttributeNames()) {
      if (name.startsWith('data-booking-lumin-') && name !== INSTALLATION && name !== HEIGHT) return null;
    }
    const rawId = container.getAttribute(INSTALLATION);
    if (!rawId || rawId.length !== 36) return null;
    const id = parseInstallationRoute('/embed/flow/' + rawId).installationId;
    const rawHeight = container.getAttribute(HEIGHT);
    if (rawHeight !== null && (rawHeight.length > 4 || !/^[1-9][0-9]{2,3}$/.test(rawHeight))) return null;
    const height = rawHeight === null ? LIMITS.initialHeight : Number(rawHeight);
    if (height < LIMITS.minHeight || height > LIMITS.maxHeight) return null;
    return { id, height, rawHeight };
  }
  function contents(container: HTMLDivElement, owned: HTMLIFrameElement | null): boolean {
    for (const node of container.childNodes) {
      if (node === owned) continue;
      if (node.nodeType === 8) continue;
      if (node.nodeType !== 3 || !/^\s*$/.test(node.textContent ?? '')) return false;
    }
    return true;
  }
  function valid(slot: Slot): boolean {
    if (slots.get(slot.container) !== slot || slot.state === 'terminal' || !element(slot.container)) return false;
    const current = attributes(slot.container);
    const binding = slot.registration.binding;
    if (!current || current.id !== binding.id || current.rawHeight !== binding.rawHeight) return false;
    if (slot.state === 'reserving') return contents(slot.container, null);
    return !!slot.frame && slot.frame.parentNode === slot.container && slot.frame.isConnected &&
      contents(slot.container, slot.frame) && slot.frame.contentWindow === slot.source;
  }
  function sweep(): void {
    for (const slot of [...slots.values()]) {
      try { if (!valid(slot)) dispose(slot); } catch { dispose(slot); }
    }
  }
  function dispose(slot: Slot): void {
    if (slot.state === 'terminal') return;
    slot.state = 'terminal';
    slot.generation = -1;
    if (slots.get(slot.container) === slot) slots.delete(slot.container);
    stopTimer(slot.handshakeTimer);
    stopTimer(slot.resizeTimer);
    slot.handshakeTimer = slot.resizeTimer = null;
    slot.pendingHeight = null;
    if (slot.frame) {
      slot.frame.removeEventListener('load', slot.load);
      // Only the exact owned frame is removed; replacement merchant children survive.
      slot.frame.remove();
    }
    slot.frame = null;
    slot.source = null;
    if (slots.size === 0) {
      stopTimer(scanTimer);
      scanTimer = null;
      win.removeEventListener('message', onMessage);
      listening = false;
    }
  }
  function ensureScan(): void {
    if (scanTimer || slots.size === 0 || closed) return;
    scanTimer = schedule(() => {
      scanTimer = null;
      if (sample() === null) return;
      sweep();
      ensureScan();
    }, 250);
  }
  function live(slot: Slot): boolean {
    sweep();
    return !closed && !suspended && slots.get(slot.container) === slot && slot.state !== 'terminal';
  }
  function handshake(slot: Slot): void {
    if (!live(slot) || slot.state !== 'handshake') return;
    const time = sample();
    if (time === null) return;
    const elapsed = time - slot.loadedAt;
    if (elapsed >= LIMITS.handshakeMs) { dispose(slot); return; }
    try {
      slot.source!.postMessage({ type: 'lumin:init', protocolVersion: 1,
        installationId: slot.registration.binding.id, instanceId: slot.instanceId }, identity.rendererOrigin);
    } catch { dispose(slot); return; }
    if (!live(slot) || slot.state !== 'handshake') return;
    const next = slot.loadedAt + (Math.floor(elapsed / LIMITS.initRetryMs) + 1) * LIMITS.initRetryMs;
    const after = sample();
    if (after === null) return;
    if (after - slot.loadedAt >= LIMITS.handshakeMs) { dispose(slot); return; }
    slot.handshakeTimer = schedule(() => { slot.handshakeTimer = null; handshake(slot); }, next - after);
  }
  function loaded(slot: Slot): void {
    if (!live(slot)) return;
    if (slot.state !== 'loading') { dispose(slot); return; }
    const time = sample();
    if (time === null) return;
    slot.loadedAt = time;
    slot.state = 'handshake';
    handshake(slot);
  }
  function resize(slot: Slot, height: number, time: number): void {
    if (time - slot.resizeStart >= 1000) {
      slot.resizeStart += Math.floor((time - slot.resizeStart) / 1000) * 1000;
      slot.resizeCount = 0;
    }
    slot.pendingHeight = height;
    if (slot.resizeCount < LIMITS.maxResizePerSecond) {
      slot.frame!.height = String(slot.pendingHeight);
      slot.pendingHeight = null;
      slot.resizeCount++;
      stopTimer(slot.resizeTimer);
      slot.resizeTimer = null;
    } else if (!slot.resizeTimer) {
      slot.resizeTimer = schedule(() => {
        slot.resizeTimer = null;
        if (!live(slot) || slot.state !== 'ready') return;
        const at = sample();
        if (at === null || slot.pendingHeight === null) return;
        resize(slot, slot.pendingHeight, at);
      }, slot.resizeStart + 1000 - time);
    }
  }
  function onMessage(event: MessageEvent): void {
    sweep();
    if (closed || suspended || event.origin !== identity.rendererOrigin) return;
    const slot = [...slots.values()].find(candidate => candidate.source === event.source && candidate.source !== null);
    if (!slot || (slot.state !== 'handshake' && slot.state !== 'ready')) return;
    try {
      const message = parseInstallationMessage(event.data);
      if (message.installationId !== slot.registration.binding.id || message.instanceId !== slot.instanceId) return;
      const time = sample();
      if (time === null || !live(slot)) return;
      if (slot.state === 'handshake' && time - slot.loadedAt >= LIMITS.handshakeMs) { dispose(slot); return; }
      if (message.type === 'lumin:ready' && slot.state === 'handshake') {
        stopTimer(slot.handshakeTimer);
        slot.handshakeTimer = null;
        const after = sample();
        if (after === null || !live(slot)) return;
        if (after - slot.loadedAt >= LIMITS.handshakeMs) { dispose(slot); return; }
        slot.state = 'ready';
        slot.resizeStart = after;
      } else if (message.type === 'lumin:resize' && slot.state === 'ready') resize(slot, message.height, time);
    } catch { /* Invalid messages have no lifecycle effects. */ }
  }
  function mount(value: unknown): ModeMountResult {
    try {
      sweep();
      if (closed) return 'unavailable';
      if (suspended) return 'suspended';
      if (sample() === null) return 'unavailable';
      if (!element(value)) return 'invalid_container';
      const registration = registrations.get(value);
      if (!registration) return 'unregistered';
      const current = attributes(value);
      if (!current || current.id !== registration.binding.id || current.rawHeight !== registration.binding.rawHeight) return 'invalid_container';
      if (slots.has(value)) return 'already_mounted';
      if (!contents(value, null) || !merchantMatches(win, identity)) return 'invalid_container';
      if (sample() === null) return 'unavailable';
      if (slots.size >= LIMITS.maxInstances) return 'capacity';
      if (!Number.isSafeInteger(generation + 1)) { terminal(); return 'unavailable'; }
      const slot: Slot = { container: value, registration, generation: ++generation, state: 'reserving',
        frame: null, source: null, instanceId: '', load: () => loaded(slot), loadedAt: 0,
        handshakeTimer: null, resizeTimer: null, resizeStart: 0, resizeCount: 0, pendingHeight: null };
      slots.set(value, slot); // Atomic reservation precedes trusted entropy (including reentrant seams).
      try {
        const bytes = new Uint8Array(16);
        fill(bytes);
        if (!live(slot)) return 'unavailable';
        slot.instanceId = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const frame = win.document.createElement('iframe');
        slot.frame = frame;
        frame.title = 'Booking form';
        frame.width = '100%';
        frame.height = String(registration.binding.height);
        frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
        frame.referrerPolicy = 'no-referrer';
        frame.src = identity.rendererOrigin + '/embed/flow/' + registration.binding.id;
        frame.addEventListener('load', slot.load);
        slot.state = 'loading';
        value.appendChild(frame);
        slot.source = frame.contentWindow;
        if (!slot.source) throw Error();
        if (!listening) { win.addEventListener('message', onMessage); listening = true; }
        ensureScan();
        if (sample() === null || !live(slot)) return 'unavailable';
        return 'mounted';
      } catch { dispose(slot); return 'unavailable'; }
    } catch { return 'invalid_container'; }
  }
  const api: ModeLoaderApi = Object.freeze({ protocolVersion: 1, mount,
    unmount(value: unknown): boolean {
      try {
        const slot = slots.get(value as HTMLDivElement);
        if (!slot) return false;
        dispose(slot);
        return true;
      } catch { return false; }
    },
  });
  function register(script: HTMLScriptElement): void {
    try {
      if (!lifecycleInstalled) {
        win.addEventListener('pagehide', pagehide);
        win.addEventListener('pageshow', pageshow);
        lifecycleInstalled = true;
      }
      sweep();
      if (closed || !merchantMatches(win, identity) || !scriptMatches(win, script, identity)) return;
      const container = script.previousElementSibling;
      if (!element(container)) return;
      const existing = registrations.get(container);
      if (existing) return; // Duplicate script execution never retries a failed mount.
      const current = attributes(container);
      if (!current || !contents(container, null)) return;
      registrations.set(container, { binding: Object.freeze({ ...current, loaderUrl: script.getAttribute('src')! }), attempted: true });
      mount(container);
    } catch { /* Malformed installation markup never starts a channel. */ }
  }
  function pagehide(): void {
    suspended = true;
    for (const slot of [...slots.values()]) dispose(slot);
  }
  function pageshow(event: PageTransitionEvent): void {
    if (event.persisted && !closed) suspended = false;
  }
  return Object.freeze({ identity: key, api, register });
}

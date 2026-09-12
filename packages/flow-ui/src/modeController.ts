import {
  createInstallationContracts, parseInstallationMessage, parseInstallationOrigin,
  parseInstallationRoute, type InstallationPolicy, type InstallationProfile,
} from '@lumin/contracts';
import {
  createModePolicyTransport, modePolicyProfiles, captureModePolicyClock,
  type ModePolicyClock, type ModePolicyOutcome,
} from './modePolicyTransport';

export type ModeControllerState = 'STARTING_POLICY' | 'AWAITING_INIT' | 'READY' | 'TERMINAL';
export interface ModeControllerOptions {
  profile: InstallationProfile;
  /** Trusted browser realm/test composition; never merchant attributes. */
  window?: Window;
  fetch?: typeof globalThis.fetch;
  clock?: ModePolicyClock;
}
export interface ModeController {
  readonly state: ModeControllerState;
  readonly operational: false;
  dispose(): Promise<void>;
}
interface Timer { handle?: unknown; active: boolean }
interface PendingInit { instanceId: string; origin: string }
const freeze = Object.freeze;
const encoder = new TextEncoder();
function invalid(): never { throw Error('INVALID_MODE_CONTROLLER_CONFIGURATION'); }
function data(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object') invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d)) invalid();
    result[key as string] = d.value;
  }
  return result;
}

/** Distribution initialization only. Never issues sessions or exposes an action callback. */
export function createModeController(options: ModeControllerOptions): ModeController {
  let copied: Record<string, unknown>;
  try { copied = data(options, ['profile'], ['window', 'fetch', 'clock']); }
  catch { return invalid(); }
  const profiles = modePolicyProfiles([copied.profile]);
  const profile = profiles[0]!;
  const contracts = createInstallationContracts(profiles);
  const win = (copied.window ?? globalThis.window) as Window;
  const ownerKey = Symbol.for('booking-lumin.controller-owner.v1');
  const previous = Object.getOwnPropertyDescriptor(win, ownerKey);
  if (previous) {
    try {
      if (!('value' in previous) || previous.writable || previous.configurable || previous.enumerable) invalid();
      const record = data(previous.value, ['abiVersion', 'profile', 'controller']);
      if (!Object.isFrozen(previous.value) || record.abiVersion !== 1) invalid();
      const oldProfile = modePolicyProfiles([record.profile])[0]!;
      if (oldProfile.profileVersion !== profile.profileVersion || oldProfile.rendererOrigin !== profile.rendererOrigin ||
        oldProfile.apiOrigin !== profile.apiOrigin || oldProfile.portalOrigin !== profile.portalOrigin || oldProfile.loaderUrl !== profile.loaderUrl) invalid();
      const controller = record.controller;
      if (!controller || typeof controller !== 'object' || !Object.isFrozen(controller) || Reflect.ownKeys(controller).length !== 3) invalid();
      const state = Object.getOwnPropertyDescriptor(controller, 'state');
      const operational = Object.getOwnPropertyDescriptor(controller, 'operational');
      const dispose = Object.getOwnPropertyDescriptor(controller, 'dispose');
      if (!state || typeof state.get !== 'function' || state.set !== undefined || !state.enumerable ||
        !operational || !('value' in operational) || operational.value !== false || !operational.enumerable ||
        !dispose || !('value' in dispose) || typeof dispose.value !== 'function' || !dispose.enumerable) invalid();
      return controller as ModeController;
    } catch { return invalid(); }
  }
  const doc = win.document;
  const clock = captureModePolicyClock(copied.clock as ModePolicyClock | undefined);
  const parent = win.parent;
  const addWindow = win.addEventListener.bind(win);
  const removeWindow = win.removeEventListener.bind(win);
  const addDocument = doc.addEventListener.bind(doc);
  const removeDocument = doc.removeEventListener.bind(doc);
  let state: ModeControllerState = 'STARTING_POLICY';
  let lastTime = -1;
  let entry = 0;
  let route: ReturnType<typeof parseInstallationRoute>;
  let baseline: InstallationPolicy | undefined;
  let pending: PendingInit | undefined;
  let readySent = false;
  let inFlight = false;
  let pendingRefresh = false;
  let needsFresh = false;
  let lastRead = 0;
  let initWindow = -1;
  let initCount = 0;
  let resizeWindow = -1;
  let resizeCount = 0;
  let latestHeight: number | undefined;
  let lastHeight: number | undefined;
  const timers = new Set<Timer>();
  let refreshTimer: Timer | undefined;
  let handshakeTimer: Timer | undefined;
  let resizeTimer: Timer | undefined;
  let observer: ResizeObserver | undefined;
  let closing: Promise<void> | undefined;
  const abort = new AbortController();
  const transport = createModePolicyTransport<ModePolicyOutcome, undefined>({
    profiles, fetch: copied.fetch as typeof globalThis.fetch | undefined,
    clock, maxActive: 1, project: outcome => freeze(outcome),
  });
  function transition(next: ModeControllerState): void {
    state = next;
    try {
      doc.documentElement.setAttribute('data-booking-lumin-state', next === 'READY' ? 'ready' : next === 'TERMINAL' ? 'unavailable' : 'pending');
      doc.documentElement.setAttribute('data-booking-lumin-operational', 'false');
    } catch { if (next !== 'TERMINAL') terminate(); }
  }
  function isTerminal(): boolean { return state === 'TERMINAL'; }
  function clear(timer: Timer | undefined): void {
    if (!timer?.active) return;
    timer.active = false;
    timers.delete(timer);
    try { clock.clearTimer(timer.handle); } catch { terminate(); }
  }
  function terminate(): void {
    if (isTerminal()) return;
    transition('TERMINAL');
    pending = undefined;
    pendingRefresh = false;
    latestHeight = undefined;
    abort.abort();
    for (const timer of [...timers]) clear(timer);
    try { observer?.disconnect(); } catch { /* Admission is already terminal. */ }
    observer = undefined;
    removeWindow('message', onMessage);
    removeWindow('pagehide', onPageHide);
    removeDocument('visibilitychange', onVisibility);
    closing = transport.close();
  }
  function sample(): number {
    try {
      const value = clock.now();
      if (!Number.isFinite(value) || value < 0 || value < lastTime) throw Error();
      lastTime = value;
      return value;
    } catch { terminate(); throw Error('MODE_CONTROLLER_CLOCK_UNAVAILABLE'); }
  }
  function schedule(callback: () => void, delay: number): Timer | undefined {
    if (isTerminal()) return;
    const timer: Timer = { active: true };
    timers.add(timer);
    try {
      timer.handle = clock.setTimer(() => {
        if (!timer.active || isTerminal()) return;
        timer.active = false;
        timers.delete(timer);
        try { sample(); callback(); } catch { terminate(); }
      }, Math.max(0, delay));
      if (!timer.active || isTerminal()) {
        try { clock.clearTimer(timer.handle); } catch { terminate(); }
      }
      return timer;
    } catch { terminate(); return; }
  }
  function direct(): boolean {
    return parent !== win && parent === win.top && parent === win.parent;
  }
  function samePolicy(value: InstallationPolicy): boolean {
    return !baseline || (value.installationId === baseline.installationId && value.mode === baseline.mode &&
      value.deploymentProfileVersion === baseline.deploymentProfileVersion && value.currentVersionId === baseline.currentVersionId &&
      value.targetRevision === baseline.targetRevision && value.policyRevision === baseline.policyRevision);
  }
  function emitResize(): void {
    if (state !== 'READY' || route.mode !== 'iframe' || doc.hidden || needsFresh || !pending || latestHeight === undefined) return;
    const now = sample();
    if (!direct()) { terminate(); return; }
    const window = Math.floor((now - entry) / 1000);
    if (window !== resizeWindow) { resizeWindow = window; resizeCount = 0; }
    if (latestHeight === lastHeight) { latestHeight = undefined; return; }
    if (resizeCount >= 4) {
      if (!resizeTimer?.active) resizeTimer = schedule(emitResize, entry + (window + 1) * 1000 - now);
      return;
    }
    const height = latestHeight;
    latestHeight = undefined;
    resizeCount++;
    lastHeight = height;
    parent.postMessage({ type: 'lumin:resize', protocolVersion: 1, installationId: route.installationId,
      instanceId: pending.instanceId, height }, pending.origin);
  }
  function measure(): void {
    if (state !== 'READY' || route.mode !== 'iframe' || doc.hidden || needsFresh) return;
    try {
      const height = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
      if (!Number.isFinite(height)) { terminate(); return; }
      latestHeight = Math.max(320, Math.min(1600, height));
      emitResize();
    } catch { terminate(); }
  }
  function ready(): void {
    if (isTerminal() || !baseline || doc.hidden || needsFresh || inFlight) return;
    if (route.mode === 'hosted') { transition('READY'); return; }
    if (!pending) { transition('AWAITING_INIT'); return; }
    if (!direct() || !baseline.allowedParentOrigins.includes(pending.origin)) { terminate(); return; }
    if (!readySent) {
      if (sample() - entry >= 5000) { terminate(); return; }
      clear(handshakeTimer);
      if (isTerminal() || sample() - entry >= 5000) { terminate(); return; }
      readySent = true;
      transition('READY');
      if (isTerminal() || sample() - entry >= 5000) { terminate(); return; }
      try {
        parent.postMessage({ type: 'lumin:ready', protocolVersion: 1, installationId: route.installationId,
          instanceId: pending.instanceId }, pending.origin);
        const Resize = (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
        observer = new Resize(measure);
        observer.observe(doc.documentElement);
        if (doc.body) observer.observe(doc.body);
      } catch { terminate(); return; }
    } else transition('READY');
    measure();
  }
  function scheduleRefresh(): void {
    clear(refreshTimer);
    if (isTerminal() || doc.hidden || inFlight) return;
    refreshTimer = schedule(() => requestRefresh(), Math.max(0, lastRead + 30000 - sample()));
  }
  function requestRefresh(initial = false): void {
    if (isTerminal() || (!initial && doc.hidden)) return;
    if (inFlight) { pendingRefresh = true; return; }
    inFlight = true;
    transition('STARTING_POLICY');
    clear(refreshTimer);
    let started: number;
    try { started = sample(); } catch { return; }
    lastRead = started;
    void transport.read(route, { signal: abort.signal, entryTime: started, context: undefined }).then(outcome => {
      if (isTerminal()) return;
      inFlight = false;
      try {
        if (sample() - started >= 2000 || outcome.status !== 200 || !samePolicy(outcome.policy)) { terminate(); return; }
        baseline = outcome.policy;
        if (route.mode === 'iframe' && pending && !baseline.allowedParentOrigins.includes(pending.origin)) { terminate(); return; }
        if (doc.hidden) { needsFresh = true; transition('STARTING_POLICY'); return; }
        // A visibility transition during an in-flight read requires one newly started read.
        if (pendingRefresh) { pendingRefresh = false; requestRefresh(); return; }
        needsFresh = false;
        ready();
        scheduleRefresh();
      } catch { terminate(); }
    }, () => terminate());
  }
  function onMessage(event: MessageEvent): void {
    if (isTerminal() || route.mode !== 'iframe' || !direct() || event.source !== parent) return;
    try {
      const message = parseInstallationMessage(event.data);
      if (message.type !== 'lumin:init') return;
      const window = Math.floor((sample() - entry) / 5000);
      if (window !== initWindow) { initWindow = window; initCount = 0; }
      if (++initCount > 10) return;
      const origin = parseInstallationOrigin(event.origin);
      if ([profile.rendererOrigin, profile.apiOrigin, profile.portalOrigin].includes(origin) || message.installationId !== route.installationId) return;
      if (pending && (message.instanceId !== pending.instanceId || origin !== pending.origin)) return;
      if (readySent) return;
      if (sample() - entry >= 5000) { terminate(); return; }
      if (!pending) pending = { instanceId: message.instanceId, origin };
      ready();
    } catch { /* Invalid messages have no retained effect; clock failure already terminates. */ }
  }
  function onVisibility(): void {
    if (isTerminal()) return;
    try {
      sample();
      if (doc.hidden) {
        needsFresh = true;
        clear(refreshTimer);
        clear(resizeTimer);
        return;
      }
      if (inFlight) { if (needsFresh) pendingRefresh = true; return; }
      requestRefresh();
    } catch { terminate(); }
  }
  function onPageHide(): void { terminate(); }
  const publicController: ModeController = freeze({
    get state() { return state; },
    operational: false as const,
    dispose(): Promise<void> { terminate(); return closing ?? Promise.resolve(); },
  });
  // Window ownership spans repeated classic IIFE evaluations, unlike a module-local WeakMap.
  try {
    Object.defineProperty(win, ownerKey, {value: freeze({abiVersion: 1, profile, controller: publicController}),
      writable: false, configurable: false, enumerable: false});
  } catch { terminate(); return publicController; }
  try {
    transition('STARTING_POLICY');
    if (isTerminal()) return publicController;
    entry = sample();
    const url = new URL(win.location.href);
    route = parseInstallationRoute(url.pathname);
    if (win.location.href !== profile.rendererOrigin + url.pathname || url.origin !== profile.rendererOrigin) throw Error();
    if (route.mode === 'iframe' ? !direct() : parent !== win) throw Error();
    const templates = doc.querySelectorAll('#lumin-mode-bootstrap');
    if (templates.length !== 1 || templates[0]!.tagName !== 'TEMPLATE') throw Error();
    const raw = (templates[0] as HTMLTemplateElement).content.textContent ?? '';
    if (encoder.encode(raw).byteLength > 17408) throw Error();
    const bootstrap = data(JSON.parse(raw), ['schemaVersion', 'kind', 'operational', 'policy']);
    if (bootstrap.schemaVersion !== 1 || bootstrap.kind !== 'installation_document' || bootstrap.operational !== false) throw Error();
    const historical = contracts.parsePolicy(bootstrap.policy);
    if (historical.installationId !== route.installationId || historical.mode !== route.mode) throw Error();
    addWindow('message', onMessage);
    addWindow('pagehide', onPageHide);
    addDocument('visibilitychange', onVisibility);
    if (route.mode === 'iframe') handshakeTimer = schedule(() => terminate(), 5000 - (sample() - entry));
    requestRefresh(true);
  } catch { terminate(); }
  return publicController;
}

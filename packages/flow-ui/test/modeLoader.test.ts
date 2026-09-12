import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createInstallationContracts } from '../../contracts/src/installation';
import { installModeLoader, type ModeLoaderClock, type ModeLoaderIdentity } from '../src/modeLoader';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis };
};
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const identity: ModeLoaderIdentity = Object.freeze({ abiVersion: 1, rendererOrigin: 'https://renderer.test',
  apiOrigin: 'https://api.test', portalOrigin: 'https://portal.test', profileVersion: 'local-v1' });
const loaderUrl = identity.rendererOrigin + '/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js';
const profile = { ...identity, loaderUrl };
const { abiVersion: _abi, ...installationProfile } = profile;
const contracts = createInstallationContracts([installationProfile]);
const policy = { schemaVersion: 1, installationId: id, mode: 'iframe', deploymentProfileVersion: identity.profileVersion,
  rendererOrigin: identity.rendererOrigin, apiOrigin: identity.apiOrigin, loaderUrl, currentVersionId: id,
  targetRevision: 1, policyRevision: 1, allowedParentOrigins: ['https://merchant.test'], enabled: true };
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

function world(origin = 'https://merchant.test') {
  const win = new JSDOM('<!doctype html><html><body></body></html>', { url: origin }).window;
  let time = 0, next = 0, entropyCalls = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: ModeLoaderClock = {
    now: () => time,
    setTimer(run, milliseconds) { const token = ++next; timers.set(token, { at: time + milliseconds, run }); return token; },
    clearTimer(token) { timers.delete(token as number); },
  };
  const entropy = vi.fn((bytes: Uint8Array) => { bytes.fill(++entropyCalls); });
  function pair(extra: { source?: string; height?: string | null; installation?: string; content?: string } = {}) {
    const container = win.document.createElement('div');
    container.setAttribute('data-booking-lumin-installation', extra.installation ?? id);
    if (extra.height !== null) container.setAttribute('data-booking-lumin-height', extra.height ?? '640');
    container.innerHTML = extra.content ?? '';
    const script = win.document.createElement('script');
    script.setAttribute('src', extra.source ?? loaderUrl);
    script.defer = true;
    win.document.body.append(container, win.document.createTextNode('\n'), script);
    return { container, script };
  }
  function entry(script: HTMLScriptElement | null, custom: Partial<Parameters<typeof installModeLoader>[0]> = {}) {
    Object.defineProperty(win.document, 'currentScript', { value: script, configurable: true });
    return installModeLoader({ identity, window: win, clock, entropy, ...custom });
  }
  function load(container: HTMLDivElement) {
    const frame = container.querySelector('iframe')!;
    const source = frame.contentWindow!;
    const post = vi.spyOn(source, 'postMessage').mockImplementation(() => {});
    frame.dispatchEvent(new win.Event('load'));
    const init = post.mock.calls[0]?.[0] as { type: string; protocolVersion: number; installationId: string; instanceId: string };
    return { frame, source, post, init };
  }
  function advance(to: number) {
    let safety = 0;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      if (++safety > 1000) throw Error('UNBOUNDED_TIMER_LOOP');
      time = Math.max(time, due[1].at);
      timers.delete(due[0]); due[1].run();
    }
    time = to;
  }
  function message(source: Window, init: Record<string, unknown>, type = 'lumin:ready', extra: Record<string, unknown> = {}, originValue = identity.rendererOrigin) {
    win.dispatchEvent(new win.MessageEvent('message', { source, origin: originValue, data: { ...init, type, ...extra } }));
  }
  cleanups.push(() => { win.dispatchEvent(new win.PageTransitionEvent('pagehide')); win.close(); });
  return { win, clock, timers, entropy, pair, entry, load, advance, message, set: (value: number) => { time = value; } };
}

describe('classic loader entry and unchanged installation output', () => {
  it('mounts two real composeInstall snippets with one immutable minimal public API', () => {
    const w = world();
    const output = contracts.composeInstall(policy);
    if (output.kind !== 'iframe_loader') throw Error();
    w.win.document.body.innerHTML = output.html + output.html;
    const scripts = [...w.win.document.scripts];
    const api = w.entry(scripts[0]!);
    expect(w.entry(scripts[1]!)).toBe(api);
    expect(w.win.document.querySelectorAll('iframe')).toHaveLength(2);
    expect(Object.keys(api!)).toEqual(['protocolVersion', 'mount', 'unmount']);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(w.win, 'BookingLumin')).toMatchObject({ value: api, writable: false, configurable: false, enumerable: false });
    const frame = w.win.document.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin');
    expect(frame.src).toBe(identity.rendererOrigin + '/embed/flow/' + id);
    expect(frame.title).toBe('Booking form'); expect(frame.width).toBe('100%'); expect(frame.height).toBe('640');
    expect(frame.referrerPolicy).toBe('no-referrer');
    expect(w.entropy).toHaveBeenCalledTimes(2);
  });
  it('captures currentScript synchronously, uses adjacency only and tolerates whitespace/comments', () => {
    const w = world(); const a = w.pair();
    a.script.before(w.win.document.createComment('separator'));
    const api = w.entry(a.script)!;
    const unrelated = w.pair();
    expect(unrelated.container.children).toHaveLength(0);
    expect(api.mount(unrelated.container)).toBe('unregistered');
    expect(a.container.querySelectorAll('iframe')).toHaveLength(1);
  });
  it.each([
    '/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js', loaderUrl + '?x=1', loaderUrl + '#x',
    loaderUrl.replace('/assets/', '/assets/../assets/'), loaderUrl.replace('renderer', 'other'),
    loaderUrl.replace('a'.repeat(64), 'A'.repeat(64)), loaderUrl.replace('a'.repeat(64), 'a'.repeat(63)),
  ])('rejects unsupported raw script source %s', source => {
    const w = world(); const p = w.pair({ source });
    expect(w.entry(p.script)).toBeNull(); expect(p.container.children).toHaveLength(0); expect(w.entropy).not.toHaveBeenCalled();
  });
  it('rejects absent/current module/detached scripts and a wrong preceding element', () => {
    const w = world(); expect(w.entry(null)).toBeNull();
    const p = w.pair(); p.script.type = 'module'; expect(w.entry(p.script)).toBeNull();
    p.script.removeAttribute('type'); p.script.remove(); expect(w.entry(p.script)).toBeNull();
    w.win.document.body.append(p.script); p.script.before(w.win.document.createElement('span'));
    expect(w.entry(p.script)).not.toBeNull(); expect(p.container.children).toHaveLength(0);
  });
  it.each(['0319', '319', '1601', '+640', '640.0', '6.4e2', ' 640', '640 ', '000640'])('rejects noncanonical/out-of-range height %s', height => {
    const w = world(); const p = w.pair({ height }); w.entry(p.script); expect(p.container.children).toHaveLength(0);
  });
  it.each([null, '320', '1600'])('accepts supported default/boundary height %s', height => {
    const w = world(); const p = w.pair({ height }); w.entry(p.script);
    expect(p.container.querySelector('iframe')!.height).toBe(height ?? '640');
  });
  it('does not erase merchant content or accept extra runtime authority attributes', () => {
    const w = world(); const p = w.pair({ content: '<strong>Keep me</strong>' });
    w.entry(p.script); expect(p.container.innerHTML).toBe('<strong>Keep me</strong>');
    const second = w.pair(); second.container.setAttribute('data-booking-lumin-api', 'https://evil.test');
    w.entry(second.script); expect(second.container.children).toHaveLength(0);
  });
  it.each(['http://merchant.test', identity.rendererOrigin, identity.apiOrigin, identity.portalOrigin])('does not mount unsupported merchant topology %s', origin => {
    const w = world(origin); const p = w.pair(); expect(w.entry(p.script)).toBeNull(); expect(w.entropy).not.toHaveBeenCalled();
  });
  it('rejects nested merchant windows and shadow-root snippets', () => {
    const w = world(); const p = w.pair();
    Object.defineProperty(w.win, 'parent', { value: {}, configurable: true }); expect(w.entry(p.script)).toBeNull();
    Object.defineProperty(w.win, 'parent', { value: w.win, configurable: true });
    const host = w.win.document.createElement('section'); w.win.document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(p.container, p.script);
    expect(w.entry(p.script)).toBeNull();
  });
  it('rejects incompatible identity and global collisions without replacing the existing owner', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!;
    const second = w.pair(); expect(w.entry(second.script, { identity: { ...identity, profileVersion: 'other-v1' } })).toBeNull();
    expect(second.container.children).toHaveLength(0); expect(w.entry(p.script)).toBe(api);
    const other = world(); Object.defineProperty(other.win, 'BookingLumin', { value: {}, configurable: true });
    const third = other.pair(); expect(other.entry(third.script)).toBeNull(); expect(other.entropy).not.toHaveBeenCalled();
  });
  it('snapshots identity and captures clock/entropy methods instead of rereading mutable options', () => {
    const w = world(); const p = w.pair(); const mutable = { ...identity }; const clock = { ...w.clock };
    const api = w.entry(p.script, { identity: mutable, clock })!;
    mutable.rendererOrigin = 'https://other.test'; clock.now = () => { throw Error(); };
    api.unmount(p.container); expect(api.mount(p.container)).toBe('mounted');
    expect(p.container.querySelector('iframe')!.src).toContain(identity.rendererOrigin);
  });
});

describe('shared eight-slot admission and explicit lifecycle', () => {
  it('shares capacity across scripts/installation IDs, never evicts and requires explicit retry of ninth', () => {
    const w = world(); const pairs = Array.from({ length: 9 }, (_, n) => w.pair({ installation: id.replace('aaaaaaaa-', n.toString(16).padStart(8, '0') + '-') }));
    const api = w.entry(pairs[0]!.script)!;
    for (const p of pairs.slice(1)) expect(w.entry(p.script)).toBe(api);
    expect(w.win.document.querySelectorAll('iframe')).toHaveLength(8); expect(w.entropy).toHaveBeenCalledTimes(8);
    expect(api.mount(pairs[8]!.container)).toBe('capacity');
    expect(api.unmount(pairs[0]!.container)).toBe(true); expect(api.unmount(pairs[0]!.container)).toBe(false);
    w.advance(250); expect(pairs[8]!.container.children).toHaveLength(0);
    expect(api.mount(pairs[8]!.container)).toBe('mounted');
  });
  it('reserves before reentrant entropy and cannot exceed eight slots', () => {
    const w = world(); const pairs = Array.from({ length: 9 }, () => w.pair()); let count = 0;
    const entropy = (bytes: Uint8Array) => {
      bytes.fill(++count);
      if (count < pairs.length) w.entry(pairs[count]!.script, { entropy });
    };
    w.entry(pairs[0]!.script, { entropy });
    expect(count).toBe(8); expect(w.win.document.querySelectorAll('iframe')).toHaveLength(8);
  });
  it('releases entropy failure reservation and never retries through duplicate script execution', () => {
    const w = world(); const p = w.pair(); let fail = true;
    const entropy = vi.fn((bytes: Uint8Array) => { if (fail) throw Error(); bytes.fill(1); });
    const api = w.entry(p.script, { entropy })!; expect(p.container.children).toHaveLength(0);
    fail = false; w.entry(p.script); expect(entropy).toHaveBeenCalledTimes(1);
    expect(api.mount(p.container)).toBe('mounted'); expect(entropy).toHaveBeenCalledTimes(2);
  });
  it('duplicates active scripts without duplicate ownership or automatic remount after removal', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!; const frame = p.container.firstChild;
    expect(w.entry(p.script)).toBe(api); expect(p.container.firstChild).toBe(frame); expect(api.mount(p.container)).toBe('already_mounted');
    p.container.remove(); w.advance(250); expect(p.container.children).toHaveLength(0); expect(w.timers.size).toBe(0);
    p.script.before(p.container); w.entry(p.script); expect(p.container.children).toHaveLength(0);
    expect(api.mount(p.container)).toBe('mounted');
  });
  it('disposes changed attributes and moved/replaced frames without deleting merchant replacement content', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!;
    p.container.setAttribute('data-booking-lumin-height', '700'); w.advance(250);
    expect(api.mount(p.container)).toBe('invalid_container');
    const other = w.pair(); w.entry(other.script); const owned = other.container.querySelector('iframe')!;
    other.container.append(w.win.document.createElement('strong')); w.advance(500);
    expect(other.container.querySelector('strong')).not.toBeNull(); expect(owned.isConnected).toBe(false);
    const third = w.pair(); w.entry(third.script); const moved = third.container.querySelector('iframe')!;
    w.win.document.body.append(moved); w.advance(750); expect(moved.isConnected).toBe(false);
  });
  it('invalid mount inputs do not reveal a registry or create frames', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!;
    for (const value of [null, {}, 'selector', p.script, new Proxy({}, { get() { throw Error(); } })]) {
      expect(api.mount(value)).toBe('invalid_container'); expect(api.unmount(value)).toBe(false);
    }
    expect(api.mount(w.pair().container)).toBe('unregistered');
  });
  it('pagehide disposes all work; persisted pageshow only permits explicit new generations', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!; const first = w.load(p.container);
    w.win.dispatchEvent(new w.win.PageTransitionEvent('pagehide', { persisted: true }));
    expect(p.container.children).toHaveLength(0); expect(w.timers.size).toBe(0); expect(api.mount(p.container)).toBe('suspended');
    w.win.dispatchEvent(new w.win.PageTransitionEvent('pageshow', { persisted: true }));
    expect(p.container.children).toHaveLength(0); expect(api.mount(p.container)).toBe('mounted');
    const second = w.load(p.container); expect(second.init.instanceId).not.toBe(first.init.instanceId);
    w.message(first.source, first.init); w.advance(5000); expect(p.container.children).toHaveLength(0);
  });
  it('installs a fixed pair of lifecycle listeners and one shared message listener', () => {
    const w = world(); const add = vi.spyOn(w.win, 'addEventListener'); const remove = vi.spyOn(w.win, 'removeEventListener');
    const pairs = [w.pair(), w.pair()]; const api = w.entry(pairs[0]!.script)!; w.entry(pairs[1]!.script); w.entry(pairs[0]!.script);
    expect(add.mock.calls.filter(([name]) => name === 'pagehide')).toHaveLength(1);
    expect(add.mock.calls.filter(([name]) => name === 'pageshow')).toHaveLength(1);
    expect(add.mock.calls.filter(([name]) => name === 'message')).toHaveLength(1);
    pairs.forEach(p => api.unmount(p.container));
    expect(remove.mock.calls.filter(([name]) => name === 'message').length).toBeGreaterThan(0); expect(w.timers.size).toBe(0);
  });
});

describe('correlated handshake, resize and terminal clock behavior', () => {
  it('sends exactly ten init messages at 0..4500 and accepts nothing at the5s deadline', () => {
    const w = world(); const p = w.pair(); w.entry(p.script); const f = w.load(p.container);
    expect(f.post).toHaveBeenCalledTimes(1); expect(f.post.mock.calls[0]![1]).toBe(identity.rendererOrigin);
    expect(f.init.instanceId).toMatch(/^[0-9a-f]{32}$/);
    w.advance(4499); expect(f.post).toHaveBeenCalledTimes(9);
    w.advance(4500); expect(f.post).toHaveBeenCalledTimes(10);
    w.set(5000); w.message(f.source, f.init); expect(p.container.children).toHaveLength(0);
    w.advance(5500); expect(f.post).toHaveBeenCalledTimes(10);
  });
  it('accepts ready at4999, ignores duplicates and closes on a second iframe load', () => {
    const w = world(); const p = w.pair(); w.entry(p.script); const f = w.load(p.container);
    w.set(4999); w.message(f.source, f.init); w.message(f.source, f.init);
    w.advance(6000); expect(f.frame.isConnected).toBe(true);
    f.frame.dispatchEvent(new w.win.Event('load')); expect(f.frame.isConnected).toBe(false);
  });
  it('rejects wrong origin, sibling source, old instance, malformed/proxy and resize-before-ready', () => {
    const w = world(); const a = w.pair(), b = w.pair(); w.entry(a.script); w.entry(b.script);
    const one = w.load(a.container), two = w.load(b.container);
    w.message(one.source, one.init, 'lumin:ready', {}, 'https://other.test');
    w.message(two.source, one.init); w.message(one.source, one.init, 'lumin:ready', { instanceId: '0'.repeat(32) });
    w.message(one.source, one.init, 'lumin:resize', { height: 900 });
    w.message(one.source, one.init, 'lumin:ready', { unexpected: 'x'.repeat(2000) });
    const getter = vi.fn(() => 'lumin:ready');
    const hostile = Object.defineProperty({}, 'type', { get: getter });
    w.win.dispatchEvent(new w.win.MessageEvent('message', { source: one.source, origin: identity.rendererOrigin, data: hostile }));
    expect(getter).not.toHaveBeenCalled(); expect(one.frame.height).toBe('640');
    w.advance(5000); expect(a.container.children).toHaveLength(0); expect(b.container.children).toHaveLength(0);
  });
  it('applies four resizes/window and coalesces only the latest height at trailing boundary', () => {
    const w = world(); const p = w.pair(); w.entry(p.script); const f = w.load(p.container); w.message(f.source, f.init);
    for (const height of [700, 800, 900, 1000, 1100, 1200]) w.message(f.source, f.init, 'lumin:resize', { height });
    expect(f.frame.height).toBe('1000'); w.advance(999); expect(f.frame.height).toBe('1000');
    w.advance(1000); expect(f.frame.height).toBe('1200');
    for (const height of [1300, 1400, 1500, 1600]) w.message(f.source, f.init, 'lumin:resize', { height });
    expect(f.frame.height).toBe('1500'); w.advance(2000); expect(f.frame.height).toBe('1600');
  });
  it('late saved callbacks cannot act on a remounted container', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!; const f = w.load(p.container);
    const callbacks = [...w.timers.values()].map(timer => timer.run);
    api.unmount(p.container); api.mount(p.container); const current = w.load(p.container);
    callbacks.forEach(run => run()); w.message(f.source, f.init, 'lumin:resize', { height: 900 });
    expect(current.frame.height).toBe('640'); expect(current.frame.isConnected).toBe(true);
  });
  it.each(['throw', 'nan', 'backward'] as const)('terminally closes all contexts on clock %s, including across calls', mode => {
    const w = world(); const p = w.pair(); let broken = false;
    const clock = { ...w.clock, now: () => { if (broken && mode === 'throw') throw Error(); return broken ? (mode === 'nan' ? NaN : -1) : 0; } };
    const api = w.entry(p.script, { clock })!; const second = w.pair(); w.entry(second.script);
    broken = true; expect(api.mount(p.container)).toBe('unavailable');
    w.advance(250); expect(w.win.document.querySelectorAll('iframe')).toHaveLength(0);
    broken = false; expect(api.mount(p.container)).toBe('unavailable');
    w.win.dispatchEvent(new w.win.PageTransitionEvent('pageshow', { persisted: true })); expect(api.mount(second.container)).toBe('unavailable');
  });
  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid first monotonic sample %s, with zero as a valid neighbor', initial => {
    const w = world(); const p = w.pair();
    const api = w.entry(p.script, { clock: { ...w.clock, now: () => initial } })!;
    expect(p.container.children).toHaveLength(0); expect(w.entropy).not.toHaveBeenCalled();
    expect(api.mount(p.container)).toBe('unavailable');
    const other = world(); const neighbor = other.pair(); other.entry(neighbor.script);
    expect(neighbor.container.querySelector('iframe')).not.toBeNull();
  });
  it('does not invoke a captured old load callback after disposing its frame', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script)!;
    const f = w.load(p.container); api.unmount(p.container); api.mount(p.container);
    f.frame.dispatchEvent(new w.win.Event('load'));
    const current = w.load(p.container); w.message(current.source, current.init); w.advance(5000);
    expect(current.frame.isConnected).toBe(true); expect(f.post).toHaveBeenCalledTimes(1);
  });
  it('captures default native clock functions against later property replacement', () => {
    const w = world(); const p = w.pair();
    const nativeNow = w.win.performance.now;
    const nativeSet = w.win.setTimeout, nativeClear = w.win.clearTimeout;
    Object.defineProperty(w.win.performance, 'now', { value: () => 0, configurable: true });
    const api = w.entry(p.script, { clock: undefined })!;
    const forbidden = vi.fn(() => { throw Error('REPLACED_NATIVE'); });
    Object.defineProperty(w.win.performance, 'now', { value: forbidden, configurable: true });
    Object.defineProperty(w.win, 'setTimeout', { value: forbidden, configurable: true });
    Object.defineProperty(w.win, 'clearTimeout', { value: forbidden, configurable: true });
    const frame = w.load(p.container); w.message(frame.source, frame.init);
    expect(frame.frame.isConnected).toBe(true); expect(api.unmount(p.container)).toBe(true);
    expect(forbidden).not.toHaveBeenCalled();
    Object.defineProperty(w.win.performance, 'now', { value: nativeNow, configurable: true });
    w.win.setTimeout = nativeSet; w.win.clearTimeout = nativeClear;
  });
  it('setTimer throws fail closed and clearTimer throws cannot accumulate retained callbacks', () => {
    const w = world(); const p = w.pair(); const api = w.entry(p.script, { clock: { ...w.clock, setTimer() { throw Error(); } } })!;
    expect(p.container.children).toHaveLength(0); expect(api.mount(p.container)).toBe('unavailable');
    const other = world(); const a = other.pair(); let clears = 0;
    const second = other.entry(a.script, { clock: { ...other.clock, clearTimer() { clears++; throw Error(); } } })!;
    second.unmount(a.container); expect(clears).toBe(1);
    for (let i = 0; i < 20; i++) expect(second.mount(a.container)).toBe('unavailable');
    expect(other.timers.size).toBe(1); other.advance(250); expect(other.timers.size).toBe(0);
  });
  it('checks the handshake deadline again after timer cleanup before accepting ready', () => {
    const w = world(); const p = w.pair(); let deadline = false;
    const clock = { ...w.clock, clearTimer(handle: unknown) { w.clock.clearTimer(handle); if (deadline) w.set(5000); } };
    w.entry(p.script, { clock }); const f = w.load(p.container); w.set(4999); deadline = true;
    w.message(f.source, f.init); expect(p.container.children).toHaveLength(0);
  });
});

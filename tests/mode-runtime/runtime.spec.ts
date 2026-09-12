import { test, expect } from './browser-fixtures';
import { advanceTarget, updatePolicy, wire, seed, snapshot, profile, holdPolicyTable, blockedPolicyPids } from './fixtures';
import { createHash } from 'node:crypto';
import type { Frame, Page } from '@playwright/test';
const marker = 'Booking experience is not available yet.';
let phase='START'; async function guarded(work: () => Promise<void>) { phase='START'; try { await work(); } catch { throw Error('SAFE_RUNTIME_ASSERTION_FAILED_'+phase); } }
async function state(frame: Frame) { return frame.evaluate(() => ({ state: document.documentElement.dataset.bookingLuminState, operational: document.documentElement.dataset.bookingLuminOperational })); }
async function ready(frame: Frame) { await expect.poll(() => state(frame)).toEqual({ state: 'ready', operational: 'false' }); await expect(frame.getByText(marker, { exact: true })).toBeVisible(); }
async function unavailable(frame: Frame) { await expect.poll(() => state(frame), { timeout: 35000 }).toEqual({ state: 'unavailable', operational: 'false' }); }
async function child(page: Page) { await expect(page.locator('iframe')).toHaveCount(1); const frame = await page.locator('iframe').elementHandle(); const actual = await frame!.contentFrame(); expect(actual).not.toBeNull(); return actual!; }
const observedPages=new WeakSet<Page>();
async function observe(page: Page) {
  if(observedPages.has(page))return;observedPages.add(page);
  await page.addInitScript(() => {
    const records: { type: string; installationId: string; instanceId: string; height?: number }[] = [];
    const inspection={invalid:false,overflow:false};
    const resizeTimes: number[] = []; Object.defineProperty(window, '__resizeTimes', { value: resizeTimes });
    Object.defineProperty(window,'__runtimeMessageInspection',{value:inspection});
    Object.defineProperty(window, '__runtimeMessages', { value: records });
    addEventListener('message', e => {
      const v=e.data;if(v===null||typeof v!=='object')return;const discriminator=Object.getOwnPropertyDescriptor(v,'type');if(!discriminator||!('value'in discriminator)||!['lumin:ready','lumin:resize'].includes(discriminator.value))return;
      const keys=discriminator.value==='lumin:resize'?['type','protocolVersion','installationId','instanceId','height']:['type','protocolVersion','installationId','instanceId'];
      if(Reflect.ownKeys(v).length!==keys.length||keys.some(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !d||!('value'in d)||!d.enumerable;})){inspection.invalid=true;return;}
      if(v.protocolVersion!==1||typeof v.installationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v.installationId)||typeof v.instanceId!=='string'||!/^[0-9a-f]{32}$/.test(v.instanceId)||(v.type==='lumin:resize'&&(!Number.isInteger(v.height)||v.height<320||v.height>1600))){inspection.invalid=true;return;}
      if(records.length>=128){inspection.overflow=true;return;}if(v.type==='lumin:resize')resizeTimes.push(performance.now());records.push({type:v.type,installationId:v.installationId,instanceId:v.instanceId,...(v.height===undefined?{}:{height:v.height})});
    });
  });
}
async function inspected(page: Page) { return page.evaluate(()=>(window as unknown as {__runtimeMessageInspection:{invalid:boolean;overflow:boolean}}).__runtimeMessageInspection); }
async function messages(page: Page) { return page.evaluate(() => (window as unknown as { __runtimeMessages: Array<{type:string;installationId:string;instanceId:string;height?:number}> }).__runtimeMessages); }
// All sends below originate in real browsing contexts; no MessageEvent.source is forged.
async function resizeFrom(frame: Frame, record: { installationId: string; instanceId: string }, target: string, changes: Record<string, unknown>) {
  await frame.evaluate(({ record, target, changes }) => {
    window.parent.postMessage({ type: 'lumin:resize', protocolVersion: 1, ...record, ...changes }, target);
  }, { record: { installationId: record.installationId, instanceId: record.instanceId }, target, changes });
}
async function quietHeight(page: Page, expected: string | null) {
  await page.waitForTimeout(1100); // Includes one complete fixed resize window and any trailing application.
  expect(await page.locator('iframe').first().getAttribute('height')).toBe(expected);
}
function customerState(value: Record<string, unknown>) {
  const result = { ...value };
  for (const key of ['flows','flow_drafts','flow_versions','bound_flow_versions','mode_flow_installations','mode_flow_owner_operations','mode_flow_installation_history']) delete result[key];
  return result;
}
async function strictProtocol(page: Page) {
  let init = 0, ready = 0;
  for (const frame of page.frames()) {
    const audit = await frame.evaluate(()=>(window as unknown as {__strictProtocol:{invalid:boolean;init:number;ready:number}}).__strictProtocol);
    expect(audit.invalid).toBe(false); init += audit.init; ready += audit.ready;
  }
  expect(init).toBeGreaterThan(0); expect(ready).toBeGreaterThan(0);
}
async function appendSnippet(page: Page, snippet: string) {
  await page.evaluate(async snippet => {
    const template = document.createElement('template'); template.innerHTML = snippet;
    const container = template.content.querySelector('div')!;
    const original = template.content.querySelector('script')!;
    const script = document.createElement('script');
    for (const attr of original.attributes) script.setAttribute(attr.name, attr.value);
    await new Promise<void>((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error('SCRIPT_LOAD_TIMEOUT')),5000);
      script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);reject(Error('SCRIPT_LOAD_FAILED'));};
      document.body.append(container, script);
    });
  }, snippet);
}
async function eightReady(page: Page, origin: string, route: string, snippet: string) {
  await page.goto(origin + route); await ready(await child(page));
  // Real unchanged snippets are admitted sequentially; the API's two-read per-installation cap stays intact.
  for (let count = 2; count <= 8; count++) {
    await appendSnippet(page, snippet); await expect(page.locator('iframe')).toHaveCount(count);
    const handle = await page.locator('iframe').last().elementHandle(); await ready((await handle!.contentFrame())!);
  }
}
async function publicStorage(page: Page) {
  for (const f of page.frames()) expect(await f.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie }))).toEqual({ local: [], session: [], cookie: '' });
}
const parent = (origin: string, frame: string) => origin + '/frame?frame=' + encodeURIComponent(frame);

test('runtime-01 hosted V1 and V2 execute registered child without parent channel', async ({ journey: j }) => guarded(async () => {
  phase='HOSTED';
  for (const w of [j.w, await seed(j.db, true)]) {
    const saved = await snapshot(j.db, w.f);
    await observe(j.page); await j.page.goto(j.local.addresses.renderer + '/checkout/flow/' + w.hosted.installationId); await ready(j.page.mainFrame());
    expect(await messages(j.page)).toEqual([]); expect(await j.page.locator('script').count()).toBe(1); expect(await j.page.locator('form,iframe').count()).toBe(0);
    const response = await wire(j.local.addresses.renderer, '/checkout/flow/' + w.hosted.installationId, j.tls);
    expect(response.status).toBe(200); expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    const bootstrap = await j.page.locator('#lumin-mode-bootstrap').evaluate(e => JSON.parse((e as HTMLTemplateElement).content.textContent!));
    expect(bootstrap.policy.installationId).toBe(w.hosted.installationId);
    expect(bootstrap.policy.deploymentProfileVersion).toBe(profile().profileVersion);
    let framingDenied = false;
    const onConsole = (m: import('@playwright/test').ConsoleMessage) => { if(m.text().includes('frame-ancestors')) framingDenied=true; };
    j.page.on('console',onConsole);
    await j.page.goto(parent(j.local.addresses.merchant,j.local.addresses.renderer+'/checkout/flow/'+w.hosted.installationId));
    await expect.poll(()=>framingDenied).toBe(true); j.page.off('console',onConsole);
    await j.page.goto(j.local.addresses.renderer+'/checkout/flow/'+w.hosted.installationId); await ready(j.page.mainFrame());
    expect(await snapshot(j.db, w.f)).toEqual(saved);
  }
  await j.capture('runtime-01-1440.png',1440); await j.unchanged();
}));
test('runtime-02 literal unchanged snippets initialize real V1 and V2 channels', async ({ journey: j }) => guarded(async () => {
  phase='SNIPPET';
  for (const w of [j.w, await seed(j.db,true)]) {
    const saved = await snapshot(j.db, w.f);
    await observe(j.page); const route = j.local.registerPage(await j.local.snippet(w)); await j.page.goto(j.local.addresses.merchant + route); const f = await child(j.page); await ready(f);
    expect(await j.page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin');
    expect(await j.page.locator('iframe').getAttribute('width')).toBe('100%');
    expect(await j.page.locator('iframe').getAttribute('src')).toBe(j.local.addresses.renderer + '/embed/flow/' + w.iframe.installationId);
    expect(await snapshot(j.db, w.f)).toEqual(saved);
    const list = (await messages(j.page)).filter(x => x.type === 'lumin:ready'); expect(list).toHaveLength(1); expect(list[0]!.installationId).toBe(w.iframe.installationId); expect(list[0]!.instanceId).toMatch(/^[0-9a-f]{32}$/);
  }
  await j.capture('runtime-02-768.png',768); await j.unchanged();
}));
test('runtime-03 duplicate and late scripts preserve independent channels', async ({ journey: j }) => guarded(async () => {
  phase='CHANNEL_SETUP';
  await observe(j.page);
  // Bind correlation to the real source at delivery; READY arrival order is not DOM order.
  await j.page.addInitScript(rendererOrigin => {
    const audit = { overflow: false, records: [] as Array<{ frameIndex: number; installationId: string; instanceId: string }> };
    Object.defineProperty(window, '__channelSources', { value: audit });
    addEventListener('message', event => {
      if (event.origin !== rendererOrigin || event.data?.type !== 'lumin:ready') return;
      const frames = document.querySelectorAll('iframe');
      if (frames.length > 8) { audit.overflow = true; return; }
      const frameIndex = [...frames].findIndex(frame => frame.contentWindow === event.source);
      if (frameIndex < 0) return;
      if (audit.records.length >= 8) { audit.overflow = true; return; }
      const value = event.data;
      if (Reflect.ownKeys(value).length !== 4 || value.protocolVersion !== 1 || typeof value.installationId !== 'string' || typeof value.instanceId !== 'string' || !/^[0-9a-f]{32}$/.test(value.instanceId)) { audit.overflow = true; return; }
      audit.records.push({ frameIndex, installationId: value.installationId, instanceId: value.instanceId });
    });
  }, j.local.addresses.renderer);
  const snippet = await j.local.snippet(j.w);
  await j.page.goto(j.local.addresses.merchant + j.local.registerPage(snippet + snippet));
  phase='CHANNEL_FRAME_COUNT';
  await expect(j.page.locator('iframe')).toHaveCount(2);
  phase='CHANNEL_CHILD_READY';
  const frames: Frame[] = [];
  for (let index = 0; index < 2; index++) {
    const handle = await j.page.locator('iframe').nth(index).elementHandle();
    const frame = await handle!.contentFrame(); expect(frame).not.toBeNull(); frames.push(frame!); await ready(frame!);
  }
  phase='CHANNEL_READY_MESSAGES';
  await expect.poll(async () => (await messages(j.page)).filter(x => x.type === 'lumin:ready').length).toBe(2);
  const records = (await messages(j.page)).filter(x => x.type === 'lumin:ready');
  expect(new Set(records.map(x => x.instanceId)).size).toBe(2);
  phase='CHANNEL_SOURCE_MAPPING';
  const sources = await j.page.evaluate(() => (window as unknown as { __channelSources: { overflow: boolean; records: Array<{frameIndex:number;installationId:string;instanceId:string}> } }).__channelSources);
  expect(sources.overflow).toBe(false); expect(sources.records).toHaveLength(2);
  expect(sources.records.map(x => x.frameIndex).sort()).toEqual([0, 1]);
  expect(sources.records.map(x => x.instanceId).sort()).toEqual(records.map(x => x.instanceId).sort());
  const own = sources.records.find(x => x.frameIndex === 0)!;
  const other = sources.records.find(x => x.frameIndex === 1)!;
  expect(other.instanceId).not.toBe(own.instanceId);
  expect(other.installationId).toBe(j.w.iframe.installationId);
  await j.page.waitForTimeout(1100);
  const heights = await j.page.locator('iframe').evaluateAll(es => es.map(e => e.getAttribute('height')));
  phase='CHANNEL_CROSS_INSTANCE';
  await resizeFrom(frames[0]!, other, j.local.addresses.merchant, { height: 777 });
  await j.page.waitForTimeout(1100);
  expect(await j.page.locator('iframe').evaluateAll(es => es.map(e => e.getAttribute('height')))).toEqual(heights);
  phase='CHANNEL_DUPLICATE_SCRIPT';
  await j.page.evaluate(async () => {
    const old = document.querySelector('script')!;
    const fresh = document.createElement('script'); fresh.src = old.src;
    await new Promise<void>((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error('SCRIPT_LOAD_TIMEOUT')),5000);
      fresh.onload=()=>{clearTimeout(timer);resolve();};fresh.onerror=()=>{clearTimeout(timer);reject(Error('SCRIPT_LOAD_FAILED'));};
      old.replaceWith(fresh);
    });
  });
  await expect(j.page.locator('iframe')).toHaveCount(2);
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(2);
  phase='CHANNEL_LATE_INSERTION';
  await appendSnippet(j.page, snippet);
  await expect(j.page.locator('iframe')).toHaveCount(3);
  for (const f of j.page.frames().slice(1)) await ready(f);
  phase='CHANNEL_LATE_READY_MESSAGES';
  await expect.poll(async () => (await messages(j.page)).filter(x => x.type === 'lumin:ready').length).toBe(3);
  const final = (await messages(j.page)).filter(x => x.type === 'lumin:ready');
  expect(new Set(final.map(x => x.instanceId)).size).toBe(3);
  expect(await j.page.evaluate(() => (window as unknown as {__channelSources:{overflow:boolean}}).__channelSources.overflow)).toBe(false);
  phase='CHANNEL_DATABASE'; await j.unchanged();
}));
test('runtime-04 exact origin neighbors and null sandbox are denied by actual framing', async ({ journey: j }) => guarded(async () => {
  phase='ORIGIN_HTTPS';
  const route = j.local.registerPage(await j.local.snippet(j.w)); await observe(j.page);
  for (const origin of [j.local.addresses.forbidden, j.local.deniedMerchantOrigins.wrongPort, j.local.deniedMerchantOrigins.lookalike]) {
    let violation = false;
    const listener = (m: import('@playwright/test').ConsoleMessage) => { if (m.text().includes('frame-ancestors')) violation = true; };
    j.page.on('console', listener);
    await j.page.goto(origin + route);
    await expect.poll(() => violation).toBe(true);
    expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(0);
    j.page.off('console', listener);
  }
  phase='ORIGIN_HTTP';
  const assetsBefore = j.local.wirePrivacy.asset.requests;
  const docsBefore = j.local.wirePrivacy.document.requests;
  await j.page.goto(j.local.deniedMerchantOrigins.wrongScheme + route);
  expect(j.local.wirePrivacy.asset.requests).toBeGreaterThan(assetsBefore);
  expect(j.local.wirePrivacy.document.requests).toBe(docsBefore);
  expect(await j.page.locator('iframe').count()).toBe(0);
  expect(await j.page.evaluate(() => Object.hasOwn(window, 'BookingLumin'))).toBe(false);
  phase='NULL_ANCESTOR';
  let nullDenied = false;
  j.page.on('console', m => { if (m.text().includes('frame-ancestors')) nullDenied = true; });
  await j.page.goto(j.local.addresses.merchant + '/frame?sandbox=null&frame=' + encodeURIComponent(parent(j.local.addresses.merchant, j.local.addresses.renderer + '/embed/flow/' + j.w.iframe.installationId)));
  await expect.poll(() => nullDenied).toBe(true);
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(0);
  await j.page.goto(j.local.addresses.merchant + route); await ready(await child(j.page)); await j.unchanged();
}));
test('runtime-05 direct-parent and all-ancestor gates have live neighbors', async ({ journey: j }) => guarded(async () => {
  phase='ANCESTORS';
  await observe(j.page);
  const url = j.local.addresses.renderer + '/embed/flow/' + j.w.iframe.installationId;
  await j.page.goto(url); await unavailable(j.page.mainFrame());
  await j.page.goto(parent(j.local.addresses.second, parent(j.local.addresses.merchant, url)));
  const nested = j.page.frames().find(x => x.url() === url)!;
  expect(nested).toBeTruthy(); await unavailable(nested);
  await j.capture('runtime-05-1440.png', 1440);
  let denied = false;
  j.page.on('console', m => { if (m.text().includes('frame-ancestors')) denied = true; });
  await j.page.goto(parent(j.local.addresses.forbidden, parent(j.local.addresses.merchant, url)));
  await expect.poll(() => denied).toBe(true);
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(0);
  await j.page.goto(parent(j.local.addresses.merchant, url)); await unavailable(await child(j.page));
  await j.page.goto(j.local.addresses.merchant + j.local.registerPage(await j.local.snippet(j.w)));
  await ready(await child(j.page));
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(1);
  await j.unchanged();
}));
test('runtime-06 delayed real init traffic converges once and expired delivery cannot revive', async ({ journey: j }) => guarded(async () => {
  phase='INIT_DELAY';
  await observe(j.page);
  await j.page.addInitScript(() => {
    const init: Array<{ at: number; instanceId: string }> = [];
    Object.defineProperty(window, '__observedInit', { value: init });
    addEventListener('message', e => {
      if (e.data?.type === 'lumin:init' && init.length < 11) init.push({ at: performance.now(), instanceId: e.data.instanceId });
    });
  });
  const snippet = await j.local.snippet(j.w);
  let release!: () => void; let entered = 0;
  let gate = new Promise<void>(r => { release = r; });
  await j.page.route('**/api/public/installation-policies/*', async route => { entered++; await gate; await route.continue().catch(() => {}); });
  try {
    await j.page.goto(j.local.addresses.merchant + j.local.registerPage(snippet));
    await expect.poll(() => entered).toBe(1);
    const f = await child(j.page);
    expect(await j.page.locator('iframe').getAttribute('height')).toBe('640');
    await expect.poll(() => f.evaluate(() => (window as unknown as { __observedInit: unknown[] }).__observedInit.length)).toBeGreaterThanOrEqual(2);
    release(); await j.page.unrouteAll({ behavior: 'wait' }); await ready(f);
    const traffic = await f.evaluate(() => (window as unknown as { __observedInit: Array<{at:number;instanceId:string}> }).__observedInit);
    expect(traffic.length).toBeGreaterThanOrEqual(2); expect(traffic.length).toBeLessThanOrEqual(10);
    expect(new Set(traffic.map(x => x.instanceId)).size).toBe(1);
    const record = (await messages(j.page)).find(x => x.type === 'lumin:ready')!;
    await j.page.evaluate(({ record, target }) => { const child = document.querySelector('iframe')!.contentWindow!; for (let i=0;i<3;i++) child.postMessage({type:'lumin:init',protocolVersion:1,installationId:record.installationId,instanceId:record.instanceId}, target); }, { record, target: j.local.addresses.renderer });
    await j.page.waitForTimeout(600);
    expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(1);
  } finally { release(); await j.page.unrouteAll({ behavior: 'wait' }); }
  entered = 0; gate = new Promise<void>(r => { release = r; });
  await j.page.route('**/api/public/installation-policies/*', async route => { entered++; await gate; await route.continue().catch(() => {}); });
  try {
    await j.page.goto(j.local.addresses.merchant + j.local.registerPage(snippet));
    await expect.poll(() => entered).toBe(1);
    const old = await child(j.page); await unavailable(old);
    await expect(j.page.locator('iframe')).toHaveCount(0, { timeout: 8000 });
    expect(entered).toBe(1);
  } finally { release(); await j.page.unrouteAll({ behavior: 'wait' }); }
  await j.page.waitForTimeout(600);
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(0); await j.unchanged();
}));
test('runtime-07 actual child, sibling and stale-source attacks leave the live channel intact', async ({ journey: j }) => guarded(async () => {
  phase='SOURCE_ATTACKS';
  await observe(j.page);
  await j.page.addInitScript(() => {
    addEventListener('message', event => {
      const w = window as unknown as { __disposeOnResize?: boolean; BookingLumin?: { unmount(e: Element): boolean; mount(e: Element): string } };
      if (!w.__disposeOnResize || event.data?.type !== 'lumin:resize') return;
      w.__disposeOnResize = false;
      const container = document.querySelector('div[data-booking-lumin-installation]')!;
      w.BookingLumin!.unmount(container); w.BookingLumin!.mount(container);
    });
  });
  await j.page.goto(j.local.addresses.merchant + j.local.registerPage(await j.local.snippet(j.w)));
  const f = await child(j.page); await ready(f);
  await j.page.waitForTimeout(1100);
  const record = (await messages(j.page)).find(x => x.type === 'lumin:ready')!;
  const before = await j.page.locator('iframe').getAttribute('height');
  // Correct source/origin reach the parser. The oversized known field is deliberately invalid too;
  // valid-schema byte-cap reachability remains the controlled parser proof, not inferred here.
  expect(new TextEncoder().encode('\u{1F642}'.repeat(1025)).byteLength).toBeGreaterThan(1024);
  for (const change of [
    { height: 319 }, { height: 1601 }, { height: 400.5 }, { height: 400, protocolVersion: 2 },
    { height: 400, unknown: true }, { height: 400, instanceId: '0'.repeat(32) },
    { height: 400, installationId: '00000000-0000-4000-8000-000000000000' },
    { height: 400, installationId: 'INVALID' }, { height: 400, instanceId: '\u{1F642}'.repeat(1025) },
  ]) await resizeFrom(f, record, j.local.addresses.merchant, change);
  // Parent's own window has the wrong source/origin, independently of malformed schema.
  await j.page.evaluate(record => window.postMessage({ ...record, type: 'lumin:resize', protocolVersion: 1, height: 777 }, location.origin), record);
  await quietHeight(j.page, before);
  // A real other-origin sibling still has the wrong WindowProxy for the first channel.
  const extra = j.local.registerPage('<h1>Sibling fixture</h1>');
  await j.page.evaluate(url => { const el = document.createElement('iframe'); el.id = 'sibling'; el.src = url; document.body.append(el); }, j.local.addresses.second + extra);
  await expect.poll(() => j.page.frames().some(x => x.url() === j.local.addresses.second + extra)).toBe(true);
  const sibling = j.page.frames().find(x => x.url() === j.local.addresses.second + extra)!;
  await resizeFrom(sibling, record, j.local.addresses.merchant, { height: 777 });
  await quietHeight(j.page, before);
  await j.page.locator('#sibling').evaluate(e => e.remove());
  await resizeFrom(f, record, j.local.addresses.merchant, { height: 731 });
  await expect(j.page.locator('iframe')).toHaveAttribute('height', '731');
  // Real queued child traffic becomes stale during earlier listener disposal; no source is forged.
  await j.page.evaluate(() => { (window as unknown as { __disposeOnResize: boolean }).__disposeOnResize = true; });
  await resizeFrom(f, record, j.local.addresses.merchant, { height: 777 });
  await expect.poll(() => j.page.evaluate(() => (window as unknown as { __disposeOnResize: boolean }).__disposeOnResize)).toBe(false);
  const current = await child(j.page); await ready(current);
  const latest = (await messages(j.page)).filter(x => x.type === 'lumin:ready').at(-1)!;
  expect(latest.instanceId).not.toBe(record.instanceId);
  // Old correlation is rejected even when sent by the new live child.
  await j.page.waitForTimeout(1100);
  const currentHeight = await j.page.locator('iframe').getAttribute('height');
  await resizeFrom(current, record, j.local.addresses.merchant, { height: 777 });
  await quietHeight(j.page, currentHeight);
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(2);
  await j.unchanged();
}));
test('runtime-08 real measurements and hostile bursts enforce both resize limits', async ({ journey: j }) => guarded(async () => {
  phase='MEASUREMENTS';
  await observe(j.page);
  await j.page.goto(j.local.addresses.merchant + j.local.registerPage(await j.local.snippet(j.w)));
  const f = await child(j.page); await ready(f);
  await j.page.waitForTimeout(1100);
  await j.page.evaluate(() => {
    const changes: Array<{ at: number; height: string | null }> = [];
    const budget = { overflow: false };
    Object.defineProperty(window, '__heightBudget', { value: budget });
    Object.defineProperty(window, '__heightChanges', { value: changes });
    new MutationObserver(records => { for (const r of records) if (r.attributeName === 'height') { if(changes.length>=128) { budget.overflow=true; continue; } changes.push({ at: performance.now(), height: (r.target as Element).getAttribute('height') }); } })
      .observe(document.querySelector('iframe')!, { attributes: true, attributeFilter: ['height'] });
  });
  const before = (await messages(j.page)).filter(x => x.type === 'lumin:resize').length;
  const measurementStart = await j.page.evaluate(() => performance.now());
  await f.evaluate(async () => {
    const block = document.createElement('div'); block.id = 'measurement-fixture'; document.body.append(block);
    for (let i = 0; i < 20; i++) { block.style.height = `${700 + i * 100}px`; await new Promise<void>(r => requestAnimationFrame(() => r())); }
  });
  await expect(j.page.locator('iframe')).toHaveAttribute('height', '1600');
  const measured = (await messages(j.page)).filter(x => x.type === 'lumin:resize').slice(before);
  const measurementEnd = await j.page.evaluate(() => performance.now());
  expect(measured.length).toBeGreaterThan(0);
  expect(measured.length).toBeLessThanOrEqual(4 * (Math.floor((measurementEnd-measurementStart)/1000) + 2));
  const measuredTimes = await j.page.evaluate(before => (window as unknown as {__resizeTimes:number[]}).__resizeTimes.slice(before), before);
  // Unknown fixed-window phase permits at most eight in any observed one-second interval.
  // Exact phase-aligned four-per-window boundaries remain the independent controlled U04 proof.
  for (const at of measuredTimes) expect(measuredTimes.filter(t=>t>=at&&t<at+1000).length).toBeLessThanOrEqual(8);
  expect(measured.every(x => Number.isInteger(x.height) && x.height! >= 320 && x.height! <= 1600)).toBe(true);
  const record = (await messages(j.page)).find(x => x.type === 'lumin:ready')!;
  await j.page.waitForTimeout(1100);
  // Fix actual observed DOM dimensions before hostile traffic, so viewport changes do not
  // create competing legitimate measurement callbacks. No production action callback is added.
  await f.evaluate(() => {
    document.getElementById('measurement-fixture')!.remove();
    document.documentElement.style.height='1800px'; document.documentElement.style.overflow='hidden';
    document.body.style.height='1800px'; document.body.style.margin='0';
  });
  await expect(j.page.locator('iframe')).toHaveAttribute('height','1600');
  await j.page.waitForTimeout(1100);
  // A live child sends a burst independent of its own controller's ResizeObserver limiter.
  const start = await j.page.evaluate(() => (window as unknown as { __heightChanges: unknown[] }).__heightChanges.length);
  await f.evaluate(({ record, target }) => {
    for (let i = 0; i < 40; i++) window.parent.postMessage({ type: 'lumin:resize', protocolVersion: 1, installationId: record.installationId, instanceId: record.instanceId, height: 900 + i }, target);
  }, { record, target: j.local.addresses.merchant });
  await expect(j.page.locator('iframe')).toHaveAttribute('height', '939');
  const applied = await j.page.evaluate(start => (window as unknown as { __heightChanges: Array<{at:number;height:string|null}> }).__heightChanges.slice(start), start);
  expect(applied.length).toBeGreaterThan(0);
  const elapsed = applied.at(-1)!.at - applied[0]!.at;
  expect(applied.length).toBeLessThanOrEqual(4 * (Math.floor(elapsed / 1000) + 2));
  for (const {at} of applied) expect(applied.filter(x=>x.at>=at&&x.at<at+1000).length).toBeLessThanOrEqual(8);
  await j.page.waitForTimeout(1100);
  await f.evaluate(() => document.getElementById('measurement-fixture')?.remove());
  await j.page.waitForTimeout(1100);
  await resizeFrom(f, record, j.local.addresses.merchant, { height: 320 });
  await expect(j.page.locator('iframe')).toHaveAttribute('height', '320');
  // Restore large measured content before the invalid-neighbor probes so no pending observer competes.
  await resizeFrom(f, record, j.local.addresses.merchant, { height: 1600 });
  await expect(j.page.locator('iframe')).toHaveAttribute('height', '1600');
  for (const height of [319, 1601, 320.5]) await resizeFrom(f, record, j.local.addresses.merchant, { height });
  await quietHeight(j.page, '1600');
  expect(await j.page.evaluate(()=>(window as unknown as {__heightBudget:{overflow:boolean}}).__heightBudget.overflow)).toBe(false);
  await j.unchanged();
}));
test('runtime-09 eight slots deny allocation and explicit replacement creates a new identity', async ({ journey: j }) => guarded(async () => {
  phase='CAPACITY_PRIME';
  await observe(j.page);
  // Trusted test instrumentation delegates to native entropy, recording calls only.
  await j.page.addInitScript(() => {
    const original = Crypto.prototype.getRandomValues;
    const counter = { calls: 0 }; Object.defineProperty(window, '__entropyCounter', { value: counter });
    Crypto.prototype.getRandomValues = function<T extends ArrayBufferView | null>(array: T): T { counter.calls++; return original.call(this, array) as T; };
  });
  const snippet = await j.local.snippet(j.w);
  await eightReady(j.page, j.local.addresses.merchant, j.local.registerPage(snippet), snippet);
  await appendSnippet(j.page, snippet);
  await expect(j.page.locator('iframe')).toHaveCount(8);
  for (const f of j.page.frames().slice(1)) await ready(f);
  const initial = (await messages(j.page)).filter(x => x.type === 'lumin:ready'); expect(initial).toHaveLength(8);
  const reads = j.local.attempted.reads;
  const result = await j.page.evaluate(() => {
    const w = window as unknown as { __entropyCounter: { calls: number }; BookingLumin: { mount(e: Element): string; unmount(e: Element): boolean } };
    const containers = document.querySelectorAll('div[data-booking-lumin-installation]');
    const entropy = w.__entropyCounter.calls;
    const denied = w.BookingLumin.mount(containers[8]!);
    return { denied, entropy, after: w.__entropyCounter.calls };
  });
  expect(result).toEqual({ denied: 'capacity', entropy: 8, after: 8 });
  await j.page.waitForTimeout(300); expect(j.local.attempted.reads).toBe(reads);
  const replaced = await j.page.evaluate(() => {
    const api = (window as unknown as { BookingLumin: { mount(e: Element): string; unmount(e: Element): boolean } }).BookingLumin;
    const containers = document.querySelectorAll('div[data-booking-lumin-installation]');
    return { removed: api.unmount(containers[0]!), mounted: api.mount(containers[8]!) };
  });
  expect(replaced).toEqual({ removed: true, mounted: 'mounted' });
  await expect(j.page.locator('iframe')).toHaveCount(8);
  for (const f of j.page.frames().slice(1)) await ready(f);
  const final = (await messages(j.page)).filter(x => x.type === 'lumin:ready'); expect(final).toHaveLength(9);
  expect(new Set(final.map(x => x.instanceId)).size).toBe(9); await j.unchanged();
}));
test('runtime-10 actual blocked policy backends remain bounded through repeated disposal', async ({ journey: j }) => guarded(async () => {
  phase='BACKEND_PRIME';
  await observe(j.page);
  const snippet = await j.local.snippet(j.w);
  await eightReady(j.page, j.local.addresses.merchant, j.local.registerPage(snippet), snippet);
  await expect(j.page.locator('iframe')).toHaveCount(8);
  for (const f of j.page.frames().slice(1)) await ready(f);
  const initialReady = (await messages(j.page)).filter(x => x.type === 'lumin:ready').length;
  const other = await j.context.newPage();
  await other.goto(j.local.addresses.second + j.local.registerPage('<h1>Read retention fixture</h1>'));
  await other.bringToFront(); await expect.poll(() => j.page.evaluate(() => document.hidden)).toBe(true);
  phase='BACKEND_WAIT';
  const holder = await holdPolicyTable(j.db);
  try {
    await j.page.bringToFront(); await expect.poll(() => j.page.evaluate(() => document.hidden)).toBe(false);
    await expect.poll(async () => (await blockedPolicyPids(j.db, j.local, holder.pid)).length).toBeGreaterThan(0);
    expect(j.local.backend.active).toBeGreaterThan(0);
    const started = j.local.backend.started;
    phase='BACKEND_CHURN';
    for (let round = 0; round < 2; round++) {
      const counts = await j.page.evaluate(() => {
        const api = (window as unknown as {BookingLumin:{unmount(e:Element):boolean;mount(e:Element):string}}).BookingLumin;
        const containers = [...document.querySelectorAll('div[data-booking-lumin-installation]')];
        const removed = containers.map(e => api.unmount(e));
        const mounted = containers.map(e => api.mount(e));
        return { removed, mounted, frames: document.querySelectorAll('iframe').length };
      });
      expect(counts.removed.every(Boolean)).toBe(true); expect(counts.mounted.every(x => x === 'mounted')).toBe(true); expect(counts.frames).toBe(8);
      await j.page.waitForTimeout(150);
      expect(j.local.backend.active).toBeLessThanOrEqual(2); expect(j.local.backend.peak).toBeLessThanOrEqual(2);
      expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(initialReady);
    }
    // Outward removal has not been confused with backend settlement: counts come from actual query promises.
    expect(j.local.backend.started).toBeGreaterThanOrEqual(started);
    await j.page.evaluate(() => {
      const api = (window as unknown as {BookingLumin:{unmount(e:Element):boolean}}).BookingLumin;
      for (const e of document.querySelectorAll('div[data-booking-lumin-installation]')) api.unmount(e);
    });
    await expect(j.page.locator('iframe')).toHaveCount(0);
  } finally { await holder.release(); await other.close(); }
  phase='BACKEND_SETTLEMENT';
  await expect.poll(() => j.local.backend.active, {timeout:10000}).toBe(0);
  expect(j.local.backend.finished).toBe(j.local.backend.started);
  await j.page.waitForTimeout(600);
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(initialReady);
  expect(await j.page.evaluate(() => (window as unknown as {BookingLumin:{mount(e:Element):string}}).BookingLumin.mount(document.querySelector('div[data-booking-lumin-installation]')!))).toBe('mounted');
  await ready(await child(j.page));
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(initialReady + 1);
  expect(j.local.backend.peak).toBeLessThanOrEqual(2); await j.unchanged();
}));
test('runtime-11 committed parent removal and disable remain terminal after restoration', async ({ journey: j }) => guarded(async () => {
  phase='POLICY_COMMIT';
  const before = await snapshot(j.db, j.w.f); await observe(j.page);
  const route = j.local.registerPage(await j.local.snippet(j.w));
  for (const disable of [false, true]) {
    await j.page.goto(j.local.addresses.merchant + route); const f = await child(j.page); await ready(f);
    const revision = disable ? 3 : 1;
    const receipt = await updatePolicy(j.db, j.w, !disable, disable ? [j.local.addresses.merchant,j.local.addresses.second].sort() : [j.local.addresses.second], revision);
    expect(receipt.policyRevision).toBe(revision + 1); expect(receipt.enabled).toBe(!disable); expect(receipt.changed).toBe(true);
    const committed = await snapshot(j.db, j.w.f);
    await unavailable(f);
    expect(await snapshot(j.db, j.w.f)).toEqual(committed);
    expect(customerState(committed)).toEqual(customerState(before));
    const restored = await updatePolicy(j.db, j.w, true, [j.local.addresses.merchant,j.local.addresses.second].sort(), revision + 1);
    expect(restored.policyRevision).toBe(revision + 2);
    const reads = j.local.attempted.reads;
    await f.evaluate(() => dispatchEvent(new Event('resize')));
    await j.page.waitForTimeout(1100);
    expect(await state(f)).toEqual({ state: 'unavailable', operational: 'false' });
    expect(j.local.attempted.reads).toBe(reads);
    expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(1);
  }
  expect(j.local.attempted.issuance).toBe(0);
}));
test('runtime-12 committed target and enabled policy revisions close existing generations', async ({ journey: j }) => guarded(async () => {
  phase='TARGET_COMMIT';
  const before = await snapshot(j.db, j.w.f); await observe(j.page);
  const route = j.local.registerPage(await j.local.snippet(j.w));
  await j.page.goto(j.local.addresses.merchant + route); let f = await child(j.page); await ready(f);
  const next = await advanceTarget(j.db, j.w);
  expect(next.versionId).not.toBe(j.w.published.versionId);
  const committed = await snapshot(j.db, j.w.f); await unavailable(f);
  expect(await snapshot(j.db, j.w.f)).toEqual(committed);
  expect(customerState(committed)).toEqual(customerState(before));
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(1);
  // Explicit new document observes the new target; no automatic initialization was inferred.
  await j.page.goto(j.local.addresses.merchant + route); f = await child(j.page); await ready(f);
  const bootstrap = await f.locator('#lumin-mode-bootstrap').evaluate(e => JSON.parse((e as HTMLTemplateElement).content.textContent!));
  expect(bootstrap.policy.currentVersionId).toBe(next.versionId); expect(bootstrap.policy.targetRevision).toBe(2);
  const receipt = await updatePolicy(j.db, j.w, true, [j.local.addresses.merchant], 1);
  expect(receipt.policyRevision).toBe(2); expect(receipt.enabled).toBe(true); expect(receipt.currentVersionId).toBe(next.versionId);
  const revised = await snapshot(j.db, j.w.f); await unavailable(f);
  expect(await snapshot(j.db, j.w.f)).toEqual(revised); expect(customerState(revised)).toEqual(customerState(before));
  expect((await messages(j.page)).filter(x => x.type === 'lumin:ready')).toHaveLength(1); expect(j.local.attempted.issuance).toBe(0);
}));
test('runtime-13 headed real visibility and navigation lifecycle', async ({ journey: j }) => guarded(async () => {
  await observe(j.page);
  phase='NAVIGATION'; const download=j.local.registerDownload(); const route=j.local.registerPage((await j.local.snippet(j.w))+'<a href="'+download+'" download>Download denial fixture</a>'); await j.page.goto(j.local.addresses.merchant+route); const f=await child(j.page);await ready(f);
  phase='WORKER'; let workerCsp=false; j.page.on('console',m=>{const text=m.text();if(/worker|Worker/.test(text)&&/Content Security Policy|content security policy/.test(text))workerCsp=true;});
  const priorAssetRequests=j.local.wirePrivacy.asset.requests;const priorWorkerRequests=j.local.wirePrivacy.asset.worker; const worker=await f.evaluate(async()=>{let rejected=false;try{await navigator.serviceWorker.register(document.querySelector<HTMLScriptElement>('script')!.src);}catch{rejected=true;}return{rejected,registrations:(await navigator.serviceWorker.getRegistrations()).length};});
  expect(worker).toEqual({rejected:true,registrations:0});await expect.poll(()=>workerCsp).toBe(true);expect(j.local.wirePrivacy.asset.requests).toBe(priorAssetRequests);expect(j.local.wirePrivacy.asset.worker).toBe(priorWorkerRequests);
  phase='DOWNLOAD'; await j.page.getByRole('link',{name:'Download denial fixture'}).click();await expect.poll(()=>j.downloadDenied()).toBe(true);
  phase='VISIBILITY'; let reads=0; j.page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/public/installation-policies/'))reads++;});
  const other=await j.context.newPage();await other.goto(j.local.addresses.second+j.local.registerPage('<h1>Visibility fixture</h1>')); await other.bringToFront(); await expect.poll(()=>j.page.evaluate(()=>document.hidden)).toBe(true); const prior=reads;
  await other.waitForTimeout(31000); expect(reads).toBe(prior); await j.page.bringToFront();await expect.poll(()=>j.page.evaluate(()=>document.hidden)).toBe(false); await expect.poll(()=>reads).toBe(prior+1); await ready(f);
  phase='LIFECYCLE'; const initialId=(await messages(j.page)).find(x=>x.type==='lumin:ready')!.instanceId;
  await j.page.goto(j.local.addresses.merchant+j.local.registerPage('<h1>Navigation fixture</h1>'));await j.page.goBack();await ready(await child(j.page));
  const restoredId=(await messages(j.page)).find(x=>x.type==='lumin:ready')!.instanceId; expect(restoredId).not.toBe(initialId);
  await j.page.reload();await ready(await child(j.page));expect((await messages(j.page)).find(x=>x.type==='lumin:ready')!.instanceId).not.toBe(restoredId);
  await other.close();await j.unchanged();
}));
test('runtime-14 exact bytes, TLS, MIME and terminal asset aliases are enforced', async ({ journey: j }) => guarded(async () => {
  phase='ASSET_BYTES';
  const url = j.local.addresses.renderer + '/checkout/flow/' + j.w.hosted.installationId;
  await j.page.goto(url); await ready(j.page.mainFrame());
  const script = await j.page.locator('script').evaluate(e => ({ src: (e as HTMLScriptElement).src, integrity: (e as HTMLScriptElement).integrity, crossorigin: e.getAttribute('crossorigin') }));
  const path = new URL(script.src).pathname;
  const bytes = await wire(j.local.addresses.renderer, path, j.tls);
  expect(bytes.status).toBe(200); expect(bytes.bytes.length).toBeGreaterThan(0); expect(bytes.bytes.length).toBeLessThanOrEqual(262144);
  const digest = createHash('sha256').update(bytes.bytes).digest('hex');
  expect(path).toBe('/assets/booking-lumin-controller.' + digest + '.js');
  expect(script.integrity).toBe('sha256-' + Buffer.from(digest, 'hex').toString('base64')); expect(script.crossorigin).toBe('anonymous');
  expect(bytes.headers['content-type']).toBe('application/javascript;charset=utf-8'); expect(bytes.headers['x-content-type-options']).toBe('nosniff');
  const doc = await wire(j.local.addresses.renderer, new URL(url).pathname, j.tls);
  expect(doc.status).toBe(200); expect(doc.headers['content-security-policy']).toContain('connect-src ' + j.local.addresses.api);
  expect(doc.headers['content-security-policy']).toContain("script-src '" + script.integrity + "'");
  expect(doc.headers['cache-control']).toBe('no-store,max-age=0'); expect(doc.headers['cdn-cache-control']).toBe('no-store'); expect(doc.headers['netlify-cdn-cache-control']).toBe('no-store');
  await j.page.route('**/assets/booking-lumin-controller.*.js', route => route.fulfill({ status: 200, contentType: 'application/javascript;charset=utf-8', body: 'window.__unexpectedRuntimeExecution=true;' }));
  await j.page.reload(); expect(await j.page.evaluate(() => document.documentElement.dataset.bookingLuminState)).not.toBe('ready');
  expect(await j.page.evaluate(() => Object.hasOwn(window, '__unexpectedRuntimeExecution'))).toBe(false);
  await j.page.unrouteAll(); await j.page.reload(); await ready(j.page.mainFrame());
  // Missing redirect destination is a load failure, distinct from the matching-byte positive below.
  for (const fault of ['wrong-mime','redirect'] as const) {
    phase=fault==='wrong-mime'?'MIME':'REDIRECT_MISSING';
    const redirects = j.local.assetControl.redirectResponses;
    const missing = j.local.assetControl.missingDestinationHits;
    j.local.setAssetFault(fault);
    try { await j.page.reload(); expect(await j.page.evaluate(() => document.documentElement.dataset.bookingLuminState)).not.toBe('ready'); }
    finally { j.local.setAssetFault('none'); }
    if (fault === 'redirect') { expect(j.local.assetControl.redirectResponses).toBe(redirects + 1); expect(j.local.assetControl.missingDestinationHits).toBe(missing + 1); }
    await j.page.reload(); await ready(j.page.mainFrame());
  }
  phase='REDIRECT_IDENTICAL';
  const redirected = j.local.assetControl.redirectResponses;
  const identical = j.local.assetControl.sameBytesDestinationHits;
  j.local.setAssetFault('redirect-same-bytes');
  try {
    await j.page.reload(); await ready(j.page.mainFrame());
    expect(j.local.assetControl.redirectResponses).toBe(redirected + 1);
    expect(j.local.assetControl.sameBytesDestinationHits).toBe(identical + 1);
    expect(await j.page.locator('script').getAttribute('integrity')).toBe(script.integrity);
  } finally { j.local.setAssetFault('none'); }
  await j.page.reload(); await ready(j.page.mainFrame());
  phase='RAW_ASSETS';
  // Node wire preserves raw target spelling; browser URL normalization is not called raw-ingress proof.
  for (const target of [path+'?x=1',path+'#x',path+'/',path.replace('/assets/','/assets//'),path.replace('/assets/','/assets/./'),path.replace('.js','%2ejs')]) {
    const denied = await wire(j.local.addresses.renderer, target, j.tls); expect(denied.status).toBe(target === path+'/' ? 404 : 400);
    expect(denied.headers['content-type']).toBe('application/json;charset=utf-8'); expect(denied.bytes.equals(bytes.bytes)).toBe(false);
  }
  for (const target of ['/assets/booking-lumin-controller.'+'f'.repeat(64)+'.js','/index.html','/checkout','/embed']) {
    const denied = await wire(j.local.addresses.renderer,target,j.tls); expect(denied.status).toBe(404);
    expect(denied.bytes.toString('utf8')).not.toContain('<script');
  }
  await expect(wire(j.local.addresses.renderer,path,j.tls,{ca:j.tls.untrustedCert})).rejects.toThrow('TLS_REQUEST_FAILED');
  await expect(wire(j.local.addresses.renderer,path,j.tls,{servername:'unowned.invalid'})).rejects.toThrow('TLS_REQUEST_FAILED');
  expect((await wire(j.local.addresses.renderer,path,j.tls)).bytes.equals(bytes.bytes)).toBe(true);
  await j.page.reload(); await ready(j.page.mainFrame()); await j.unchanged();
}));
test('runtime-15 no credentials storage messages or session attempts', async ({ journey: j }) => guarded(async () => {
  phase='PRIVACY_CONTROLS';
  await j.page.addInitScript(() => {
    const audit = { invalid: false, total: 0, init: 0, ready: 0, resize: 0 };
    Object.defineProperty(window, '__strictProtocol', { value: audit });
    addEventListener('message', event => {
      if (++audit.total > 128) { audit.invalid = true; return; }
      try {
        const value = event.data;
        if (!value || typeof value !== 'object' || !['lumin:init','lumin:ready','lumin:resize'].includes(value.type)) throw Error();
        const keys = value.type === 'lumin:resize' ? ['type','protocolVersion','installationId','instanceId','height'] : ['type','protocolVersion','installationId','instanceId'];
        if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => { const d = Object.getOwnPropertyDescriptor(value,key); return !d || !('value' in d) || !d.enumerable; })) throw Error();
        if (value.protocolVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.installationId) || !/^[0-9a-f]{32}$/.test(value.instanceId) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 1024) throw Error();
        if (value.type === 'lumin:resize' && (!Number.isInteger(value.height) || value.height < 320 || value.height > 1600)) throw Error();
        if (value.type === 'lumin:init') audit.init++; else if (value.type === 'lumin:ready') audit.ready++; else audit.resize++;
      } catch { audit.invalid = true; }
    });
  });
  const policyUrl = j.local.addresses.api + '/api/public/installation-policies/' + j.w.iframe.installationId;
  const childUrl = j.local.addresses.renderer + '/embed/flow/' + j.w.iframe.installationId;
  const network = { count: 0, invalid: false, policyRequests: 0, policyResponses: 0 };
  j.context.on('request', request => {
    if (++network.count > 1000) { network.invalid = true; return; }
    const url = new URL(request.url());
    if (request.method() !== 'GET' || request.postData() !== null || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') network.invalid = true;
    const headers = request.headers();
    if (headers.authorization !== undefined || headers.cookie !== undefined) network.invalid = true;
    if (request.url() === policyUrl) {
      try { if (request.frame().url() !== childUrl) network.invalid = true; } catch { network.invalid = true; }
      network.policyRequests++;
    }
  });
  j.context.on('response', response => {
    if (response.url() !== policyUrl) return;
    if (network.policyResponses >= 1000) { network.invalid = true; return; }
    if (response.status() !== 200) network.invalid = true;
    network.policyResponses++;
  });
  await observe(j.page);await observe(j.page);await j.page.goto(j.local.addresses.merchant+j.local.registerPage('<h1>Observer controls</h1>'));
  await j.page.evaluate(()=>window.postMessage({type:'lumin:ready',protocolVersion:1,installationId:'11111111-1111-4111-8111-111111111111',instanceId:'1'.repeat(32),privateSentinel:crypto.randomUUID()},location.origin));
  await expect.poll(()=>inspected(j.page)).toEqual({invalid:true,overflow:false});expect(await messages(j.page)).toEqual([]);
  for (const value of [
    {type:'unknown-output',privateSentinel:'synthetic'},
    {type:'lumin:init',protocolVersion:1,installationId:'11111111-1111-4111-8111-111111111111',instanceId:'1'.repeat(32),extra:'synthetic'},
  ]) {
    await j.page.reload();
    await j.page.evaluate(value=>window.postMessage(value,location.origin),value);
    await expect.poll(()=>j.page.evaluate(()=>(window as unknown as {__strictProtocol:{invalid:boolean}}).__strictProtocol.invalid)).toBe(true);
  }
  await j.page.reload();expect(await inspected(j.page)).toEqual({invalid:false,overflow:false});
  await j.page.evaluate(()=>{for(let i=0;i<129;i++)window.postMessage({type:'lumin:ready',protocolVersion:1,installationId:'11111111-1111-4111-8111-111111111111',instanceId:'1'.repeat(32)},location.origin);});
  await expect.poll(()=>inspected(j.page)).toEqual({invalid:false,overflow:true});expect(await messages(j.page)).toHaveLength(128);
  await j.page.goto(j.local.addresses.merchant+j.local.registerPage(await j.local.snippet(j.w)));await ready(await child(j.page));
  await publicStorage(j.page); await strictProtocol(j.page); expect(await j.context.cookies()).toEqual([]);
  phase='PRIVACY_REFRESH';
  // attempted.reads counts R's bootstrap fetch, not the browser child's direct A refresh.
  // Observe the exact live child request plus its real 200 response and the native A ingress.
  const reads = { requests: network.policyRequests, responses: network.policyResponses };
  expect(reads.requests).toBe(1); expect(reads.responses).toBe(1);
  const nativeReads = j.local.wirePrivacy.policy.requests;
  await expect.poll(() => ({requests:network.policyRequests,responses:network.policyResponses}), {timeout:35000})
    .toEqual({requests:reads.requests+1,responses:reads.responses+1});
  expect(j.local.wirePrivacy.policy.requests).toBe(nativeReads+1);
  phase='PRIVACY_REFRESH_READY';
  await ready(await child(j.page)); await publicStorage(j.page); await strictProtocol(j.page);
  await j.page.evaluate(() => {
    const api = (window as unknown as {BookingLumin:{unmount(e:Element):boolean;mount(e:Element):string}}).BookingLumin;
    const container=document.querySelector('div[data-booking-lumin-installation]')!;api.unmount(container);api.mount(container);
  });
  await ready(await child(j.page)); await publicStorage(j.page); await strictProtocol(j.page); expect(await j.context.cookies()).toEqual([]);
  const allowed = new Set(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role', 'SELECT public.mode_public_installation_policy($1::uuid) AS result', 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT']);
  expect(j.local.queries.length).toBeGreaterThan(0); expect(j.local.queries.every(sql=>allowed.has(sql))).toBe(true);
  expect(j.local.queries.some(sql=>sql==='SELECT public.mode_public_installation_policy($1::uuid) AS result')).toBe(true);
  expect(network.count).toBeGreaterThan(0); expect(network.invalid).toBe(false);
  let initCount = 0, readyCount = 0;
  for (const frame of j.page.frames()) {
    const audit = await frame.evaluate(()=>(window as unknown as {__strictProtocol:{invalid:boolean;init:number;ready:number}}).__strictProtocol);
    expect(audit.invalid).toBe(false); initCount += audit.init; readyCount += audit.ready;
  }
  expect(initCount).toBeGreaterThan(0); expect(readyCount).toBeGreaterThan(0);
  expect(await inspected(j.page)).toEqual({invalid:false,overflow:false});for(const v of await messages(j.page))expect(Object.keys(v).every(k=>['type','installationId','instanceId','height'].includes(k))).toBe(true);expect(j.local.attempted.issuance).toBe(0);await j.unchanged();
}));
test('runtime-16 real responsive unavailable customer shell', async ({ journey: j }) => guarded(async () => {
  phase='RESPONSIVE';
  await j.page.goto(j.local.addresses.merchant+j.local.registerPage(await j.local.snippet(j.w)));const f=await child(j.page);await ready(f);
  expect(await f.locator('form,input,select,textarea,button,a[href],[tabindex]').count()).toBe(0);
  for(const width of [320,768,1440]){await j.capture('runtime-16-'+width+'.png',width);await expect(f.getByText(marker,{exact:true})).toBeVisible();expect(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); expect(Number(await j.page.locator('iframe').getAttribute('height'))).toBeGreaterThanOrEqual(320); expect(Number(await j.page.locator('iframe').getAttribute('height'))).toBeLessThanOrEqual(1600);}await j.unchanged();
}));






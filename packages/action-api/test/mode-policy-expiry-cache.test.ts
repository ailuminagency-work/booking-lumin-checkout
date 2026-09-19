/** Handler-unit semantics with owned request/response doubles; not native HTTP qualification. */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createModePolicyHttpHandler } from '../server/mode-policy-http';
import type { ModeClock } from '../server/mode-installation-repository';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const path = '/api/public/installation-policies/' + id;
const profile = { profileVersion: 'test-v1', rendererOrigin: 'https://renderer.test:44301', apiOrigin: 'https://api.test:44302', portalOrigin: 'https://portal.test:44303', loaderUrl: 'https://renderer.test:44301/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' };
function fixture() {
 let now = 0, clockFailure = false;
 const timers = new Set<unknown>();
 const clock: ModeClock = { monotonic() { if (clockFailure) throw Error('clock'); return now; }, setTimer(fn) { timers.add(fn); return fn; }, clearTimer(token) { timers.delete(token); } };
 const read = vi.fn(async () => ({ kind: 'failed' as const, code: 'UNAVAILABLE' as const, transaction: 'not_started' as const, backendMayStillRun: false }));
 const handler = createModePolicyHttpHandler({ reader: { publicPolicy: read, close: async () => {} }, profiles: [profile], clock });
 function send(peer: string | (() => string), url = '/missing') {
  const headers: Record<string, string> = {};
  const req = Object.assign(new EventEmitter(), { method: 'POST', url, rawHeaders: ['Host', 'api.test:44302', 'Origin', profile.rendererOrigin], socket: Object.defineProperty({}, 'remoteAddress', { get: typeof peer === 'function' ? peer : () => peer }) });
  const res = Object.assign(new EventEmitter(), { statusCode: 0, destroyed: false, writableEnded: false, writableFinished: false, headersSent: false, body: '', setHeader(name: string, value: unknown) { headers[name.toLowerCase()] = String(value); }, end(value?: unknown) { this.body = value === undefined ? '' : String(value); this.writableEnded = true; this.writableFinished = true; }, destroy() { this.destroyed = true; } });
  handler.handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  // Check every response invariant without matcher allocation in the 10,000-entry fill.
  if (res.writableEnded !== true || res.destroyed !== false ||
      headers['cache-control'] !== 'no-store,max-age=0' ||
      headers['access-control-allow-origin'] !== profile.rendererOrigin || timers.size !== 0 ||
      req.listenerCount('aborted') !== 0 || res.listenerCount('close') !== 0) throw Error('HANDLER_FIXTURE_INVARIANT');
  return { status: res.statusCode, headers, body: JSON.parse(res.body) as { error: { code: string } } };
 }
 return { send, set(value: number) { now = value; }, fail() { clockFailure = true; }, read, close: handler.close };
}
it('expires only the oldest address at the exact boundary and never refreshes hits or denials', async () => {
 const f = fixture(); try {
  for (let i = 0; i < 60; i++) expect(f.send('old').status).toBe(404);
  f.set(1000); for (let i = 0; i < 120; i++) expect(f.send('new').status).toBe(404);
  f.set(30000); for (let i = 0; i < 60; i++) expect(f.send('old').status).toBe(404);
  expect(f.send('old').headers['retry-after']).toBe('30');
  f.set(58001); expect(f.send('old').headers['retry-after']).toBe('2');
  f.set(59999); expect(f.send('old').headers['retry-after']).toBe('1');
  f.set(60000); expect(f.send('old').status).toBe(404); expect(f.send('new').status).toBe(429); expect(f.send('new').headers['retry-after']).toBe('1');
  f.set(61000); expect(f.send('new').status).toBe(404); expect(f.read).not.toHaveBeenCalled();
 } finally { await f.close(); }
});
it('keeps installation quota independent of address windows and preserves exact expiry retry', async () => {
 const f = fixture(); try {
  for (let i = 0; i < 600; i++) expect(f.send('peer-' + Math.floor(i / 100), path).status).toBe(405);
  expect(f.send('denied-peer', path).headers['retry-after']).toBe('60');
  f.set(59999); expect(f.send('denied-peer', path).headers['retry-after']).toBe('1');
  f.set(60000); expect(f.send('denied-peer', path).status).toBe(405);
  expect(f.read).not.toHaveBeenCalled();
 } finally { await f.close(); }
});
it('shares the cap across both maps, preserves partial address admission and recalculates earliest expiry', async () => {
 const f = fixture(); try {
  expect(f.send('original').status).toBe(404); // Address starts at zero.
  f.set(1000); expect(f.send('original', path).status).toBe(405); // Installation starts later.
  f.set(2000); for (let i = 0; i < 9998; i++) expect(f.send('fill-' + i).status).toBe(404);
  const denied = f.send('fresh'); expect(denied.status).toBe(429); expect(denied.headers['retry-after']).toBe('58');
  expect(f.send('fill-0').status).toBe(404); // Existing keys remain usable at capacity.
  f.set(59999); expect(f.send('fresh').headers['retry-after']).toBe('1');
  f.set(60000);
  const otherPath = path.replace(id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const partial = f.send('fresh', otherPath); expect(partial.status).toBe(429); expect(partial.headers['retry-after']).toBe('1');
  expect(f.send('fresh').status).toBe(404); // Address was admitted before installation denial.
  expect(f.send('another').status).toBe(429); // Its final slot was retained.
  f.set(61000); expect(f.send('fresh', otherPath).status).toBe(405);
  expect(f.send('another').headers['retry-after']).toBe('1'); // Next oldest belongs to address map.
  f.set(62000); expect(f.send('another').status).toBe(404);
  expect(f.read).not.toHaveBeenCalled();
 } finally { await f.close(); }
});
it('reestablishes expiry after all windows disappear including an empty installation map', async () => {
 const f = fixture(); try {
  for (let i = 0; i < 120; i++) expect(f.send('only-address').status).toBe(404);
  f.set(60000); for (let i = 0; i < 120; i++) expect(f.send('replacement').status).toBe(404);
  f.set(119999); expect(f.send('replacement').headers['retry-after']).toBe('1');
  f.set(120000); expect(f.send('replacement').status).toBe(404);
 } finally { await f.close(); }
});
it('does not assume insertion order when request metadata synchronously reenters the handler', async () => {
 const f = fixture(); try {
  expect(f.send(() => { f.set(1); expect(f.send('nested').status).toBe(404); return 'outer'; }).status).toBe(404);
  for (let i = 0; i < 119; i++) { expect(f.send('outer').status).toBe(404); expect(f.send('nested').status).toBe(404); }
  f.set(60000); expect(f.send('outer').status).toBe(404); expect(f.send('nested').status).toBe(429);
  f.set(60001); expect(f.send('nested').status).toBe(404);
 } finally { await f.close(); }
});
it.each(['backward', 'nan', 'throw'])('clock %s remains terminal rather than resetting rate windows', async mode => {
 const f = fixture(); try {
  f.set(100); expect(f.send('old').status).toBe(404);
  if (mode === 'throw') f.fail(); else f.set(mode === 'nan' ? NaN : 99);
  expect(f.send('new').status).toBe(503);
  f.set(60000); expect(f.send('new').status).toBe(503); expect(f.read).not.toHaveBeenCalled();
 } finally { await f.close(); }
});

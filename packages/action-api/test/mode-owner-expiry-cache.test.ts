/** Handler-unit checks through the existing server seam; no listen or native transport claim. */
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { __createModeOwnerHttpServerForTests } from '../server/mode-owner-http';
import type { ModeOwnerComposition } from '../server/mode-owner-composition';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const origin = 'http://127.0.0.1:5174';
const publish = { tenantId: id(2), flowId: id(3), expectedDraftRevision: 1, idempotencyKey: 'idempotency-key-001' };
type Reply = { status: number; headers: Record<string,string>; body: { phase?: string; error?: { code: string } } };
function fixture() {
 let now = 0, broken = false;
 const auth = vi.fn(async () => id(1));
 const owner = { publish: vi.fn(async () => ({ kind: 'committed', delivery: 'receipt', receipt: { schemaVersion: 1, actorId: id(1), flowId: id(3), operation: 'publish', versionId: id(4), sourceRevision: 1, renderSchemaVersion: 1 } })), requestHistory: vi.fn(async () => ({ kind: 'completed', delivery: 'data', data: { schemaVersion: 1, requests: [], nextCursor: null } })) };
 const composition = { owner, profiles: [], profile: null, localOwnerApi: 'http://127.0.0.1:8788', localDraftApi: 'http://127.0.0.1:8789', localPortalOrigin: origin, authenticateOwner: auth, draftRepository: { call: vi.fn() }, close: async () => {} } as unknown as ModeOwnerComposition;
 const control = __createModeOwnerHttpServerForTests({ composition, now() { if (broken) throw Error('clock'); return now; } });
 const requests: Readable[] = [], responses: EventEmitter[] = [];
 function send(peer: string | (() => string) = '127.0.0.1', route = 'profile', token = 'synthetic-owner-token'): Promise<Reply> {
  const post = route !== 'profile';
  const raw = Buffer.from(JSON.stringify(route === 'publish' ? publish : { tenantId: id(2), flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 }));
  const headers = { host: '127.0.0.1:8788', origin, authorization: 'Bearer ' + token, ...(post ? { 'content-type': 'application/json', 'content-length': String(raw.length) } : {}) };
  const req = Object.assign(Readable.from(post ? [raw] : [], { autoDestroy: false }), { method: post ? 'POST' : 'GET', url: '/api/local/mode-owner/' + route, headers, rawHeaders: Object.entries(headers).flat(), socket: Object.defineProperty({}, 'remoteAddress', { get: typeof peer === 'function' ? peer : () => peer }), aborted: false });
  requests.push(req);
  return new Promise(resolve => {
   const sent: Record<string,string> = {};
   const res = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false, headersSent: false, statusCode: 0, setHeader(key: string, value: unknown) { sent[key.toLowerCase()] = String(value); }, writeHead(status: number) { this.statusCode = status; this.headersSent = true; }, end(value: unknown) { this.writableFinished = true; if (this.destroyed || sent['cache-control'] !== 'no-store' || sent['access-control-allow-origin'] !== origin) throw Error('OWNER_FIXTURE_INVARIANT'); resolve({ status: this.statusCode, headers: sent, body: JSON.parse(String(value)) }); }, destroy() { this.destroyed = true; } });
   responses.push(res); control.server.emit('request', req, res);
  });
 }
 return { send, owner, auth, set(n: number) { now = n; }, fail() { broken = true; }, close() { control.stopAdmission(); for (const req of requests) { req.destroy(); req.removeAllListeners(); } for (const res of responses) res.removeAllListeners(); control.server.removeAllListeners(); expect(control.server.listening).toBe(false); } };
}
function status(reply: Reply, expected: number) { if (reply.status !== expected) throw Error('UNEXPECTED_OWNER_STATUS'); }
it('preserves staggered address expiry and does not refresh existing or denied windows', async () => {
 const f = fixture(); try {
  for (let i=0;i<60;i++) status(await f.send('old'),403);
  f.set(1000); for (let i=0;i<120;i++) status(await f.send('new'),403);
  f.set(30000); for (let i=0;i<60;i++) status(await f.send('old'),403);
  expect((await f.send('old')).headers['retry-after']).toBe('30');
  f.set(59999); expect((await f.send('old')).headers['retry-after']).toBe('1');
  f.set(60000); status(await f.send('old'),403); expect((await f.send('new')).headers['retry-after']).toBe('1');
  f.set(61000); status(await f.send('new'),403); expect(f.auth).not.toHaveBeenCalled();
 } finally { f.close(); }
});
it('global quota consumes address-denied attempts and resets exactly at sixty seconds', async () => {
 const f=fixture(); try {
  for(let i=0;i<600;i++) status(await f.send('blocked-peer'),i<120?403:429);
  expect((await f.send('fresh-peer')).headers['retry-after']).toBe('60');
  f.set(59999); expect((await f.send('fresh-peer')).headers['retry-after']).toBe('1');
  f.set(60000); status(await f.send('fresh-peer'),403);expect(f.auth).not.toHaveBeenCalled();
 } finally { f.close(); }
});
it('retains the combined1024 cap, fixed cap retry60 and counts of unexpired keys', async () => {
 const f=fixture(); try {
  status(await f.send('seed'),403);f.set(59999);
  for(let i=0;i<599;i++)status(await f.send('old-'+i),403);
  f.set(60000);for(let i=0;i<424;i++)status(await f.send('new-'+i),403);
  const denied=await f.send('overflow');expect(denied.status).toBe(429);expect(denied.headers['retry-after']).toBe('60');
  status(await f.send('new-0'),403);status(await f.send('overflow'),429);
  f.set(119999);status(await f.send('overflow'),403);
  for(let i=0;i<118;i++)status(await f.send('new-0'),403);
  status(await f.send('new-0'),429);f.set(120000);status(await f.send('new-0'),403);
  expect(f.auth).not.toHaveBeenCalled();
 } finally { f.close(); }
});
it('keeps authenticated read120 and mutation30 independent with different starts across four maps', async () => {
 const f=fixture();const peers=['127.0.0.1','::1','::ffff:127.0.0.1'];try {
  status(await f.send('seed'),403);f.set(1000);
  for(let i=0;i<120;i++)status(await f.send(peers[i%3]!,'request-history'),200);
  f.set(2000);for(let i=0;i<30;i++)status(await f.send('127.0.0.1','publish'),200);
  expect((await f.send('::1','request-history')).headers['retry-after']).toBe('59');
  expect((await f.send('::1','publish')).headers['retry-after']).toBe('60');
  f.set(60000);status(await f.send('::1','request-history'),429);status(await f.send('::1','publish'),429);
  f.set(60999);expect((await f.send('::1','request-history')).headers['retry-after']).toBe('1');
  f.set(61000);status(await f.send('::1','request-history'),200);expect((await f.send('::1','publish')).headers['retry-after']).toBe('1');
  f.set(62000);status(await f.send('::1','publish'),200);
  expect(f.owner.requestHistory).toHaveBeenCalledTimes(121);expect(f.owner.publish).toHaveBeenCalledTimes(31);
 } finally { f.close(); }
});
it('uses post-auth scope time while retaining earlier ingress time during asynchronous interleaving', async () => {
 const f=fixture();let release!: (actor:string)=>void;
 f.auth.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 try {
  const pending=f.send();f.set(1000);release(id(1));status(await pending,200);
  for(let i=0;i<119;i++)status(await f.send(i%2?'::1':'::ffff:127.0.0.1'),200);
  f.set(60000);expect((await f.send()).headers['retry-after']).toBe('1');
  f.set(61000);status(await f.send(),200);
 } finally { release?.(id(1));f.close(); }
});
it('handles an older captured ingress timestamp inserted after a nested later request', async () => {
 const f=fixture();let entered=false;let nested:Promise<Reply>|undefined;
 try {
  status(await f.send(()=>{if(!entered){entered=true;f.set(1);nested=f.send('nested');}return 'outer';}),403);
  status(await nested!,403);
  for(let i=0;i<119;i++){status(await f.send('outer'),403);status(await f.send('nested'),403);}
  f.set(60000);status(await f.send('outer'),403);status(await f.send('nested'),429);
  f.set(60001);status(await f.send('nested'),403);
 } finally { f.close(); }
});
it.each(['backward','nan','throw'])('clock %s stays terminal after expiry instead of reopening admission',async mode=>{
 const f=fixture();try {f.set(100);status(await f.send(),200);if(mode==='throw')f.fail();else f.set(mode==='nan'?NaN:99);status(await f.send(),503);f.set(60000);status(await f.send(),503);}finally{f.close();}
});

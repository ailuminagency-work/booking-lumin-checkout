import assert from 'node:assert/strict';
import { loadModeRuntimeAssets } from '../../packages/action-api/server/mode-runtime-assets.js';
import { createInstallationContracts } from '../../packages/contracts/src/installation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { X509Certificate, createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { Pool, type PoolConfig } from 'pg';
import { createModeDocumentHandler } from '../../packages/flow-ui/src/modeDocument.js';
import { fixture, transaction, rpc, config, type Fixture } from '../../packages/action-api/server/mode-installations-fixtures.js';
import { state } from '../../packages/action-api/server/mode-owner-journey-fixtures.js';
import { createModePolicyHttpHandler } from '../../packages/action-api/server/mode-policy-http.js';
import { __createLocalModePolicyCompositionForTests } from '../../packages/action-api/server/mode-policy-local.js';
export const HOSTS = ['renderer.mode.test', 'api.mode.test', 'portal.mode.test', 'merchant.mode.test', 'second.mode.test', 'forbidden.mode.test'] as const;
export const BROWSER_HOSTS=[...HOSTS,'merchant.mode.test.forbidden.mode.test'] as const;
export function addresses() {
  const names = ['RENDERER', 'API', 'PORTAL', 'MERCHANT', 'SECOND', 'FORBIDDEN', 'UNTRUSTED'] as const;
  const ports = names.map(name => { const raw = process.env[`MODE_DOCUMENT_${name}_PORT`] ?? ''; assert.match(raw, /^[1-9][0-9]{3,4}$/); const n = Number(raw); assert.ok(n >= 1024 && n <= 65535); return n; });
  assert.equal(new Set(ports).size, 7);
  const [renderer, api, portal, merchant, second, forbidden, untrusted] = ports.map((port, i) => `https://${HOSTS[Math.min(i, 5)]}:${port}`);
  return { renderer: renderer!, api: api!, portal: portal!, merchant: merchant!, second: second!, forbidden: forbidden!, untrusted: untrusted! };
}
let registeredProfile: Awaited<ReturnType<typeof loadModeRuntimeAssets>>['profile'] | undefined;
export async function runtimeAssets() {
  const directory = process.env.MODE_RUNTIME_ASSET_DIR ?? '';
  assert.ok(directory.length > 0);
  const registration = await loadModeRuntimeAssets(directory);
  const a = addresses();
  assert.equal(registration.profile.rendererOrigin, a.renderer);
  assert.equal(registration.profile.apiOrigin, a.api);
  assert.equal(registration.profile.portalOrigin, a.portal);
  registeredProfile = registration.profile; return registration;
}
export function profile() { assert.ok(registeredProfile, 'RUNTIME_ASSETS_NOT_READY'); return registeredProfile; }
export function observerConfig(): PoolConfig {
  for (const name of ['LOCAL_HARNESS', 'FLOW_TEST_DISPOSABLE', 'MODE_INSTALLATIONS_TEST_DISPOSABLE', 'MODE_DOCUMENT_TEST_DISPOSABLE', 'MODE_RUNTIME_TEST_DISPOSABLE']) assert.equal(process.env[name], '1');
  for (const name of ['DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS']) assert.equal(process.env[name] ?? '', '');
  assert.ok(['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? '')); assert.ok(['5432', '55439'].includes(process.env.PGPORT ?? ''));
  assert.equal(process.env.PGUSER, 'postgres'); assert.match(process.env.PGDATABASE ?? '', /^lumin_mode_document_runtime_[a-z0-9_]+$/); assert.ok(process.env.PGDATABASE!.length <= 63);
  assert.ok(['public', 'extensions'].includes(process.env.MODE_DOCUMENT_CRYPTO_LAYOUT ?? '')); const password = process.env.PGPASSWORD ?? ''; assert.ok(['', 'postgres'].includes(password));
  return { host: process.env.PGHOST, port: Number(process.env.PGPORT), database: process.env.PGDATABASE, user: 'postgres', password: () => password, max: 4, ssl: false, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, application_name: 'independent-mode-runtime' };
}
export async function observer() { const startupAssets = await runtimeAssets(); startupAssets.close();
  const db = new Pool(observerConfig()); db.on('error', () => {});
  try {
    const identity = (await db.query("select current_database() db,current_user usr,(select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto') crypto,to_regprocedure('public.mode_public_installation_policy(uuid)')::text rpc")).rows[0];
    assert.equal(identity.db, process.env.PGDATABASE); assert.equal(identity.usr, 'postgres'); assert.equal(identity.crypto, process.env.MODE_DOCUMENT_CRYPTO_LAYOUT); assert.ok(identity.rpc);
    const p = profile(); const rows = (await db.query('select * from lumin.installation_profiles where version=$1', [p.profileVersion])).rows;
    if (!rows.length) await db.query('insert into lumin.installation_profiles(version,renderer_origin,api_origin,portal_origin,loader_sha256) values($1,$2,$3,$4,$5)', [p.profileVersion, p.rendererOrigin, p.apiOrigin, p.portalOrigin, p.loaderUrl.match(/loader\.([0-9a-f]{64})\.js$/)![1]]);
    const saved = (await db.query('select * from lumin.installation_profiles where version=$1', [p.profileVersion])).rows[0];
    assert.deepEqual([saved.renderer_origin, saved.api_origin, saved.portal_origin, saved.loader_sha256], [p.rendererOrigin, p.apiOrigin, p.portalOrigin, p.loaderUrl.match(/loader\.([0-9a-f]{64})\.js$/)![1]]);
    return db;
  } catch { await db.end(); throw Error('DOCUMENT_DATABASE_SETUP_FAILED'); }
}
export async function seed(db: Pool, v2 = false) {
  const f = await fixture(db);
  if (v2) await transaction(db, c => rpc(c, 'save_configurable_flow_draft', [f.actor, f.tenant, f.flow, f.service, 1, 'Local configurable', JSON.stringify({ authoringVersion: 2, config, questionOverrides: {} })]));
  const published = await transaction(db, c => rpc(c, 'mode_publish_flow', [f.actor, f.tenant, f.flow, v2 ? 2 : 1, randomUUID()]));
  const p = profile(); const a = addresses();
  const install = (mode: string) => transaction(db, c => rpc(c, 'mode_install_flow', [f.actor, f.tenant, f.flow, published.versionId, published.versionId, mode, p.profileVersion, JSON.stringify(mode === 'hosted' ? [] : [a.merchant, a.second].sort()), randomUUID()]));
  const hosted = await install('hosted'); const iframe = await install('iframe');
  return { f, hosted, iframe, published, v2 };
}
export type World = Awaited<ReturnType<typeof seed>>;
export async function updatePolicy(db: Pool, w: World, enabled: boolean, parents: string[], revision = 1) { return transaction(db, c => rpc(c, 'mode_update_flow_policy', [w.f.actor, w.f.tenant, w.f.flow, w.iframe.installationId, revision, enabled, JSON.stringify(parents), randomUUID()])); }
export async function advanceTarget(db: Pool, w: World) {
  const revision = w.v2 ? 2 : 1;
  await transaction(db, c => rpc(c, w.v2 ? 'save_configurable_flow_draft' : 'save_bound_flow_draft', [w.f.actor, w.f.tenant, w.f.flow, w.f.service, revision, 'Updated local document', JSON.stringify(w.v2 ? { authoringVersion: 2, config, questionOverrides: {} } : config)]));
  const next = await transaction(db, c => rpc(c, 'mode_publish_flow', [w.f.actor, w.f.tenant, w.f.flow, revision + 1, randomUUID()]));
  await transaction(db, c => rpc(c, 'mode_apply_flow_version', [w.f.actor, w.f.tenant, w.f.flow, w.iframe.installationId, 1, w.published.versionId, next.versionId, randomUUID()])); return next;
}
export const snapshot = (db: Pool, f: Fixture) => state(db, f);
export type TlsFixture = { key: Buffer; cert: Buffer; untrustedKey: Buffer; untrustedCert: Buffer; spki: string; untrustedSpki: string };
export async function loadTls(): Promise<TlsFixture> {
  const root = path.resolve('.cache/mode-document-tls'); const dir = path.resolve(process.env.MODE_DOCUMENT_TLS_DIR ?? '');
  assert.equal(path.dirname(dir), root);
  const { pathToFileURL } = await import('node:url');
  const helper = await import(pathToFileURL(path.resolve('scripts/mode-document-tls.mjs')).href);
  const checked = await helper.validateDocumentTls(process.cwd(), path.basename(dir));
  assert.deepEqual(checked.hosts, [...HOSTS]); assert.equal(checked.directory, dir);
  const [key, cert, untrustedKey, untrustedCert] = await Promise.all([checked.keyPath, checked.certPath, checked.untrustedKeyPath, checked.untrustedCertPath].map((file: string) => fs.readFile(file)));
  return { key: key!, cert: cert!, untrustedKey: untrustedKey!, untrustedCert: untrustedCert!, spki: checked.spki, untrustedSpki: checked.untrustedSpki };
}
const lookup: import('node:net').LookupFunction = (hostname, options, callback) => { if (!HOSTS.includes(hostname as typeof HOSTS[number])) { callback(Error('HOST_DENIED'), '', 4); return; } if (options.all) (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: '127.0.0.1', family: 4 }]); else callback(null, '127.0.0.1', 4); };
export type Wire = { status: number; headers: import('node:http').IncomingHttpHeaders; bytes: Buffer };
export async function wire(base: string, target: string, tlsFixture: TlsFixture, options: { method?: string; headers?: Record<string, string>; rawHeaders?: string[]; signal?: AbortSignal; servername?: string; ca?: Buffer; body?: string } = {}): Promise<Wire> {
  assert.ok(options.body===undefined||Buffer.byteLength(options.body)<=64);const u = new URL(base); assert.ok(Object.values(addresses()).includes(base)); assert.equal(u.protocol, 'https:');
  return new Promise((resolve, reject) => {
    let done = false; const chunks: Buffer[] = []; let size = 0;
    const finish = (error?: Error, result?: Wire) => { if (done) return; done = true; clearTimeout(timer); if (error) { const code = (error as NodeJS.ErrnoException).code ?? ''; const allowed = ['ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ECONNRESET','ECONNREFUSED','ABORT_ERR']; reject(Error('TLS_REQUEST_FAILED' + (allowed.includes(code) ? '_' + code : ''))); } else resolve(result!); };
    const req = https.request({ hostname: u.hostname, port: u.port, lookup, servername: options.servername ?? u.hostname, ca: options.ca ?? tlsFixture.cert, rejectUnauthorized: true, agent: false, path: target, method: options.method ?? 'GET', headers: options.rawHeaders ?? { Host: u.host, ...options.headers }, signal: options.signal }, res => {
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 262144) { req.destroy(); finish(Error()); } else chunks.push(chunk); });
      res.on('error', () => finish(Error())); res.on('end', () => finish(undefined, { status: res.statusCode!, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => { req.destroy(); finish(Error()); }, 7000); req.on('error', error => finish(error)); req.end(options.body);
  });
}
/** Per-request trust only; caller cannot redirect or choose an unknown upstream. */
export function policyFetch(t: TlsFixture, attempted: { reads: number; issuance: number }): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const expected = addresses().api + '/api/public/installation-policies/'; assert.ok(url.startsWith(expected)); assert.match(url.slice(expected.length), /^[0-9a-f-]{36}$/);
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.referrerPolicy, 'no-referrer'); assert.deepEqual([...new Headers(init?.headers)], [['accept', 'application/json']]); attempted.reads++;
    const out = await wire(addresses().api, new URL(url).pathname, t, { headers: { Accept: 'application/json' }, signal: init?.signal ?? undefined });
    const headers = new Headers(); for (const [name, value] of Object.entries(out.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    if (out.status >= 300 && out.status < 400) throw Error('UPSTREAM_REDIRECT_DENIED'); return new Response(out.bytes, { status: out.status, headers });
  };
}
export async function closeWithin(actions: Array<() => Promise<unknown>>) { let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([Promise.all(actions.map(fn => Promise.resolve().then(fn))), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('DOCUMENT_CLEANUP_TIMEOUT')), 10000); })]); } finally { clearTimeout(timer); } }
const sockets = new WeakMap<http.Server, Set<import('node:stream').Duplex>>();
export async function listen(server: http.Server, origin: string, enforceSni: boolean | readonly string[] = true) {
  const owned = new Set<import('node:stream').Duplex>(); sockets.set(server, owned);
  server.on('connection', socket => { owned.add(socket); socket.once('close', () => owned.delete(socket)); });
  server.on('secureConnection', (socket: tls.TLSSocket) => { const names=Array.isArray(enforceSni)?enforceSni:[new URL(origin).hostname];if(enforceSni&&!names.includes(socket.servername))socket.destroy(); });
  server.headersTimeout = 2000; server.requestTimeout = 2000; server.keepAliveTimeout = 1000;
  server.setTimeout(2000, socket => socket.destroy()); server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(new URL(origin).port), '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }); server.on('error', () => {});
}
export function closeServer(server: http.Server) { for (const socket of sockets.get(server) ?? []) socket.destroy(); server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }
export function rawTargetValid(req: import('node:http').IncomingMessage, origin: string) {
  const target = req.url ?? ''; const host = new URL(origin).host; const raw = req.rawHeaders; const counts = new Map<string, number>();
  for (let i = 0; i < raw.length; i += 2) counts.set(raw[i]!.toLowerCase(), (counts.get(raw[i]!.toLowerCase()) ?? 0) + 1);
  return target.length <= 256 && target.startsWith('/') && /^[\x20-\x7e]+$/.test(target) && !/[?#%\\]/.test(target) && !target.includes('//') && !target.split('/').some(x => x === '.' || x === '..') && counts.get('host') === 1 && req.headers.host === host && !counts.has('authorization') && !counts.has('cookie') && !counts.has('transfer-encoding') && (!counts.has('content-length') || (counts.get('content-length') === 1 && req.headers['content-length'] === '0'));
}
export async function startWorld(t: TlsFixture) {
  const assets = await runtimeAssets(); const pages = new Map<string, string>(); const downloads = new Set<string>(); const a = addresses(); const p = profile(); const queries: string[] = []; const attempted = { reads: 0, issuance: 0 }; const owned: http.Server[] = [];
  const deniedMerchantOrigins={wrongPort:'https://merchant.mode.test:'+new URL(a.second).port,lookalike:'https://merchant.mode.test.forbidden.mode.test:'+new URL(a.forbidden).port,wrongScheme:''};
  const wirePrivacy = Object.fromEntries(['policy','asset','document','merchant','download','other'].map(role=>[role,{requests:0,referrer:0,worker:0,method:0,body:0,query:0,auth:0,cookie:0,controlQuery:0,controlQueryRejected:0}])) as Record<'policy'|'asset'|'document'|'merchant'|'download'|'other',{requests:number;referrer:number;worker:number;method:number;body:number;query:number;auth:number;cookie:number;controlQuery:number;controlQueryRejected:number}>;
  let wireOverflow=false;
  const activePids=new Set<number>();const backend={active:0,peak:0,started:0,finished:0,get activePids(){return [...activePids];}};
  let assetFault:'none'|'wrong-mime'|'redirect'|'redirect-same-bytes'='none';
  const assetControl={redirectResponses:0,sameBytesDestinationHits:0,missingDestinationHits:0};
  const controllerPath='/assets/booking-lumin-controller.'+assets.controllerSha256+'.js';
  let controllerBytes:Buffer;try{controllerBytes=await fs.readFile(path.join(process.env.MODE_RUNTIME_ASSET_DIR!,controllerPath.slice('/assets/'.length)));assert.ok(controllerBytes.length<=262144);assert.equal(createHash('sha256').update(controllerBytes).digest('hex'),assets.controllerSha256);}catch{assets.close();throw Error('CONTROLLER_FIXTURE_BYTES_DENIED');}
  const observeWire=(role:keyof typeof wirePrivacy,req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse)=>{
    const entry=wirePrivacy[role];if(entry.requests>=4096){wireOverflow=true;return;}entry.requests++;
    const has=(name:string)=>req.rawHeaders.some((value,i)=>i%2===0&&value.toLowerCase()===name);
    if(has('referer'))entry.referrer++;if(has('authorization'))entry.auth++;if(has('cookie'))entry.cookie++;
    if(!['GET','HEAD'].includes(req.method??''))entry.method++;
    if(has('transfer-encoding')||(has('content-length')&&req.headers['content-length']!=='0'))entry.body++;
    const target=req.url??'';
    if(target.includes('?')){
      const parsed=new URL(target,a.renderer);const names=[...parsed.searchParams.keys()];const inner=parsed.searchParams.get('frame');
      const frame=role==='merchant'&&parsed.pathname==='/frame'&&names.length===(parsed.searchParams.has('sandbox')?2:1)&&names.every(x=>x==='frame'||x==='sandbox')&&(!parsed.searchParams.has('sandbox')||parsed.searchParams.get('sandbox')==='null')&&inner!==null&&[...Object.values(a),...Object.values(deniedMerchantOrigins)].some(base=>base&&inner.startsWith(base+'/'));
      const control=role==='asset'&&target===controllerPath+'?x=1';
      if(control){entry.controlQuery++;res.once('finish',()=>{if(res.statusCode===400)entry.controlQueryRejected++;else entry.query++;});}
      else if(!frame)entry.query++;
    }
    if(req.headers['sec-fetch-dest']==='serviceworker'||req.headers['sec-fetch-dest']==='worker')entry.worker++;
  };
  let composition: ReturnType<typeof __createLocalModePolicyCompositionForTests> | undefined;
  let api: ReturnType<typeof createModePolicyHttpHandler> | undefined;
  let document: ReturnType<typeof createModeDocumentHandler> | undefined;
  const close = () => closeWithin([() => Promise.resolve(assets.close()), ...(api ? [() => api!.close()] : []), ...(document ? [() => document!.close()] : []), ...(composition ? [() => composition!.close()] : []), ...owned.map(s => () => closeServer(s))]);
  try {
  composition = __createLocalModePolicyCompositionForTests({ profiles: [p] }, { env: { ...process.env }, poolFactory: (config: PoolConfig) => {
    const pool = new Pool(config); pool.on('error', () => {}); return { connect: async () => { const c = await pool.connect(); return { query: (sql: string, values?: unknown[]) => { if (queries.length >= 4096) throw Error('QUERY_OBSERVER_BOUND'); queries.push(sql); if(sql!=='SELECT public.mode_public_installation_policy($1::uuid) AS result')return c.query(sql,values);const pid=(c as unknown as {processID:number}).processID;assert.ok(Number.isSafeInteger(pid));backend.active++;backend.started++;backend.peak=Math.max(backend.peak,backend.active);activePids.add(pid);return Promise.resolve().then(()=>c.query(sql,values)).finally(()=>{backend.active--;backend.finished++;activePids.delete(pid);}); }, release: c.release.bind(c), on: c.on.bind(c), removeListener: c.removeListener.bind(c) }; }, end: () => pool.end(), on: pool.on.bind(pool), removeListener: pool.removeListener.bind(pool) };
  } });
  api = createModePolicyHttpHandler({ reader: composition.reader, profiles: [p] }); document = createModeDocumentHandler({ profiles: [p], fetch: policyFetch(t, attempted), runtime: { controllerSha256: assets.controllerSha256 } });

    const A = https.createServer({ key: t.key, cert: t.cert, maxHeaderSize: 8192 }, (req, res) => { observeWire('policy',req,res); if (/session|submit|booking|request/.test(req.url ?? '')) attempted.issuance++; api!.handle(req, res); }); owned.push(A); await listen(A, a.api);
    const R = https.createServer({ key: t.key, cert: t.cert, maxHeaderSize: 8192 }, async (req, res) => {
      observeWire((req.url ?? '').startsWith('/assets/')?'asset':'document',req,res);
      if ((req.url ?? '').startsWith('/assets/')) {if(req.url==='/assets/fixture-missing.js')assetControl.missingDestinationHits++;if(req.url==='/assets/fixture-identical-controller.js'&&assetFault==='redirect-same-bytes'&&rawTargetValid(req,a.renderer)&&(req.method==='GET'||req.method==='HEAD')){assetControl.sameBytesDestinationHits++;res.writeHead(200,{'Content-Type':'application/javascript','Content-Length':controllerBytes.length,'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:controllerBytes);return;} if(req.url===controllerPath&&assetFault!=='none'&&rawTargetValid(req,a.renderer)&&(req.method==='GET'||req.method==='HEAD')){res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Access-Control-Allow-Origin','*');if(assetFault==='redirect'||assetFault==='redirect-same-bytes'){assetControl.redirectResponses++;res.writeHead(302,{Location:a.renderer+(assetFault==='redirect'?'/assets/fixture-missing.js':'/assets/fixture-identical-controller.js')});res.end();}else{res.writeHead(200,{'Content-Type':'text/plain','Content-Length':controllerBytes.length});res.end(req.method==='HEAD'?undefined:controllerBytes);}return;}assets.handle(req, res); return; }
      const abort = new AbortController(); res.on('close', () => { if (!res.writableFinished) abort.abort(); });
      try {
        if (!rawTargetValid(req, a.renderer)) { const denied = await document!.handle(new Request(a.renderer + '/checkout/flow/invalid', { method: req.method === 'HEAD' ? 'HEAD' : 'GET' })); res.writeHead(400, Object.fromEntries(denied.headers)); res.end(Buffer.from(await denied.arrayBuffer())); return; }
        const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const out = await document!.handle(new Request(a.renderer + req.url, { method: req.method, headers, signal: abort.signal })); if (res.destroyed) return;
        res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
      } catch { if (!res.destroyed) { res.writeHead(503); res.end(); } }
    }); owned.push(R); await listen(R, a.renderer);
    const merchantHandler=(origin:string,allowedOrigins:readonly string[]):http.RequestListener=>(req,res)=>{
        if(!allowedOrigins.some(value=>new URL(value).host===req.headers.host)){observeWire('other',req,res);res.writeHead(400);res.end();return;}
        observeWire(downloads.has(req.url ?? '')?'download':'merchant',req,res);
        if(downloads.has(req.url ?? '')){res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename=runtime-denied.txt','Cache-Control':'no-store'});res.end('Public download denial fixture');return;}
        const fixedPage = pages.get(req.url ?? ''); if (fixedPage !== undefined) { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(fixedPage); return; }
        const u = new URL(req.url ?? '/', origin); const inner = u.searchParams.get('frame');
        if (u.pathname !== '/frame' || !inner || !Object.values(a).some(base => inner.startsWith(base + '/'))) { res.writeHead(404); res.end('FIXTURE_STATIC_DENIED'); return; }
        const escaped = inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end('<!doctype html><title>Local parent</title><main><h1>Local parent fixture</h1><iframe title="Document frame" style="width:100%;height:600px" '+(u.searchParams.get('sandbox')==='null'?'sandbox="allow-scripts" ':'')+'src="' + escaped + '"></iframe></main>');
    };
    for(const origin of [a.portal,a.merchant,a.second,a.forbidden]){const extra=origin===a.second?[deniedMerchantOrigins.wrongPort]:origin===a.forbidden?[deniedMerchantOrigins.lookalike]:[];const allowed=[origin,...extra];const server=https.createServer({key:t.key,cert:t.cert},merchantHandler(origin,allowed));owned.push(server);await listen(server,origin,allowed.map(value=>new URL(value).hostname));}
    const plain=http.createServer((req,res)=>merchantHandler(deniedMerchantOrigins.wrongScheme,[deniedMerchantOrigins.wrongScheme])(req,res));owned.push(plain);await listen(plain,'http://merchant.mode.test:0',false);const plainAddress=plain.address();assert.ok(plainAddress&&typeof plainAddress!=='string');deniedMerchantOrigins.wrongScheme='http://merchant.mode.test:'+plainAddress.port;
    const untrusted = https.createServer({ key: t.untrustedKey, cert: t.untrustedCert }, (req, res) => { observeWire('other',req,res); res.end('UNPINNED_KEY_MARKER'); }); owned.push(untrusted); await listen(untrusted, a.untrusted, false);
    return { assetControl, backend, setAssetFault(value:'none'|'wrong-mime'|'redirect'|'redirect-same-bytes'){assert.ok(['none','wrong-mime','redirect','redirect-same-bytes'].includes(value));assetFault=value;}, addresses: a, deniedMerchantOrigins, observedOrigins:Object.freeze([...Object.values(a),...Object.values(deniedMerchantOrigins)]), queries, attempted, close, assets, wirePrivacy, wireHealthy:()=>!wireOverflow,
      registerDownload(){assert.ok(downloads.size<1);const route='/download-fixture';downloads.add(route);return route;},
      registerPage(html: string) {
        assert.ok(pages.size < 64 && Buffer.byteLength(html) <= 65536);
        const route = '/fixture/' + pages.size; pages.set(route, '<!doctype html><meta charset="utf-8"><title>Local runtime fixture</title><body>' + html + '</body>'); return route;
      },
      async snippet(w: World) {
        const out = await wire(a.api, '/api/public/installation-policies/' + w.iframe.installationId, t); assert.equal(out.status, 200);
        const rendered = createInstallationContracts([p]).composeInstall(JSON.parse(out.bytes.toString('utf8')));
        assert.equal(rendered.kind, 'iframe_loader'); if (rendered.kind !== 'iframe_loader') throw Error('RUNTIME_SNIPPET_REQUIRED'); return rendered.html;
      }
    };
  } catch { await close(); throw Error('DOCUMENT_WORLD_START_FAILED'); }
}






export function assertNativeNoReferrer(observations: Record<string,{referrer:number}>) {
  for(const value of Object.values(observations)) if(value.referrer!==0)throw Error('RUNTIME_NATIVE_REFERRER_DETECTED');
}

export async function holdPolicyTable(db:Pool){
  const client=await db.connect();let released=false;
  try{await client.query('BEGIN');await client.query("SET LOCAL idle_in_transaction_session_timeout = '10000ms'");await client.query("SET LOCAL lock_timeout = '3000ms'");await client.query('LOCK TABLE public.mode_flow_installations IN ACCESS EXCLUSIVE MODE');const pid=(client as unknown as {processID:number}).processID;return{pid,async release(){if(released)return;released=true;try{await client.query('ROLLBACK');}finally{client.release();}}};}catch{client.release(true);throw Error('POLICY_HOLDER_FAILED');}
}
export async function blockedPolicyPids(db:Pool,local:Awaited<ReturnType<typeof startWorld>>,holderPid:number){
  const pids=local.backend.activePids;assert.ok(pids.length<=2);if(!pids.length)return[];const out=await db.query('SELECT pid FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND $2::int = ANY(pg_blocking_pids(pid)) ORDER BY pid',[pids,holderPid]);return out.rows.map(row=>Number(row.pid));
}

export function assertNativePrivacy(observations:Record<string,{method:number;body:number;query:number;auth:number;cookie:number;controlQuery:number;controlQueryRejected:number}>){for(const value of Object.values(observations)){for(const field of ['method','body','query','auth','cookie'] as const)if(value[field]!==0)throw Error('RUNTIME_NATIVE_'+field.toUpperCase()+'_DETECTED');if(value.controlQuery>1||value.controlQuery!==value.controlQueryRejected)throw Error('RUNTIME_NATIVE_CONTROL_QUERY_FAILED');}}
export function assertPolicyQueries(queries:readonly string[]){const allowed=new Set(['BEGIN ISOLATION LEVEL READ COMMITTED',"SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'",'SET LOCAL ROLE service_role','SELECT public.mode_public_installation_policy($1::uuid) AS result','SET CONSTRAINTS ALL IMMEDIATE','COMMIT']);if(queries.length>4096||queries.some(sql=>!allowed.has(sql)))throw Error('RUNTIME_SQL_ALLOWLIST_FAILED');}

import {__createModeSessionRepositoryForTests} from './mode-session-repository.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { Pool, type PoolConfig } from 'pg';
import { fixture, profile, config, transaction, type Fixture } from './mode-installations-fixtures.js';
export { profile, config, transaction, type Fixture };
export const id = () => randomUUID();
export function ownerPoolConfig(): PoolConfig {
    for (const name of ['LOCAL_HARNESS', 'FLOW_TEST_DISPOSABLE', 'MODE_INSTALLATIONS_TEST_DISPOSABLE', 'MODE_SESSIONS_TEST_DISPOSABLE', 'MODE_OWNER_TEST_DISPOSABLE'])
        assert.equal(process.env[name], '1');
    for (const name of ['DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'])
        assert.equal(process.env[name] ?? '', '');
    assert.ok(['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? ''));
    assert.ok(['5432', '55439'].includes(process.env.PGPORT ?? ''));
    assert.equal(process.env.PGUSER, 'postgres');
    assert.match(process.env.PGDATABASE ?? '', /^lumin_mode_owner_journey_[a-z0-9_]+$/);
    assert.ok(process.env.PGDATABASE!.length <= 63);
    assert.ok(['public', 'extensions'].includes(process.env.MODE_OWNER_CRYPTO_LAYOUT ?? ''));
    const password = process.env.PGPASSWORD ?? '';
    assert.ok(['', 'postgres'].includes(password));
    return { host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.PGDATABASE, password: () => password, ssl: false, pipeline: false, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, application_name: 'independent-mode-owner-observer' };
}
export function endpoints() {
    const port = (name: string) => { const value = process.env[name] ?? ''; assert.match(value, /^[1-9][0-9]{3,4}$/); const n = Number(value); assert.ok(n >= 1024 && n <= 65535); return n; };
    const owner = port('MODE_OWNER_API_PORT'), draft = port('MODE_OWNER_DRAFT_PORT'), portal = port('MODE_OWNER_PORTAL_PORT');
    assert.equal(new Set([owner, draft, portal]).size, 3);
    return { owner: `http://127.0.0.1:${owner}`, draft: `http://127.0.0.1:${draft}`, portal: `http://127.0.0.1:${portal}` };
}
export async function observer() {
    const db = new Pool(ownerPoolConfig());
    db.on('error', () => { });
    try {
        const row = (await db.query("select current_database() db,current_user usr,(select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto') crypto,to_regprocedure('public.mode_owner_request_history(uuid,uuid,uuid,timestamp with time zone,uuid,integer)')::text rpc")).rows[0];
        assert.equal(row.db, process.env.PGDATABASE);
        assert.equal(row.usr, 'postgres');
        assert.equal(row.crypto, process.env.MODE_OWNER_CRYPTO_LAYOUT);
        assert.ok(row.rpc);
        const profiles = (await db.query('select * from lumin.installation_profiles where version=$1', [profile.profileVersion])).rows;
        if (!profiles.length)
            await db.query('insert into lumin.installation_profiles(version,renderer_origin,api_origin,portal_origin,loader_sha256) values($1,$2,$3,$4,$5)', [profile.profileVersion, profile.rendererOrigin, profile.apiOrigin, profile.portalOrigin, 'a'.repeat(64)]);
        const p = (await db.query('select * from lumin.installation_profiles where version=$1', [profile.profileVersion])).rows[0];
        assert.equal(p.renderer_origin, profile.rendererOrigin);
        assert.equal(p.api_origin, profile.apiOrigin);
        assert.equal(p.portal_origin, profile.portalOrigin);
        assert.equal(p.loader_sha256, 'a'.repeat(64));
        return db;
    }
    catch (e) {
        await boundedClose(() => db.end());
        throw e;
    }
}
export async function world(db: Pool, v2 = false) {
    const f = await fixture(db);
    if (v2)
        await transaction(db, c => c.query('select public.save_configurable_flow_draft($1,$2,$3,$4,1,$5,$6)', [f.actor, f.tenant, f.flow, f.service, 'Configurable owner fixture', JSON.stringify({ authoringVersion: 2, config, questionOverrides: {} })]));
    const credentials = [f.actor, f.owner2, f.staff, f.foreignActor].map(userId => ({ userId, credential: randomBytes(24).toString('base64url') }));
    return { f, v2, revision: v2 ? 2 : 1, credentials, credential: credentials[0]!.credential };
}
export type World = Awaited<ReturnType<typeof world>>;
export type Wire = {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: any;
    bytes: number;
};
export async function wire(base: string, path: string, options: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    rawHeaders?: string[];
    timeout?: number;
} = {}): Promise<Wire> {
    const url = new URL(base);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
    const body = options.rawBody ?? (options.body === undefined ? '' : JSON.stringify(options.body));
    const headers = options.rawHeaders ?? { Host: url.host, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } : {}), ...options.headers };
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (err: Error | undefined, value?: Wire) => { if (done)
            return; done = true; clearTimeout(timer); if (err)
            reject(Error('CONTROLLED_HTTP_FAILURE'));
        else
            resolve(value!); };
        const req = http.request({ hostname: url.hostname, port: url.port, path, method: options.method ?? 'POST', headers, agent: false }, res => { const chunks: Buffer[] = []; let count = 0; res.on('data', (part: Buffer) => { count += part.length; if (count > 1048576) {
            req.destroy();
            finish(Error('body bound'));
            return;
        } chunks.push(part); }); res.on('error', () => finish(Error('response'))); res.on('end', () => { try {
            const text = Buffer.concat(chunks).toString('utf8');
            finish(undefined, { status: res.statusCode!, headers: res.headers, body: text ? JSON.parse(text) : null, bytes: count });
        }
        catch {
            finish(Error('invalid response'));
        } }); });
        const timer = setTimeout(() => { req.destroy(); finish(Error('timeout')); }, options.timeout ?? 17000);
        req.on('error', () => finish(Error('request')));
        req.end(body);
    });
}
export const ownerHeaders = (credential: string) => ({ Origin: endpoints().portal, Authorization: `Bearer ${credential}` });
export const call = (base: string, path: string, credential: string, body: unknown) => wire(base, '/api/local/mode-owner/' + path, { body, headers: ownerHeaders(credential) });
export function outcome(reply: Wire) { assert.equal(reply.headers['cache-control'], 'no-store'); assert.equal(reply.headers['x-content-type-options'], 'nosniff'); assert.equal(reply.body.schemaVersion, 1); assert.equal(reply.body.phase, 'repository_result'); return reply.body.outcome; }
export function committed(reply: Wire) { assert.equal(reply.status, 200); const o = outcome(reply); assert.equal(o.kind, 'committed'); assert.equal(o.delivery, 'receipt'); return o.receipt; }
export function completed(reply: Wire) { assert.equal(reply.status, 200); const o = outcome(reply); assert.equal(o.kind, 'completed'); assert.equal(o.delivery, 'data'); return o.data; }
export function failure(reply: Wire, code: string) { assert.equal(reply.status,({CONFLICT:409,FORBIDDEN:403,UNAVAILABLE:404,INTERNAL_ERROR:500} as Record<string,number>)[code]); const o = outcome(reply); assert.equal(o.kind, 'failed'); assert.equal(o.code, code); return o; }
export async function state(db:Pool,f:Fixture){
 const result:Record<string,unknown>={};
 for(const table of ['flows','flow_drafts','flow_versions','bound_flow_versions','flow_installations','flow_sessions','durable_outbox','mode_flow_installations','mode_flow_owner_operations','mode_flow_installation_history','mode_flow_sessions','mode_flow_requests','bookings','customers','payments','capacity_holds'])result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from public.${table} t where tenant_id=$1`,[f.tenant])).rows[0].rows;
 result.flow_requests=(await db.query("select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') rows from public.flow_requests r join public.flow_sessions s on s.id=r.session_id where s.tenant_id=$1",[f.tenant])).rows[0].rows;
 result.booking_state_history=(await db.query("select coalesce(jsonb_agg(to_jsonb(h) order by to_jsonb(h)::text),'[]') rows from public.booking_state_history h join public.bookings b on b.id=h.booking_id where b.tenant_id=$1",[f.tenant])).rows[0].rows;return result;
}
export async function waitFor(check: () => Promise<boolean>, label: string, ms = 5000) { const end = performance.now() + ms; while (performance.now() < end) {
    if (await check())
        return;
    await new Promise(r => setTimeout(r, 20));
} throw Error('OBSERVATION_TIMEOUT_' + label); }
export async function boundedClose(close: () => Promise<unknown>) { let timer: ReturnType<typeof setTimeout> | undefined; try {
    await Promise.race([close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('OWNED_CLEANUP_TIMEOUT')), 11000); })]);
}
finally {
    clearTimeout(timer);
} }
export function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
export async function ready<T>(signal: Promise<T>, label: string): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try {
    return await Promise.race([signal, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('PHASE_TIMEOUT_' + label)), 4000); })]);
}
finally {
    clearTimeout(timer);
} }
export async function observeOwnerWait(db: Pool, holder: number) { let waiter = 0; await waitFor(async () => { const rows = (await db.query("select pid from pg_stat_activity where application_name='mode-owner-installations-local' and wait_event_type='Lock' and $1=any(pg_blocking_pids(pid))", [holder])).rows; if (rows.length === 1) {
    waiter = rows[0].pid;
    return true;
} return false; }, 'owner_sql_wait', 3000); assert.ok(waiter > 0); process.stdout.write('PASS owner-http-observed-lock-wait\n'); return waiter; }
/** Owns an actual loopback request; a dropped connection is an observation, never a rollback claim. */
export function disconnectable(base:string,path:string,body:unknown,headers:Record<string,string>){const url=new URL(base),encoded=JSON.stringify(body);let responseSeen=false;const req=http.request({hostname:url.hostname,port:url.port,path,method:'POST',headers:{Host:url.host,'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(encoded)),...headers},agent:false});const timer=setTimeout(()=>req.destroy(),10000);const terminal=new Promise<void>(resolve=>{req.on('response',res=>{responseSeen=true;res.resume();});req.on('error',()=>{});req.once('close',()=>{clearTimeout(timer);resolve();});});req.end(encoded);return {drop:()=>req.destroy(),terminal,sawResponse:()=>responseSeen};}
/** Truncate a genuine upstream committed JSON response after a real prefix reaches the caller. */
export async function truncatedReply(base: string, path: string, body: unknown, headers: Record<string, string>) { const url = new URL(base),owned=new Set<http.ClientRequest>(); let status = 0, partial = 0, upstreamComplete = false; const server = http.createServer((_request, response) => { const encoded = JSON.stringify(body); const upstream = http.request({ hostname: url.hostname, port: url.port, path, method: 'POST', headers: { Host: url.host, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(encoded)), ...headers }, agent: false }, res => { status = res.statusCode!; const chunks: Buffer[] = []; let size = 0; res.on('data', (b: Buffer) => { size += b.length; if (size > 1048576) {
    upstream.destroy();
    response.destroy();
}
else
    chunks.push(b); }); res.on('end', () => { upstreamComplete = true; const payload = Buffer.concat(chunks); assert.ok(payload.length > 20); response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }); response.write(payload.subarray(0, 20), () => setTimeout(() => response.destroy(), 20)); }); }); owned.add(upstream);upstream.once('close',()=>owned.delete(upstream));upstream.on('error', () => response.destroy()); upstream.end(encoded); }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); try {
    const port = (server.address() as any).port;
    await ready(new Promise<void>((resolve, reject) => { const req = http.get({ host: '127.0.0.1', port, agent: false }, res => { res.on('data', (b: Buffer) => partial += b.length); res.on('aborted', resolve); res.on('error', () => { }); res.on('end', () => reject(Error('EXPECTED_TRUNCATION'))); }); owned.add(req);req.once('close',()=>owned.delete(req));req.on('error', reject); }), 'truncated_json');
    assert.equal(status, 200);
    assert.equal(upstreamComplete, true);
    assert.equal(partial, 20);
}
finally {
    for(const request of owned)request.destroy();
    server.closeAllConnections();
    let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([new Promise<void>(resolve=>server.close(()=>resolve())),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('PROXY_CLOSE_TIMEOUT')),10000);})]);}finally{clearTimeout(timer);}
} }

/** Actual S2 RPC fixture followed by explicit trusted state progression; no secrets leave this helper. */
export async function seedOwnerRequests(db:Pool,w:World,publishedVersionId:string,installationId:string){
 const repository=__createModeSessionRepositoryForTests({pool:new Pool({...ownerPoolConfig(),max:2}),profiles:[profile]});
 try{
  for(let i=0;i<2;i++){
   const issued:any=await repository.issue({installationId,deploymentProfileVersion:profile.profileVersion,rendererOrigin:profile.rendererOrigin,parentOrigin:null,expectedVersionId:publishedVersionId,expectedTargetRevision:1,expectedPolicyRevision:1});assert.equal(issued.kind,'committed');assert.equal(issued.delivery,'session');
   const accepted:any=await repository.submit(issued.session,{token:issued.token,idempotencyKey:id(),answers:{count:{quantity:2}},customer:{name:'Synthetic history',email:'summary@example.test'},requestedStart:new Date(Date.now()+3600000+i*60000).toISOString().replace('Z','000Z')});assert.equal(accepted.kind,'committed');assert.equal(accepted.delivery,'receipt');
  }
  await transaction(db,async c=>{await c.query('alter table public.bookings disable trigger user');const rows=(await c.query('select id from public.bookings where tenant_id=$1 order by id',[w.f.tenant])).rows;assert.equal(rows.length,2);for(let i=0;i<rows.length;i++)await c.query('update public.bookings set state=$1,created_at=$2 where id=$3',[i===0?'completed':'cancelled','2026-09-10T12:00:00.123456Z',rows[i].id]);await c.query('alter table public.bookings enable trigger user');},'owner');
  return (await db.query(`select id as "bookingId",reference,state,to_char(slot_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "slotStart",to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt" from public.bookings where tenant_id=$1 order by created_at desc,id desc`,[w.f.tenant])).rows;
 }finally{await boundedClose(()=>repository.close());}
}

/** Independent loopback-only fixtures; no hosted identity, profile or provider activation. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import net from 'node:net';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
export { prepared, snapshot, expiry, holder, profile, transaction, key } from './mode-flow-session-fixtures.js';
export { apply, policy, secondVersion, fixture, publish, install } from './mode-installations-fixtures.js';
import { profile, type Prepared } from './mode-flow-session-fixtures.js';
export type { Prepared };
export function config(): PoolConfig {
    assert.equal(process.env.LOCAL_HARNESS, '1');
    assert.equal(process.env.FLOW_TEST_DISPOSABLE, '1');
    assert.equal(process.env.MODE_SESSIONS_TEST_DISPOSABLE, '1');
    assert.ok(['public', 'extensions'].includes(process.env.MODE_SESSION_TRANSPORT_CRYPTO_LAYOUT ?? ''));
    assert.ok(['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? ''));
    assert.match(process.env.PGPORT ?? '', /^[1-9][0-9]{0,4}$/);
    assert.ok(Number(process.env.PGPORT) <= 65535);
    assert.equal(process.env.PGUSER, 'postgres');
    assert.match(process.env.PGDATABASE ?? '', /^lumin_mode_session_transport_[a-z0-9_]+$/);
    assert.ok(process.env.PGDATABASE!.length <= 63);
    const password = process.env.PGPASSWORD ?? '';
    assert.ok(password === '' || password === 'postgres');
    for (const name of ['DATABASE_URL', 'PGHOSTADDR', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS'])
        assert.equal(process.env[name] ?? '', '');
    return { host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.PGDATABASE, password: () => password, ssl: false, pipeline: false, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, query_timeout: 0, application_name: 'independent-mode-session-transport' };
}
export const pool = () => new Pool(config());
export async function setup(p: Pool) {
    assert.equal((await p.query("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'")).rows[0].nspname, process.env.MODE_SESSION_TRANSPORT_CRYPTO_LAYOUT);
    assert.equal((await p.query("select to_regprocedure('public.mode_submit_flow_request(text,text,text,text,jsonb,jsonb,timestamp with time zone)') is not null ok")).rows[0].ok, true);
    const row = { version: profile.profileVersion, renderer_origin: profile.rendererOrigin, api_origin: profile.apiOrigin, portal_origin: profile.portalOrigin, loader_sha256: 'a'.repeat(64) };
    await p.query('insert into lumin.installation_profiles(version,renderer_origin,api_origin,portal_origin,loader_sha256) values($1,$2,$3,$4,$5) on conflict do nothing', Object.values(row));
    assert.deepEqual((await p.query('select version,renderer_origin,api_origin,portal_origin,loader_sha256 from lumin.installation_profiles where version=$1', [profile.profileVersion])).rows[0], row);
}
export const issueRequest = (p: Prepared) => ({ installationId: p.installed.installationId, deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: p.installed.mode === 'hosted' ? null : 'https://merchant.example.test', expectedVersionId: p.published.versionId, expectedTargetRevision: p.installed.targetRevision, expectedPolicyRevision: p.installed.policyRevision });
export const future = () => new Date(Date.now() + 3600000).toISOString().replace(/Z$/, '000Z');
export const request = (token: string) => ({ token, idempotencyKey: randomUUID(), answers: { count: { quantity: 2 } }, customer: { name: 'Customer', email: 'customer@example.test' }, requestedStart: future() });
export const actor = (p: Prepared) => ({ mode: 'local_synthetic' as const, userId: p.f.actor });
export const ownerRequest = (p: Prepared) => ({ tenantId: p.f.tenant, flowId: p.f.flow, beforeCreatedAt: null, beforeBookingId: null, limit: 100 });
export const tokenHash = (token: string) => createHash('sha256').update('mode-flow-session:v1:' + token).digest('hex');
export const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export async function observe(check: () => Promise<boolean>, label: string, ms = 8000) {
    const end = performance.now() + ms;
    do {
        if (await check())
            return;
        await pause(15);
    } while (performance.now() < end);
    throw Error('Observation failed: ' + label);
}
export const pid = (c: PoolClient) => {
    const p = (c as unknown as {
        processID: number;
    }).processID;
    assert.ok(Number.isInteger(p) && p > 0);
    return p;
};
export async function gone(p: Pool, id: number) { await observe(async () => !(await p.query('select exists(select 1 from pg_stat_activity where pid=$1) ok', [id])).rows[0].ok, 'discarded backend disappeared', 9000); }
export async function blocked(p: Pool, id: number, by: number) { await observe(async () => (await p.query("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid))) ok", [id, by])).rows[0].ok, 'actual lock blocker'); console.log(`OBSERVED LOCK waiter=${id} holder=${by}`); }
export function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; }
export async function phase(ready: Promise<void>, outcome: Promise<unknown>, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([ready, outcome.then(v => { throw Error(label + ' settled before readiness; kind=' + (v as {
                kind?: string;
            })?.kind); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label + ' readiness deadline')), 4000); })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/** Drop only the first actual selected PostgreSQL completion + ReadyForQuery frames. */
export async function lossProxy(tag: 'COMMIT' | 'ROLLBACK', initiallyArmed = true) {
    const sockets = new Set<net.Socket>();
    let armed = initiallyArmed, sawTag = false, sawReady = false;
    const errors: Error[] = [];
    const server = net.createServer(front => {
        const back = net.connect({ host: config().host, port: config().port! });
        sockets.add(front);
        sockets.add(back);
        let pending = Buffer.alloc(0), dropping = false;
        const close = () => { front.destroy(); back.destroy(); };
        const socketError = (e: Error) => {
            if (!dropping)
                errors.push(e);
            close();
        };
        front.on('error', socketError);
        back.on('error', socketError);
        front.on('close', () => { sockets.delete(front); back.destroy(); });
        back.on('close', () => { sockets.delete(back); front.destroy(); });
        front.on('data', b => back.write(b));
        back.on('data', b => {
            try {
                assert.ok(pending.length + b.length <= 2097162, 'bounded protocol receive buffer');
                pending = Buffer.concat([pending, b]);
                while (pending.length >= 5) {
                    const length = pending.readInt32BE(1);
                    assert.ok(length >= 4 && length <= 1048576);
                    if (pending.length < length + 1)
                        return;
                    const frame = pending.subarray(0, length + 1);
                    pending = pending.subarray(length + 1);
                    if (armed && frame[0] === 67 && frame.subarray(5).toString('utf8') === tag + '\0') {
                        armed = false;
                        sawTag = true;
                        dropping = true;
                    }
                    if (dropping) {
                        if (frame[0] === 90) {
                            sawReady = true;
                            close();
                        }
                        continue;
                    }
                    front.write(frame);
                }
            }
            catch (error) {
                errors.push(error as Error);
                close();
            }
        });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { arm() { armed = true; }, port: (server.address() as net.AddressInfo).port, get sawTag() { return sawTag; }, get sawReady() { return sawReady; }, errors, async close() {
            for (const s of sockets)
                s.destroy();
            await new Promise<void>(r => server.close(() => r()));
        } };
}

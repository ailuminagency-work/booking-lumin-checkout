/** Independent real-driver transport acceptance. Synthetic local authority only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Client, Pool, type PoolClient } from 'pg';
import { fault } from './mode-flow-session-fixtures.js';
import { commitFixture } from './mode-installation-transport-fixtures.js';
import { createLocalModeSessionRepository, __createModeSessionRepositoryForTests as create } from './mode-session-repository.js';
import { config, pool, setup, prepared, snapshot, expiry, holder, profile, transaction, key, apply, policy, secondVersion, fixture, publish, install, issueRequest, request, actor, ownerRequest, tokenHash, observe, pause, pid, gone, blocked, deferred, phase, lossProxy, type Prepared } from './mode-session-transport-fixtures.js';
type Hook = (c: PoolClient, text: string, values: unknown[] | undefined, run: () => Promise<any>) => Promise<any>;
type Clock = {
    monotonic(): number;
    wall(): number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
};
type Entry = {
    pid: number;
    commands: string[];
    values: unknown[][];
    releases: boolean[];
};
function tracked(real: Pool, hook?: Hook, clock?: Clock, afterAcquire?: () => Promise<void>) {
    const records: Entry[] = [];
    const attempts: Array<{
        state: 'pending' | 'rejected' | 'returned';
        record?: Entry;
    }> = [];
    const facade = { async connect() {
            const attempt: {
                state: 'pending' | 'rejected' | 'returned';
                record?: Entry;
            } = { state: 'pending' };
            attempts.push(attempt);
            let c: PoolClient;
            try {
                c = await real.connect();
            }
            catch (error) {
                attempt.state = 'rejected';
                throw error;
            }
            const record: Entry = { pid: pid(c), commands: [], values: [], releases: [] };
            records.push(record);
            attempt.record = record;
            if (afterAcquire)
                await afterAcquire();
            attempt.state = 'returned';
            return { query(text: string, values?: unknown[]) {
                    record.commands.push(text);
                    if (values)
                        record.values.push(values);
                    const run = () => c.query(text, values);
                    return hook ? hook(c, text, values, run) : run();
                }, release(error?: Error) { record.releases.push(Boolean(error)); c.release(error); }, on(name: string, fn: any) { c.on(name as 'error' | 'end', fn); return this; }, removeListener(name: string, fn: any) { c.removeListener(name as 'error' | 'end', fn); return this; } };
        }, end: () => real.end(), on(name: string, fn: any) { real.on(name as 'error', fn); return this; }, removeListener(name: string, fn: any) { real.removeListener(name as 'error', fn); return this; } };
    return { repository: create({ pool: facade, profiles: [profile], ...(clock ? { clock } : {}) }), real, records, attempts };
}
const resources: Array<() => Promise<unknown>> = [];
const errors: unknown[] = [];
const unhandled = (e: unknown) => errors.push(e), warning = (e: Error) => {
    if (e.name === 'MaxListenersExceededWarning')
        errors.push(e);
};
process.on('unhandledRejection', unhandled);
process.on('warning', warning);
const db = new Pool({ ...config(), max: 8 });
db.on('error', unhandled);
await setup(db);
function make(hook?: Hook, real = pool(), clock?: Clock, afterAcquire?: () => Promise<void>) { const r = tracked(real, hook, clock, afterAcquire); resources.push(() => r.repository.close()); return r; }
function session(out: any) { assert.equal(out.kind, 'committed'); assert.equal(out.delivery, 'session'); assert.match(out.token, /^[A-Za-z0-9_-]{43}$/); assert.ok(Object.isFrozen(out)); assert.equal(Object.getPrototypeOf(out.session), null); assert.deepEqual(Reflect.ownKeys(out.session), []); return out; }
function receipt(out: any) { assert.equal(out.kind, 'committed'); assert.equal(out.delivery, 'receipt'); assert.ok(out.receipt); return out.receipt; }
function data(out: any) { assert.equal(out.kind, 'completed'); assert.equal(out.delivery, 'data'); return out.data; }
function failed(out: any, code?: string) {
    assert.equal(out.kind, 'failed');
    if (code)
        assert.equal(out.code, code);
    assert.equal('token' in out, false);
    assert.equal('receipt' in out, false);
}
async function acquired(r: ReturnType<typeof make>) { await observe(async () => r.records.length > 0, 'repository acquired client'); return r.records.at(-1)!.pid; }
async function issue(r: ReturnType<typeof make>, p: Prepared) { return session(await r.repository.issue(issueRequest(p))); }
async function secretsAbsent(r: ReturnType<typeof make>, token: string) { const all = JSON.stringify(r.records.flatMap(x => x.values)); assert.equal(all.includes(token), false); assert.ok(all.includes(tokenHash(token))); }
function clock() { let mono = 0, wall = 0, invalid = false; const value: Clock = { monotonic: () => invalid ? NaN : performance.now() + mono, wall: () => Date.now() + wall, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>) }; return { value, advance: (ms: number) => { mono += ms; wall += ms; }, wallAdvance: (ms: number) => { wall += ms; }, break: () => { invalid = true; }, restore: () => { invalid = false; } }; }
async function passwordProbe(options: any) {
    const require = createRequire(import.meta.url), loader = require('node:module') as {
        _load: (...args: any[]) => any;
    }, original = loader._load, saved = process.env.PGPASSWORD;
    let discoveries = 0;
    const clients: Client[] = [];
    loader._load = function (name: string, ...args: any[]) {
        if (name === 'pgpass') {
            discoveries++;
            return (_p: unknown, done: (x: undefined) => void) => done(undefined);
        }
        return Reflect.apply(original, this, [name, ...args]);
    };
    const get = (c: Client) => new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('password branch deadline')), 2000); const bad = (e: Error) => { clearTimeout(timer); reject(e); }; c.once('error', bad); (c as any)._getPassword(() => { clearTimeout(timer); c.removeListener('error', bad); resolve(); }); });
    try {
        delete process.env.PGPASSWORD;
        const control = new Client({ ...config(), password: '' });
        clients.push(control);
        await get(control);
        assert.equal(discoveries, 1);
        discoveries = 0;
        assert.equal(typeof options.password, 'function');
        const candidate = new Client(options);
        clients.push(candidate);
        process.env.PGPASSWORD = 'not_a_real_credential';
        await get(candidate);
        assert.equal(discoveries, 0);
        assert.equal((candidate as any).password, saved ?? '');
    }
    finally {
        loader._load = original;
        if (saved === undefined)
            delete process.env.PGPASSWORD;
        else
            process.env.PGPASSWORD = saved;
        for (const c of clients)
            await c.end();
    }
}
let cases = 0;
function pass(label: string) { cases++; console.log('PASS ' + label); }
try {
    // Actual public factory composition, not just injected pool wiring.
    const p = await prepared(db, 'hosted');
    let options: any;
    const original = Pool.prototype.connect;
    (Pool.prototype as any).connect = function (...args: any[]) { options = (this as any).options; return Reflect.apply(original, this, args); };
    let publicRepo: ReturnType<typeof createLocalModeSessionRepository>;
    let first: any;
    try {
        publicRepo = createLocalModeSessionRepository({ profiles: [profile] });
        resources.push(() => publicRepo.close());
        first = session(await publicRepo.issue(issueRequest(p)));
    }
    finally {
        Pool.prototype.connect = original;
    }
    await passwordProbe(options);
    const req = request(first.token), accepted = receipt(await publicRepo!.submit(first.session, req));
    assert.equal(accepted.state, 'draft');
    assert.equal(data(await publicRepo!.ownerHistory(actor(p), ownerRequest(p))).requests[0].reference, accepted.reference);
    await publicRepo!.close();
    const restarted = createLocalModeSessionRepository({ profiles: [profile] });
    resources.push(() => restarted.close());
    failed(await restarted.submit(first.session, req), 'INVALID_REQUEST');
    assert.equal(data(await restarted.ownerHistory(actor(p), ownerRequest(p))).requests[0].reference, accepted.reference);
    pass('public factory issue/submit/owner, no-pgpass callback and unsupported cross-process capability resurrection');
    for (const v2 of [false, true]) {
        const x = await prepared(db, 'iframe', v2), r = make(), s = await issue(r, x), q = request(s.token);
        const result = receipt(await r.repository.submit(s.session, q));
        assert.equal(result.initialState, 'draft');
        assert.equal(result.requestAccepted, true);
        assert.equal(result.replayed, false);
        assert.equal(result.state, 'draft');
        const repeated = receipt(await r.repository.submit(s.session, { ...q, customer: { name: ' Customer ', email: ' customer@example.test ' } }));
        assert.equal(repeated.reference, result.reference);
        assert.equal(repeated.replayed, true);
        if (v2)
            assert.equal(s.receipt.render.renderSchemaVersion, 2);
        assert.equal(new Set(r.records.map(x => x.pid)).size, 1);
        assert.ok(r.records.every(x => x.releases.length === 1 && !x.releases[0]));
        const state = await snapshot(db, x.f.tenant);
        assert.equal(state.payments.length, 0);
        assert.equal(state.capacity_holds.length, 0);
        assert.equal(state.bookings.length, 1);
        assert.equal(state.durable_outbox.length, 1);
        await secretsAbsent(r, s.token);
        const clean = await r.real.connect();
        try {
            assert.deepEqual((await clean.query("select current_user,current_setting('role') role")).rows[0], { current_user: 'postgres', role: 'none' });
        }
        finally {
            clean.release();
        }
        pass(`actual ${v2 ? 'required V2' : 'V1'} iframe issue, canonical retry, clean reuse, secret-free SQL and no payment/hold`);
    }
    // Genuine wire response loss for committed and rolled-back issuance.
    for (const rollback of [false, true]) {
        const x = await prepared(db), before = await snapshot(db, x.f.tenant), proxy = await lossProxy(rollback ? 'ROLLBACK' : 'COMMIT');
        let initial = true, selected: any, tag = '';
        const r = make(async (c, text, _v, run) => {
            if (text.startsWith('SELECT public.mode_issue')) {
                const out = await run();
                if (initial)
                    selected = out.rows[0].result;
                return out;
            }
            if (text === 'COMMIT' && initial) {
                initial = false;
                if (rollback)
                    await c.query('select 1/0').catch(() => { });
                try {
                    const out = await run();
                    tag = out.command;
                    return out;
                }
                catch (e) {
                    throw e;
                }
            }
            return run();
        }, new Pool({ ...config(), port: proxy.port }));
        try {
            const out: any = await r.repository.issue(issueRequest(x));
            assert.equal(out.kind, 'unknown_commit');
            assert.equal(out.token, null);
            assert.equal(out.receipt, null);
            assert.ok(out.attempt);
            assert.equal(proxy.sawTag, true);
            assert.equal(proxy.sawReady, true);
            assert.equal(tag, '');
            await gone(db, r.records[0]!.pid);
            const after = await snapshot(db, x.f.tenant);
            assert.equal(after.mode_flow_sessions.length, rollback ? 0 : 1);
            if (rollback)
                assert.deepEqual(after, before);
            const recovered: any = await r.repository.recoverIssue(out.attempt);
            assert.equal(recovered.priorIssuance, 'unknown');
            const success = session(recovered.outcome);
            assert.equal(success.receipt.sessionId === selected.sessionId, !rollback);
            if (!rollback) {
                assert.equal(success.receipt.expiresAt, selected.expiresAt);
                assert.deepEqual(await snapshot(db, x.f.tenant), after);
            }
            assert.equal(r.records.flatMap(x => x.commands).filter(x => x.startsWith('SELECT public.mode_issue')).length, 2);
            await secretsAbsent(r, success.token);
            assert.deepEqual(proxy.errors, []);
        }
        finally {
            await r.repository.close();
            await proxy.close();
        }
        pass(`actual ${rollback ? 'ROLLBACK' : 'COMMIT'} response frames lost; explicit issue recovery ${rollback ? 'accepts new identity' : 'preserves original identity/expiry'}`);
    }
    // Genuine wire response loss for submission, with strict unresolved-intent enforcement.
    for (const rollback of [false, true]) {
        const x = await prepared(db), proxy = await lossProxy(rollback ? 'ROLLBACK' : 'COMMIT', false);
        let active = false, selected: any;
        const r = make(async (c, text, _v, run) => {
            if (text.startsWith('SELECT public.mode_submit')) {
                const out = await run();
                if (active)
                    selected = out.rows[0].result;
                return out;
            }
            if (text === 'COMMIT' && active) {
                active = false;
                if (rollback)
                    await c.query('select 1/0').catch(() => { });
            }
            return run();
        }, new Pool({ ...config(), port: proxy.port }));
        try {
            const s = await issue(r, x), q = request(s.token), before = await snapshot(db, x.f.tenant);
            active = true;
            proxy.arm();
            const out: any = await r.repository.submit(s.session, q);
            assert.equal(out.kind, 'unknown_commit');
            assert.equal(proxy.sawTag, true);
            assert.equal(proxy.sawReady, true);
            await gone(db, r.records.at(-1)!.pid);
            const state = await snapshot(db, x.f.tenant);
            assert.equal(state.bookings.length, rollback ? 0 : 1);
            if (rollback)
                assert.deepEqual(state, before);
            const count = r.records.length;
            failed(await r.repository.submit(s.session, { ...q, customer: { ...q.customer, name: 'Different' } }), 'CONFLICT');
            assert.equal(r.records.length, count);
            const recovered = receipt(await r.repository.submit(s.session, q));
            assert.equal(recovered.reference === selected.reference, !rollback);
            assert.equal(recovered.replayed, !rollback);
            assert.equal((await snapshot(db, x.f.tenant)).bookings.length, 1);
            await secretsAbsent(r, s.token);
            assert.deepEqual(proxy.errors, []);
        }
        finally {
            await r.repository.close();
            await proxy.close();
        }
        pass(`actual ${rollback ? 'ROLLBACK' : 'COMMIT'} submit acknowledgement lost; pending intent enforced and ${rollback ? 'new' : 'same'} reference recovered`);
    }
    // A real ROLLBACK tag is known, and cannot establish a speculative issuance baseline.
    {
        const x = await prepared(db), before = await snapshot(db, x.f.tenant);
        let tag = '';
        const r = make(async (c, text, _v, run) => {
            if (text === 'COMMIT') {
                await c.query('select 1/0').catch(() => { });
                const out = await run();
                tag = out.command;
                return out;
            }
            return run();
        });
        const out: any = await r.repository.issue(issueRequest(x));
        failed(out, 'INTERNAL_ERROR');
        assert.equal(out.transaction, 'rolled_back');
        assert.equal(out.backendMayStillRun, false);
        assert.equal(tag, 'ROLLBACK');
        await gone(db, r.records[0]!.pid);
        assert.deepEqual(await snapshot(db, x.f.tenant), before);
        pass('actual acknowledged ROLLBACK is known noncommit and full issuance state rolls back');
    }
    // Owner reads have a separate uncertainty shape, even though COMMIT uses the same wire tag.
    {
        const x = await prepared(db), proxy = await lossProxy('COMMIT'), before = await snapshot(db, x.f.tenant), r = make(undefined, new Pool({ ...config(), port: proxy.port }));
        try {
            const out: any = await r.repository.ownerHistory(actor(x), ownerRequest(x));
            assert.equal(out.kind, 'completion_uncertain');
            assert.equal(out.data, null);
            assert.equal(out.backendMayStillRun, true);
            assert.equal(proxy.sawTag, true);
            assert.equal(proxy.sawReady, true);
            await gone(db, r.records[0]!.pid);
            assert.deepEqual(await snapshot(db, x.f.tenant), before);
        }
        finally {
            await r.repository.close();
            await proxy.close();
        }
        pass('actual owner COMMIT response loss yields read completion uncertainty without mutation');
    }
    // Known COMMIT delivery withheld by a synthetic monotonic budget crossing; explicit recovery retains first provenance.
    {
        const x = await prepared(db), time = clock();
        let once = true, tag = '';
        const r = make(async (_c, text, _v, run) => {
            const out = await run();
            if (text === 'COMMIT' && once) {
                once = false;
                tag = out.command;
                time.advance(10001);
            }
            return out;
        }, pool(), time.value);
        const out: any = await r.repository.issue(issueRequest(x));
        assert.equal(tag, 'COMMIT');
        assert.equal(out.kind, 'committed');
        assert.equal(out.delivery, 'withheld');
        assert.equal(out.reason, 'DEADLINE');
        assert.ok(out.attempt);
        assert.equal(out.token, null);
        const previous = await snapshot(db, x.f.tenant), recovered: any = await r.repository.recoverIssue(out.attempt);
        assert.equal(recovered.priorIssuance, 'known_committed');
        session(recovered.outcome);
        assert.deepEqual(await snapshot(db, x.f.tenant), previous);
        pass('actual COMMIT with synthetic post-ACK deadline withholds token and preserves known prior provenance');
    }
    // Lost committed issuance, then target-only advancement: recovery remains pinned to the old snapshot.
    {
        const x = await prepared(db), proxy = await lossProxy('COMMIT'), r = make(undefined, new Pool({ ...config(), port: proxy.port }));
        try {
            const out: any = await r.repository.issue(issueRequest(x));
            assert.equal(out.kind, 'unknown_commit');
            const old = (await snapshot(db, x.f.tenant)).mode_flow_sessions[0], v2 = await secondVersion(db, x.f);
            await transaction(db, c => apply(c, x.f, x.installed.installationId, x.published.versionId, v2.versionId));
            const recovered: any = await r.repository.recoverIssue(out.attempt), s = session(recovered.outcome);
            assert.equal(s.receipt.versionId, x.published.versionId);
            assert.equal(s.receipt.sessionId, old.id);
            assert.equal(tokenHash(s.token), old.token_hash);
            assert.equal((await snapshot(db, x.f.tenant)).mode_flow_sessions.length, 1);
        }
        finally {
            await r.repository.close();
            await proxy.close();
        }
        pass('actual target advance does not change the committed session pin during same-attempt recovery');
    }
    // Current policy denial during recovery describes only this later transaction; the first committed row persists.
    {
        const x = await prepared(db), proxy = await lossProxy('COMMIT'), r = make(undefined, new Pool({ ...config(), port: proxy.port }));
        try {
            const out: any = await r.repository.issue(issueRequest(x));
            assert.equal(out.kind, 'unknown_commit');
            await transaction(db, c => policy(c, x.f, x.installed.installationId));
            const before = await snapshot(db, x.f.tenant), recovered: any = await r.repository.recoverIssue(out.attempt);
            assert.equal(recovered.priorIssuance, 'unknown');
            failed(recovered.outcome, 'FORBIDDEN');
            await gone(db, r.records.at(-1)!.pid);
            assert.deepEqual(await snapshot(db, x.f.tenant), before);
            assert.equal(before.mode_flow_sessions.length, 1);
            failed((await r.repository.recoverIssue(out.attempt)).outcome, 'INVALID_REQUEST');
        }
        finally {
            await r.repository.close();
            await proxy.close();
        }
        pass('revoked policy denies recovery without relabeling earlier committed issuance or replacing token');
    }
    // Retained original customer, current booking state and server-only email predicate.
    {
        const x = await prepared(db), r = make(), s = await issue(r, x), q = request(s.token);
        await db.query('insert into public.customers(id,tenant_id,name,email) values($1,$2,$3,$4)', [randomUUID(), x.f.tenant, 'Original retained', q.customer.email]);
        const accepted = receipt(await r.repository.submit(s.session, q));
        const row = (await db.query('select id from public.bookings where tenant_id=$1', [x.f.tenant])).rows[0];
        await transaction(db, async (c) => { await c.query('alter table public.bookings disable trigger user'); await c.query("update public.bookings set state='completed' where id=$1", [row.id]); await c.query('alter table public.bookings enable trigger user'); }, 'owner');
        const repeated = receipt(await r.repository.submit(s.session, q));
        assert.equal(repeated.reference, accepted.reference);
        assert.equal(repeated.state, 'completed');
        assert.equal((await db.query('select name from public.customers where tenant_id=$1', [x.f.tenant])).rows[0].name, 'Original retained');
        assert.equal(data(await r.repository.ownerHistory(actor(x), ownerRequest(x))).requests[0].state, 'completed');
        pass('trusted progressed-state fixture and original customer name survive authoritative historical retry');
    }
    for (const email of ['a\tb@example.test', 'a\rb@example.test', 'a\nb@example.test', 'a\fb@example.test', 'a\vb@example.test', 'missing.dot@example']) {
        const x = await prepared(db), r = make(), s = await issue(r, x), q = request(s.token);
        q.customer.email = email;
        const before = await snapshot(db, x.f.tenant);
        failed(await r.repository.submit(s.session, q), 'INVALID_REQUEST');
        assert.ok(r.records.at(-1)!.commands.some(x => x.startsWith('SELECT public.mode_submit')), 'email syntax reaches actual SQL');
        await gone(db, r.records.at(-1)!.pid);
        assert.deepEqual(await snapshot(db, x.f.tenant), before);
    }
    pass('actual SQL rejects email control whitespace/missing dot with full rollback; transport delegates syntax');
    // Unicode whitespace follows the actual SQL customer predicate rather than a guessed JS regular expression.
    for (const point of [0x00a0, 0x2003, 0x2028]) {
        const x = await prepared(db), r = make(), s = await issue(r, x), q = request(s.token);
        q.customer.email = 'a' + String.fromCodePoint(point) + 'b@example.test';
        let allowed = true;
        try {
            await db.query('select lumin.mode_session_customer($1::jsonb)', [JSON.stringify(q.customer)]);
        }
        catch (error) {
            assert.equal((error as any).code, '22023');
            assert.equal((error as Error).message, 'MODE_REQUEST_INVALID_CUSTOMER');
            allowed = false;
        }
        const before = await snapshot(db, x.f.tenant), out = await r.repository.submit(s.session, q);
        assert.ok(r.records.at(-1)!.commands.some(x => x.startsWith('SELECT public.mode_submit')));
        if (allowed)
            receipt(out);
        else {
            failed(out, 'INVALID_REQUEST');
            await gone(db, r.records.at(-1)!.pid);
            assert.deepEqual(await snapshot(db, x.f.tenant), before);
        }
    }
    pass('Unicode whitespace acceptance matches actual authoritative SQL predicate, with no guessed JS syntax rule');
    // Owner authorization and row-projection anomaly are actual database outcomes.
    {
        const x = await prepared(db), r = make(), s = await issue(r, x);
        receipt(await r.repository.submit(s.session, request(s.token)));
        for (const userId of [x.f.staff, x.f.foreignActor])
            failed(await r.repository.ownerHistory({ mode: 'local_synthetic', userId }, ownerRequest(x)), 'FORBIDDEN');
        await db.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2", [x.f.tenant, x.f.actor]);
        failed(await r.repository.ownerHistory(actor(x), ownerRequest(x)), 'FORBIDDEN');
        await db.query("update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=$1 and user_id=$2", [x.f.tenant, x.f.actor]);
        await transaction(db, async (c) => { await c.query('alter table public.bookings disable trigger user'); await c.query("update public.bookings set reference=repeat('x',129) where tenant_id=$1", [x.f.tenant]); await c.query('alter table public.bookings enable trigger user'); }, 'owner');
        failed(await r.repository.ownerHistory(actor(x), ownerRequest(x)), 'INTERNAL_ERROR');
        pass('actual owner role/revocation checks and malformed retained booking projection fail closed');
    }
    // Actual late COMMIT fulfillment while an explicit recovery call is still active.
    {
        const x = await prepared(db), ack = deferred(), ackReady = deferred(), retryGate = deferred(), retryReady = deferred();
        let delayCommit = false, delayRetry = false;
        const r = make(async (_c, text, _v, run) => {
            if (text.startsWith('SELECT public.mode_submit') && delayRetry) {
                delayRetry = false;
                retryReady.resolve();
                await retryGate.promise;
            }
            const out = await run();
            if (text === 'COMMIT' && delayCommit) {
                delayCommit = false;
                assert.equal(out.command, 'COMMIT');
                ackReady.resolve();
                await ack.promise;
            }
            return out;
        });
        const s = await issue(r, x), q = request(s.token), abort = new AbortController();
        delayCommit = true;
        const pending = r.repository.submit(s.session, q, { signal: abort.signal });
        await phase(ackReady.promise, pending, 'actual first COMMIT held from adapter');
        abort.abort();
        assert.equal((await pending).kind, 'unknown_commit');
        const before = await snapshot(db, x.f.tenant);
        assert.equal(before.bookings.length, 1);
        delayRetry = true;
        const stop = new AbortController(), retry = r.repository.submit(s.session, q, { signal: stop.signal });
        await phase(retryReady.promise, retry, 'new explicit recovery active');
        ack.resolve();
        await new Promise<void>(r => setImmediate(r));
        stop.abort();
        failed(await retry, 'ABORTED');
        retryGate.resolve();
        await gone(db, r.records.at(-1)!.pid);
        const count = r.records.length;
        failed(await r.repository.submit(s.session, { ...q, idempotencyKey: randomUUID() }), 'CONFLICT');
        assert.equal(r.records.length, count, 'late old ACK must not clear pending intent');
        const accepted = receipt(await r.repository.submit(s.session, q));
        assert.equal(accepted.reference, before.bookings[0].reference);
        assert.equal(accepted.replayed, true);
        assert.deepEqual(await snapshot(db, x.f.tenant), before);
        pass('actual old COMMIT ACK during newer aborted call is cleanup-only and cannot clear unresolved intent');
    }
    // Same ownership rule for issuance: late response cannot accept/resurrect a busy recovering capability.
    {
        const x = await prepared(db), ack = deferred(), ready = deferred(), gate = deferred(), inRetry = deferred();
        let first = true, delay = false;
        const r = make(async (_c, text, _v, run) => {
            if (text.startsWith('SELECT public.mode_issue') && delay) {
                delay = false;
                inRetry.resolve();
                await gate.promise;
            }
            const out = await run();
            if (text === 'COMMIT' && first) {
                first = false;
                assert.equal(out.command, 'COMMIT');
                ready.resolve();
                await ack.promise;
            }
            return out;
        });
        const abort = new AbortController(), pending = r.repository.issue(issueRequest(x), { signal: abort.signal });
        await phase(ready.promise, pending, 'issue real COMMIT withheld');
        abort.abort();
        const out: any = await pending;
        assert.equal(out.kind, 'unknown_commit');
        delay = true;
        const recovery = r.repository.recoverIssue(out.attempt);
        await phase(inRetry.promise, recovery, 'issuance recovery active');
        ack.resolve();
        await new Promise<void>(r => setImmediate(r));
        failed((await r.repository.recoverIssue(out.attempt)).outcome, 'CONTEXT_BUSY');
        gate.resolve();
        const result: any = await recovery;
        assert.equal(result.priorIssuance, 'unknown');
        const s = session(result.outcome);
        assert.equal((await snapshot(db, x.f.tenant)).mode_flow_sessions[0].id, s.receipt.sessionId);
        pass('late genuine issue COMMIT ACK cannot accept capability while a newer recovery owns it');
    }
    // Real source lock, cancellation and explicit backend disappearance precede clean retry.
    {
        const x = await prepared(db), r = make(), hold = await holder(db), before = await snapshot(db, x.f.tenant);
        try {
            await hold.query('select id from public.services where id=$1 for update', [x.f.service]);
            const abort = new AbortController(), pending = r.repository.issue(issueRequest(x), { signal: abort.signal });
            const id = await acquired(r);
            await blocked(db, id, pid(hold));
            abort.abort();
            failed(await pending, 'ABORTED');
            assert.deepEqual(r.records[0]!.releases, [true]);
            await hold.query('rollback');
            await gone(db, id);
            assert.deepEqual(await snapshot(db, x.f.tenant), before);
            await issue(r, x);
            assert.notEqual(r.records.at(-1)!.pid, id);
        }
        finally {
            await hold.query('rollback').catch(() => { });
            hold.release();
        }
        pass('actual blocked issuance abort rolls back and discarded backend is not reused');
    }
    // Actual SQL expiry while blocked on an existing customer; shortened expiry is a trusted database fixture.
    {
        const x = await prepared(db), r = make(), s = await issue(r, x), q = request(s.token), customer = randomUUID();
        await db.query('insert into public.customers(id,tenant_id,name,email) values($1,$2,$3,$4)', [customer, x.f.tenant, 'Original', q.customer.email]);
        await expiry(db, s.receipt.sessionId, 0.5);
        const before = await snapshot(db, x.f.tenant), hold = await holder(db);
        try {
            await hold.query('select id from public.customers where id=$1 for update', [customer]);
            const pending = r.repository.submit(s.session, q);
            await observe(async () => r.records.length === 2, 'submit checkout');
            await blocked(db, r.records[1]!.pid, pid(hold));
            await observe(async () => (await db.query('select expires_at<=clock_timestamp() expired from public.mode_flow_sessions where id=$1', [s.receipt.sessionId])).rows[0].expired, 'actual fixture expiry');
            await hold.query('rollback');
            failed(await pending, 'FORBIDDEN');
            await gone(db, r.records[1]!.pid);
            assert.deepEqual(await snapshot(db, x.f.tenant), before);
        }
        finally {
            await hold.query('rollback').catch(() => { });
            hold.release();
        }
        pass('actual customer row wait crosses authoritative SQL expiry and rolls back all submit state');
    }
    // Synthetic wall expiry after successful SQL but before COMMIT: no success or persisted session.
    {
        const x = await prepared(db), time = clock(), before = await snapshot(db, x.f.tenant);
        let selected = false;
        const r = make(async (_c, text, _v, run) => {
            const out = await run();
            if (text.startsWith('SELECT public.mode_issue')) {
                selected = true;
                time.wallAdvance(900001);
            }
            return out;
        }, pool(), time.value);
        failed(await r.repository.issue(issueRequest(x)), 'EXPIRED');
        assert.equal(selected, true);
        assert.equal(r.records[0]!.commands.includes('COMMIT'), false);
        await gone(db, r.records[0]!.pid);
        assert.deepEqual(await snapshot(db, x.f.tenant), before);
        pass('synthetic wall expiry after actual issue SQL prevents COMMIT and token delivery');
    }
    // Clock failure invalidates all retained capabilities, even after clock samples become valid again.
    {
        const x = await prepared(db), time = clock(), r = make(undefined, pool(), time.value), one = await issue(r, x), two = await issue(r, x);
        time.break();
        failed(await r.repository.submit(one.session, request(one.token)), 'CLOCK_UNAVAILABLE');
        time.restore();
        failed(await r.repository.submit(two.session, request(two.token)), 'CLOCK_UNAVAILABLE');
        failed(await r.repository.issue(issueRequest(x)), 'CLOCK_UNAVAILABLE');
        assert.equal(r.records.length, 2);
        assert.equal((await snapshot(db, x.f.tenant)).bookings.length, 0);
        pass('trusted invalid clock irreversibly disposes two actual issued contexts without later SQL');
    }
    // Preserve legacy character-count compatibility for all five astral catalog strings.
    {
        const f = await fixture(db), astral = String.fromCodePoint(0x1f600), question = astral.repeat(100), choice = astral.repeat(100);
        await transaction(db, async (c) => { await c.query('update public.services set name=$1 where id=$2', [astral.repeat(200), f.service]); await c.query('delete from public.service_questions where service_id=$1', [f.service]); await c.query("insert into public.service_questions(id,tenant_id,service_id,question_key,prompt,kind,required,choices) values($1,$2,$3,$4,$5,'single_choice',true,$6)", [randomUUID(), f.tenant, f.service, question, astral.repeat(500), JSON.stringify([{ id: choice, label: astral.repeat(200) }, { id: 'constructor', label: 'Reserved choice allowed' }])]); }, 'owner');
        await transaction(db, c => c.query('select public.save_bound_flow_draft($1,$2,$3,$4,1,$5,$6)', [f.actor, f.tenant, f.flow, f.service, 'Astral', JSON.stringify({ key: 'astral', steps: [{ key: 'pick', questionKey: question, kind: 'question', required: true }] })]));
        const published = await transaction(db, c => publish(c, f, 2)), installed = await transaction(db, c => install(c, f, published.versionId)), x = { f, published, installed }, r = make(), s = await issue(r, x);
        assert.equal(s.receipt.render.service.name, astral.repeat(200));
        const q = { ...request(s.token), answers: { [question]: { choiceIds: [choice] } } };
        receipt(await r.repository.submit(s.session, q));
        pass('actual published V1 maximum astral name/key/prompt/choiceID/label survives issue and submit');
    }
    // Hostile DTOs and raw-role boundaries must not become accidental SQL access paths.
    {
        const x = await prepared(db), r = make();
        let getters = 0;
        const evil = Object.defineProperty({}, 'installationId', { enumerable: true, get() { getters++; throw Error('must not invoke'); } });
        failed(await r.repository.issue(evil), 'INVALID_REQUEST');
        failed(await r.repository.issue(new Proxy(issueRequest(x), {})), 'INVALID_REQUEST');
        assert.equal(getters, 0);
        assert.equal(r.records.length, 0);
        for (const role of ['anon', 'authenticated', 'service_role'])
            for (const table of ['mode_flow_sessions', 'mode_flow_requests'])
                await assert.rejects(transaction(db, c => c.query(`select * from public.${table}`), role), (e: any) => { assert.equal(e.code, '42501'); return true; });
        pass('hostile request accessors/proxies fail before checkout and actual raw roles cannot browse session/request rows');
    }
    // First acceptance before the requested time, then an actual past-start replay under the same live session.
    {
        const x = await prepared(db), r = make(), s = await issue(r, x), q = request(s.token);
        q.requestedStart = new Date(Date.now() + 1200).toISOString().replace(/Z$/, '000Z');
        const accepted = receipt(await r.repository.submit(s.session, q));
        await observe(async () => (await db.query('select clock_timestamp()>$1::timestamptz elapsed', [q.requestedStart])).rows[0].elapsed, 'requested start passed while session live');
        const before = await snapshot(db, x.f.tenant), retry = receipt(await r.repository.submit(s.session, q));
        assert.equal(retry.reference, accepted.reference);
        assert.equal(retry.replayed, true);
        assert.deepEqual(await snapshot(db, x.f.tenant), before);
        pass('actual accepted past-start retry succeeds without local future-time rejection or additional writes');
    }
    {
        const x = await prepared(db), r = make();
        for (let i = 0; i < 3; i++) {
            const s = await issue(r, x);
            receipt(await r.repository.submit(s.session, request(s.token)));
        }
        const seen = new Set<string>();
        let cursor: any = null;
        for (let i = 0; i < 3; i++) {
            const page = data(await r.repository.ownerHistory(actor(x), { ...ownerRequest(x), limit: 1, beforeCreatedAt: cursor?.createdAt ?? null, beforeBookingId: cursor?.bookingId ?? null }));
            assert.equal(page.requests.length, 1);
            assert.equal(seen.has(page.requests[0].bookingId), false);
            seen.add(page.requests[0].bookingId);
            cursor = page.nextCursor;
            if (i < 2)
                assert.ok(cursor);
            else
                assert.equal(cursor, null);
        }
        assert.equal(seen.size, 3);
        await db.query("update public.flows set status='archived' where id=$1", [x.f.flow]);
        assert.equal(data(await r.repository.ownerHistory(actor(x), ownerRequest(x))).requests.length, 3);
        pass('actual owner keyset pages cover three unique bookings and retain archived-flow visibility');
    }
    // Actual driver acquisition rejection and late facade delivery are observed separately.
    {
        const x = await prepared(db), real = new Pool({ ...config(), connectionTimeoutMillis: 1000 }), a = await real.connect(), b = await real.connect(), r = make(undefined, real);
        try {
            const out: any = await r.repository.issue(issueRequest(x));
            failed(out, 'CONNECTION_FAILED');
            assert.equal(out.transaction, 'not_started');
            assert.equal(r.attempts.length, 1);
            assert.equal(r.attempts[0]!.state, 'rejected');
            assert.equal(r.records.length, 0);
        }
        finally {
            a.release();
            b.release();
        }
        pass('real saturated pg pool rejects checkout without BEGIN or invented release completion');
    }
    {
        const x = await prepared(db), real = pool(), a = await real.connect(), b = await real.connect(), gate = deferred(), ready = deferred(), r = make(undefined, real, undefined, async () => { ready.resolve(); await gate.promise; }), abort = new AbortController();
        let aReleased = false;
        try {
            const pending = r.repository.issue(issueRequest(x), { signal: abort.signal });
            await observe(async () => real.waitingCount === 1, 'queued actual checkout');
            abort.abort();
            failed(await pending, 'ABORTED');
            a.release();
            aReleased = true;
            await phase(ready.promise, new Promise(() => { }), 'actual dequeued client held by facade');
            assert.equal(real.waitingCount, 0);
            assert.equal(r.attempts[0]!.state, 'pending');
            assert.deepEqual(r.records[0]!.releases, []);
            gate.resolve();
            await observe(async () => r.attempts[0]!.state === 'returned' && r.records[0]!.releases.length === 1, 'late client actually disposed');
            assert.deepEqual(r.records[0]!.commands, []);
            assert.deepEqual(r.records[0]!.releases, [true]);
            await gone(db, r.records[0]!.pid);
        }
        finally {
            gate.resolve();
            if (!aReleased)
                a.release();
            b.release();
        }
        pass('actual queue removal alone is insufficient; late delivered client runs no SQL and is discarded once');
    }
    {
        const x = await prepared(db), time = clock();
        let tag = '';
        const r = make(async (_c, text, _v, run) => {
            const out = await run();
            if (text === 'COMMIT') {
                tag = out.command;
                time.advance(10001);
            }
            return out;
        }, pool(), time.value);
        const out: any = await r.repository.ownerHistory(actor(x), ownerRequest(x));
        assert.equal(tag, 'COMMIT');
        assert.equal(out.kind, 'completed');
        assert.equal(out.delivery, 'withheld');
        assert.equal(out.reason, 'DEADLINE');
        assert.equal(out.data, null);
        pass('actual acknowledged owner COMMIT followed by synthetic deadline stays completed with data withheld');
    }
    // Real late SQL failures retain the earlier committed issued session and roll back all submit writes.
    for (const table of ['customers', 'bookings', 'booking_state_history', 'mode_flow_requests', 'durable_outbox']) {
        const x = await prepared(db), r = make(async (_c, text, _v, run) => {
            try {
                return await run();
            }
            catch (error) {
                if (text.startsWith('SELECT public.mode_submit') && (error as any).code === 'P0001' && (error as Error).message === expected)
                    observed = true;
                throw error;
            }
        }), s = await issue(r, x), before = await snapshot(db, x.f.tenant);
        const expected = 'ACTUAL_S2_LATE_' + table.toUpperCase();
        let observed = false;
        const predicate = table === 'booking_state_history' ? 'true' : `new.tenant_id='${x.f.tenant}'::uuid`;
        const cleanup = await fault(db, table, predicate);
        try {
            failed(await r.repository.submit(s.session, request(s.token)), 'INTERNAL_ERROR');
            assert.equal(observed, true, 'actual late phase/message observed');
            await gone(db, r.records.at(-1)!.pid);
            assert.deepEqual(await snapshot(db, x.f.tenant), before);
        }
        finally {
            await cleanup();
        }
        receipt(await r.repository.submit(s.session, request(s.token)));
    }
    pass('five actual late SQL phases roll back complete submit state while retaining issued session, with clean controls');
    // Real deferred foreign-key COMMIT wait; synthetic expiry during wait cannot certify rollback.
    {
        const x = await prepared(db), control = await db.connect(), f = await commitFixture(control), ready = deferred(), resume = deferred(), time = clock(), abort = new AbortController();
        let submitted = false;
        const r = make(async (c, text, _v, run) => {
            if (text === 'COMMIT') {
                await c.query('set local role none');
                await c.query(f.defer);
                await c.query(f.insert, [f.parent]);
                ready.resolve();
                await resume.promise;
                submitted = true;
            }
            return run();
        }, pool(), time.value);
        const hold = await holder(db);
        try {
            const pending = r.repository.issue(issueRequest(x), { signal: abort.signal });
            await phase(ready.promise, pending, 'deferred FK prepared');
            await hold.query(f.lock, [f.parent]);
            resume.resolve();
            const id = await acquired(r);
            await blocked(db, id, pid(hold));
            assert.equal(submitted, true);
            assert.equal((await db.query('select query from pg_stat_activity where pid=$1', [id])).rows[0].query, 'COMMIT');
            time.wallAdvance(900001);
            abort.abort();
            const out: any = await pending;
            assert.equal(out.kind, 'unknown_commit');
            assert.equal(out.token, null);
            assert.equal(out.attempt, null);
            await hold.query('rollback');
            await gone(db, id);
            const after = await snapshot(db, x.f.tenant);
            assert.ok(after.mode_flow_sessions.length === 0 || after.mode_flow_sessions.length === 1, 'disposal cannot predict server COMMIT outcome');
            assert.equal(after.bookings.length, 0);
        }
        finally {
            resume.resolve();
            await hold.query('rollback').catch(() => { });
            hold.release();
            await f.cleanup();
            control.release();
        }
        pass('actual deferred FK blocks COMMIT; synthetic expiry/abort preserves uncertainty and withholds secret');
    }
    await new Promise<void>(r => setImmediate(r));
    assert.deepEqual(errors, []);
    console.log(`MODE SESSION TRANSPORT PASS ${cases} actual-driver scenarios`);
}
finally {
    for (const close of resources.reverse())
        await close();
    await db.end();
    process.removeListener('unhandledRejection', unhandled);
    process.removeListener('warning', warning);
}

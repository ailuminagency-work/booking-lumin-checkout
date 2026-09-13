/** Native delivery proof support. No raw session material leaves this process. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { createLocalModeSessionAdmission } from './mode-session-admission.js';
import { __createModeSessionRepositoryForTests, type ModeSessionClock } from './mode-session-repository.js';
import { createExistingModeSessionValidator, EXISTING_SESSION_VALIDATION_SQL } from './mode-session-validation.js';
import { createModeSessionDeliveryCoordinator, type DeliveryResult } from './mode-session-delivery.js';
import { createModeSessionContracts } from './mode-session-contracts.js';
import { recordedPool, type QueryHook } from './mode-session-admission-fixtures.js';
import { Scope, bounded, gate } from './mode-session-validation-fixtures.js';
import { config, setup, prepared, issueRequest, tokenHash, profile, snapshot, observe, gone, transaction, apply, policy, secondVersion, lossProxy, type Prepared } from './mode-session-transport-fixtures.js';
export { Pool, Scope, bounded, gate, config, setup, prepared, issueRequest, profile, snapshot, observe, gone, transaction, apply, policy, secondVersion, lossProxy, EXISTING_SESSION_VALIDATION_SQL };
export type { Prepared, QueryHook };

/** All three consumers share this domain. A jump is a labeled local-clock test,
 * never a claim that PostgreSQL wall time advanced or a session row was edited. */
export function sharedClock() {
    let offset = 0;
    const mono = performance.now.bind(performance), wall = Date.now.bind(Date);
    const schedule = setTimeout.bind(globalThis), cancel = clearTimeout.bind(globalThis);
    const clock: ModeSessionClock = {
        monotonic: () => mono() + offset,
        wall: () => wall() + offset,
        setTimer: (fn, ms) => schedule(fn, ms),
        clearTimer: handle => cancel(handle as ReturnType<typeof setTimeout>),
    };
    return { clock, advance(ms: number) { assert.ok(Number.isSafeInteger(ms) && ms >= 0); offset += ms; } };
}

export function world(scope: Scope, port?: number, hook?: QueryHook) {
    const time = sharedClock();
    const raw = scope.own(recordedPool(port, hook), r => bounded(r.shutdown()));
    const connect = raw.pool.connect;
    const acquisitions: Array<'pending' | 'resolved' | 'rejected'> = [];
    raw.pool.connect = async () => {
        assert.ok(acquisitions.length < 32);
        const index = acquisitions.length;
        acquisitions.push('pending');
        try {
            const result = await Reflect.apply(connect, raw.pool, []);
            acquisitions[index] = 'resolved';
            return result;
        } catch (error) {
            acquisitions[index] = 'rejected';
            throw error;
        }
    };
    const admission = scope.own(createLocalModeSessionAdmission(raw.pool), a => a.close());
    const repository = scope.own(__createModeSessionRepositoryForTests({ pool: admission.pool, profiles: [profile], clock: time.clock }), r => r.close());
    const validator = scope.own(createExistingModeSessionValidator({ pool: admission.pool, profiles: [profile], clock: time.clock }), v => v.close());
    const calls = { issue: 0, recover: 0, validate: 0 };
    const coordinator = scope.own(createModeSessionDeliveryCoordinator({
        profiles: [profile], clock: time.clock,
        repository: {
            issue: (...args) => { calls.issue++; return repository.issue(...args); },
            recoverIssue: (...args) => { calls.recover++; return repository.recoverIssue(...args); },
        },
        validator: { validateExisting: (...args) => { calls.validate++; return validator.validateExisting(...args); } },
    }), c => c.close());
    let closing: Promise<void> | undefined;
    return {
        raw, admission, repository, validator, coordinator, calls, time,
        acquisitions: () => acquisitions.slice(),
        close() {
            // This observes the approved shutdown ordering BEFORE fixture fallback.
            coordinator.close(); validator.close();
            return closing ??= bounded(Promise.all([repository.close(), admission.close()]).then(() => undefined));
        },
    };
}
export type World = ReturnType<typeof world>;
export function capability(w: World, p: Prepared): string {
    const out = w.coordinator.prepare(issueRequest(p));
    assert.equal(out.kind, 'prepared');
    if (out.kind !== 'prepared') throw Error('DELIVERY_FIXTURE_PREPARE');
    assert.deepEqual(Object.keys(out), ['kind', 'capability']);
    return out.capability;
}
export function delivery(out: DeliveryResult, p: Prepared) {
    assert.equal(out.kind, 'delivery');
    if (out.kind !== 'delivery') throw Error('DELIVERY_FIXTURE_BODY');
    assert.equal(out.issuance, 'known_committed');
    assert.deepEqual(Object.keys(out).sort(), ['body', 'deliveryId', 'issuance', 'kind']);
    assert.ok(Buffer.byteLength(out.body, 'utf8') <= 1049600);
    const body = JSON.parse(out.body);
    assert.deepEqual(Object.keys(body).sort(), ['deliveryId', 'receipt', 'schemaVersion', 'token']);
    assert.equal(body.schemaVersion, 1); assert.equal(body.deliveryId, out.deliveryId);
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
    createModeSessionContracts([profile]).issueReceipt(body.receipt, issueRequest(p));
    return { ...out, token: body.token as string, receipt: body.receipt };
}
export function status(out: DeliveryResult, code: string, certainty?: string) {
    assert.equal(out.kind, 'status');
    if (out.kind !== 'status') throw Error('DELIVERY_FIXTURE_STATUS');
    assert.deepEqual(Object.keys(out).sort(), ['code', 'issuance', 'kind', 'state']);
    assert.equal(out.code, code);
    if (certainty) assert.equal(out.issuance, certainty);
    return out;
}
export async function accepted(w: World, cap: string) {
    await observe(async () => {
        const out = await w.coordinator.wait(cap);
        return out.kind === 'status' && out.state === 'accepted';
    }, 'accepted lower continuation consumed', 4000);
}
export function commands(w: World) { return w.raw.records.flatMap(r => r.commands); }
export function validationOnly(w: World, from: number) {
    const allowed = new Set(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role', EXISTING_SESSION_VALIDATION_SQL, 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT']);
    const tail = commands(w).slice(from);
    assert.equal(tail.filter(q => q === EXISTING_SESSION_VALIDATION_SQL).length, 1);
    assert.ok(tail.every(q => allowed.has(q)));
}
export async function sessionRow(db: Pool, p: Prepared, value: ReturnType<typeof delivery>) {
    const rows = await db.query("select id::text,token_hash, to_char(issued_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') issued, to_char(expires_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') expires from public.mode_flow_sessions where tenant_id=$1", [p.f.tenant]);
    assert.equal(rows.rowCount, 1);
    assert.deepEqual(rows.rows[0], { id: value.receipt.sessionId, token_hash: tokenHash(value.token), issued: value.receipt.issuedAt, expires: value.receipt.expiresAt });
}

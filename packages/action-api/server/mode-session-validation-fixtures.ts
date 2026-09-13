/** Guarded native fixtures. Tokens and row contents are never written to diagnostics. */
import assert from 'node:assert/strict';
import { Pool, type PoolClient } from 'pg';
import { createLocalModeSessionAdmission } from './mode-session-admission.js';
import { __createModeSessionRepositoryForTests, type ModeSessionClock } from './mode-session-repository.js';
import { createExistingModeSessionValidator, EXISTING_SESSION_VALIDATION_SQL } from './mode-session-validation.js';
import { recordedPool, type QueryHook } from './mode-session-admission-fixtures.js';
import { config, setup, prepared, issueRequest, tokenHash, profile, snapshot, observe, blocked, gone, pid, holder, request, transaction, apply, policy, secondVersion, expiry, lossProxy, type Prepared } from './mode-session-transport-fixtures.js';
export { Pool, config, setup, prepared, issueRequest, profile, snapshot, observe, blocked, gone, pid, request, transaction, apply, policy, secondVersion, expiry, lossProxy, EXISTING_SESSION_VALIDATION_SQL };
export type { Prepared, QueryHook };
export const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
        resolve = r;
    });
    return {
        promise, resolve
    };
};
export async function bounded<T>(work: Promise<T>, ms = 12000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work, new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(Error('VALIDATION_FIXTURE_BOUND')), ms);
            })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
export class Scope {
    private entries: Array<() => Promise<unknown>> = [];
    own<T>(value: T, cleanup: (value: T) => unknown): T {
        assert.ok(this.entries.length < 64);
        let result: Promise<unknown> | undefined;
        this.entries.push(() => result ??= Promise.resolve().then(() => cleanup(value)));
        return value;
    }
    async close() {
        const results = await bounded(Promise.allSettled(this.entries.slice().reverse().map(f => f())));
        assert.ok(results.every(r => r.status === 'fulfilled'));
    }
}
export async function lock(scope: Scope, pool: Pool): Promise<PoolClient> {
    const c = await holder(pool), release = c.release;
    let done = false;
    const dispose = (error?: Error) => {
        if (!done) {
            done = true;
            Reflect.apply(release, c, [error]);
        }
    };
    scope.own(c, () => dispose(Error('VALIDATION_FIXTURE_DISCARD')));
    c.release = error => dispose(error instanceof Error ? error : undefined);
    return c;
}
export function world(scope: Scope, port?: number, hook?: QueryHook, clock?: ModeSessionClock) {
    const raw = scope.own(recordedPool(port, hook), r => r.shutdown());
    // Observe the real recorder promise before the facade can settle its public call.
    // No error/client payload is retained, and no acquisition result is substituted.
    const connect = raw.pool.connect;
    const acquisitions: Array<'pending' | 'resolved' | 'rejected'> = [];
    raw.pool.connect = async () => {
        assert.ok(acquisitions.length < 32, 'bounded native connection outcomes');
        const index = acquisitions.length;
        acquisitions.push('pending');
        try {
            const client = await Reflect.apply(connect, raw.pool, []);
            acquisitions[index] = 'resolved';
            return client;
        } catch (error) {
            acquisitions[index] = 'rejected';
            throw error;
        }
    };
    const admission = scope.own(createLocalModeSessionAdmission(raw.pool), a => a.close());
    const repository = scope.own(__createModeSessionRepositoryForTests({
        pool: admission.pool, profiles: [profile]
    }), r => r.close());
    const validator = scope.own(createExistingModeSessionValidator({
        pool: admission.pool, profiles: [profile], clock
    }), v => v.close());
    let closing: Promise<void> | undefined;
    return {
        raw, admission, repository, validator,
        acquisitions: () => acquisitions.slice(),
        close() {
            return closing ??= (async () => {
                validator.close();
                raw.cleanup();
                await Promise.all([repository.close(), admission.close()]);
                await raw.shutdown();
            })();
        }
    };
}
export type World = ReturnType<typeof world>;
export function accepted(out: any) {
    assert.equal(out.kind, 'committed');
    assert.equal(out.delivery, 'session');
    assert.ok(out.session);
    assert.equal(typeof out.token, 'string');
    return out;
}
export function validationInput(p: Prepared, out: ReturnType<typeof accepted>) {
    return {
        tokenHash: tokenHash(out.token), request: issueRequest(p), baseline: {
            sessionId: out.receipt.sessionId, issuedAt: out.receipt.issuedAt, expiresAt: out.receipt.expiresAt
        }
    };
}
export async function issued(w: World, p: Prepared) {
    return accepted(await w.repository.issue(issueRequest(p)));
}
export function data(out: any, receipt?: unknown) {
    assert.equal(out.kind, 'completed');
    assert.equal(out.delivery, 'data');
    if (receipt)
        assert.deepEqual(out.data, receipt);
    return out.data;
}
export function denied(out: any) {
    assert.deepEqual(out, {
        kind: 'failed', code: 'FORBIDDEN', data: null, transaction: 'no_commit_submitted', backendMayStillRun: true
    });
}
export function validationOnly(w: World, from: number) {
    const allowed = new Set(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role', EXISTING_SESSION_VALIDATION_SQL, 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT']);
    const rows = w.raw.records.slice(from);
    assert.ok(rows.length > 0);
    for (const r of rows) {
        assert.ok(r.commands.includes(EXISTING_SESSION_VALIDATION_SQL));
        assert.ok(r.commands.every(c => allowed.has(c)));
        assert.equal(r.releases, 1);
    }
}
export async function waiter(pool: Pool, w: World, after: number, by: number) {
    await observe(async () => w.raw.records.length > after, 'validation acquired native backend');
    const id = w.raw.records.at(-1)!.pid;
    await blocked(pool, id, by);
    return id;
}
export async function baselineFromDatabase(pool: Pool, input: ReturnType<typeof validationInput>) {
    const r = (await pool.query('select lumin.mode_session_stamp(issued_at) issued, lumin.mode_session_stamp(expires_at) expires from public.mode_flow_sessions where id=$1', [input.baseline.sessionId])).rows[0];
    assert.ok(r);
    return {
        ...input, baseline: {
            ...input.baseline, issuedAt: r.issued, expiresAt: r.expires
        }
    };
}

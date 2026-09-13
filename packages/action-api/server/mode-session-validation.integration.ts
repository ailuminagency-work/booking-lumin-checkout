/** Actual disposable PostgreSQL proof; author harness, independently reviewed before execution. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Scope, Pool, config, setup, prepared, issueRequest, snapshot, observe, blocked, gone, pid, request, transaction, apply, policy, secondVersion, expiry, lossProxy, EXISTING_SESSION_VALIDATION_SQL as SQL, gate, bounded, lock, world, issued, validationInput, data, denied, validationOnly, waiter, baselineFromDatabase } from './mode-session-validation-fixtures.js';
let faulted = false, cases = 0, stage = 'SETUP';
const failure = () => {
    faulted = true;
};
process.on('unhandledRejection', failure);
process.on('warning', failure);
const all = new Scope();
const group = async (name: string, body: (scope: Scope) => Promise<void>) => {
    stage = name;
    const scope = new Scope();
    try {
        await body(scope);
    }
    finally {
        await scope.close();
    }
    cases++;
    console.log('PASS ' + name);
};
try {
    const db = all.own(new Pool({
        ...config(), max: 6
    }), p => p.end());
    db.on('error', failure);
    await setup(db);
    assert.ok((await db.query("select to_regprocedure('public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamp with time zone,timestamp with time zone)') is not null ok")).rows[0].ok);
    await group('VALIDATION_NATIVE_01', async (scope) => {
        const w = world(scope);
        for (const v2 of [false, true]) {
            const p = await prepared(db, v2 ? 'hosted' : 'iframe', v2), out = await issued(w, p), input = validationInput(p, out), before = await snapshot(db, p.f.tenant), from = w.raw.records.length;
            data(await w.validator.validateExisting(input), out.receipt);
            assert.deepEqual(await snapshot(db, p.f.tenant), before);
            validationOnly(w, from);
            assert.equal(w.admission.snapshot().quarantined, 0);
            const accepted = await w.repository.submit(out.session, request(out.token));
            assert.equal(accepted.kind, 'committed');
            assert.equal((accepted as any).delivery, 'receipt');
            assert.equal((await snapshot(db, p.f.tenant)).mode_flow_sessions.length, 1);
        }
        assert.equal(w.raw.records[0]!.pid, w.raw.records[1]!.pid);
        assert.notEqual(w.raw.records[0]!.releaseIdentity, w.raw.records[1]!.releaseIdentity);
        await w.close();
    });
    await group('VALIDATION_NATIVE_02', async (scope) => {
        const w = world(scope), p = await prepared(db), out = await issued(w, p), input = validationInput(p, out), before = await snapshot(db, p.f.tenant), from = w.raw.records.length;
        const variants = [{
                ...input, tokenHash: 'f'.repeat(64)
            }, {
                ...input, baseline: {
                    ...input.baseline, sessionId: randomUUID()
                }
            }, {
                ...input, request: {
                    ...input.request, installationId: randomUUID()
                }
            }, {
                ...input, request: {
                    ...input.request, expectedVersionId: randomUUID()
                }
            }, {
                ...input, request: {
                    ...input.request, expectedPolicyRevision: 99
                }
            }];
        for (const v of variants)
            denied(await w.validator.validateExisting(v));
        assert.equal(w.admission.snapshot().quarantined, variants.length);
        validationOnly(w, from);
        assert.deepEqual(await snapshot(db, p.f.tenant), before);
        data(await w.validator.validateExisting(input), out.receipt);
        await w.close();
    });
    await group('VALIDATION_NATIVE_03', async (scope) => {
        // Actual owner target update preserves old session pin; policy updates do not.
        const w = world(scope), p = await prepared(db), out = await issued(w, p), input = validationInput(p, out);
        const next = await secondVersion(db, p.f);
        await transaction(db, c => apply(c, p.f, p.installed.installationId, p.published.versionId, next.versionId));
        data(await w.validator.validateExisting(input), out.receipt);
        await transaction(db, c => policy(c, p.f, p.installed.installationId, 1, true, ['https://different.example.test']));
        denied(await w.validator.validateExisting(input));
        await w.close();
        // Validator first: hold the genuine SELECT result while its transaction retains source locks.
        const p2 = await prepared(db), selected = gate(), release = gate();
        let armed = false;
        const first = world(scope, undefined, async (_c, sql, run) => {
            const r = await run();
            if (armed && sql === SQL) {
                selected.resolve();
                await release.promise;
            }
            return r;
        });
        scope.own(release, g => g.resolve());
        const accepted = await issued(first, p2), original = validationInput(p2, accepted);
        armed = true;
        const validating = first.validator.validateExisting(original);
        await bounded(selected.promise, 4000);
        const writer = await lock(scope, db);
        await writer.query("SET LOCAL idle_in_transaction_session_timeout='1s'");
        await writer.query('SET LOCAL ROLE service_role');
        const updating = policy(writer, p2.f, p2.installed.installationId, 1, false);
        void updating.catch(() => {
        });
        await blocked(db, pid(writer), first.raw.records.at(-1)!.pid);
        release.resolve();
        data(await validating, accepted.receipt);
        await updating;
        assert.equal((await writer.query('COMMIT')).command, 'COMMIT');
        writer.release();
        denied(await first.validator.validateExisting(original));
        await first.close();
        // Writer first: validator waits on actual owner-held flow lock and rechecks after commit.
        const p3 = await prepared(db), second = world(scope), accepted3 = await issued(second, p3), writer3 = await lock(scope, db);
        await writer3.query("SET LOCAL idle_in_transaction_session_timeout='1s'");
        await writer3.query('SET LOCAL ROLE service_role');
        await policy(writer3, p3.f, p3.installed.installationId, 1, false);
        const n = second.raw.records.length, pending = second.validator.validateExisting(validationInput(p3, accepted3));
        await waiter(db, second, n, pid(writer3));
        await writer3.query('COMMIT');
        writer3.release();
        denied(await pending);
        await second.close();
    });
    await group('VALIDATION_NATIVE_04', async (scope) => {
        for (const entity of ['tenant', 'flow', 'service'] as const) {
            const p = await prepared(db), w = world(scope), out = await issued(w, p), input = validationInput(p, out), writer = await lock(scope, db);
            const sql = entity === 'tenant' ? "update public.tenants set status='suspended' where id=$1" : entity === 'flow' ? "update public.flows set status='archived' where id=$1" : 'update public.services set active=false where id=$1';
            const entityId = entity === 'tenant' ? p.f.tenant : entity === 'flow' ? p.f.flow : p.f.service;
            await writer.query(sql, [entityId]);
            const n = w.raw.records.length, pending = w.validator.validateExisting(input);
            await waiter(db, w, n, pid(writer));
            await writer.query('COMMIT');
            writer.release();
            denied(await pending);
            await w.close();
            // Validator-first active source read blocks the same entity's actual status writer.
            const p2 = await prepared(db), selected = gate(), release = gate();
            let armed = false;
            const first = world(scope, undefined, async (_c, text, run) => {
                const r = await run();
                if (armed && text === SQL) {
                    selected.resolve();
                    await release.promise;
                }
                return r;
            });
            scope.own(release, g => g.resolve());
            const accepted = await issued(first, p2), vinput = validationInput(p2, accepted);
            armed = true;
            const validating = first.validator.validateExisting(vinput);
            await bounded(selected.promise, 4000);
            const secondWriter = await lock(scope, db), id2 = entity === 'tenant' ? p2.f.tenant : entity === 'flow' ? p2.f.flow : p2.f.service;
            const updating = secondWriter.query(sql, [id2]);
            void updating.catch(() => {
            });
            await blocked(db, pid(secondWriter), first.raw.records.at(-1)!.pid);
            release.resolve();
            data(await validating, accepted.receipt);
            await updating;
            await secondWriter.query('COMMIT');
            secondWriter.release();
            denied(await first.validator.validateExisting(vinput));
            await first.close();
        }
        // Actual accepted submit first: its real RPC holds the session UPDATE lock before COMMIT.
        const p = await prepared(db), w = world(scope), out = await issued(w, p), input = validationInput(p, out), holder = await lock(scope, db);
        await holder.query("SET LOCAL idle_in_transaction_session_timeout='1s'");
        await holder.query('SET LOCAL ROLE service_role');
        await holder.query('select public.mode_submit_flow_request($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)', [input.tokenHash, input.request.rendererOrigin, input.request.parentOrigin, randomUUID(), JSON.stringify({
                count: {
                    quantity: 2
                }
            }), JSON.stringify({
                name: 'Local fixture', email: 'submit-first@example.test'
            }), new Date(Date.now() + 3600000).toISOString()]);
        const n = w.raw.records.length, pending = w.validator.validateExisting(input);
        await waiter(db, w, n, pid(holder));
        await holder.query('COMMIT');
        holder.release();
        data(await pending, out.receipt);
        // Opposite order: validator SHARE lock blocks the accepted submit RPC's session UPDATE.
        const selected = gate(), release = gate();
        let armed = false;
        const reader = world(scope, undefined, async (_c, sql, run) => {
            const r = await run();
            if (armed && sql === SQL) {
                selected.resolve();
                await release.promise;
            }
            return r;
        });
        scope.own(release, g => g.resolve());
        const accepted = await issued(reader, p), vinput = validationInput(p, accepted);
        armed = true;
        const reading = reader.validator.validateExisting(vinput);
        await bounded(selected.promise, 4000);
        const writer = await lock(scope, db);
        await writer.query("SET LOCAL idle_in_transaction_session_timeout='1s'");
        await writer.query('SET LOCAL ROLE service_role');
        const args = [vinput.tokenHash, vinput.request.rendererOrigin, vinput.request.parentOrigin, randomUUID(), JSON.stringify({
                count: {
                    quantity: 2
                }
            }), JSON.stringify({
                name: 'Local fixture', email: 'native-validation@example.test'
            }), new Date(Date.now() + 3600000).toISOString()];
        const submitting = writer.query('select public.mode_submit_flow_request($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)', args);
        void submitting.catch(() => {
        });
        await blocked(db, pid(writer), reader.raw.records.at(-1)!.pid);
        release.resolve();
        data(await reading, accepted.receipt);
        await submitting;
        await writer.query('COMMIT');
        writer.release();
        await reader.close();
        await w.close();
    });
    await group('VALIDATION_NATIVE_05', async (scope) => {
        // Trusted coherent timestamp adjustment is a fixture only. A fixed local wall fifteen minutes earlier gives the local validator its full ten-second budget, isolating SQL expiry proof without suppressing native timers.
        for (const boundary of ['service', 'render'] as const)
            for (const expires of [false, true]) {
                const p = await prepared(db), fixedWall = Date.now() - 900000, clock = {
                    monotonic: () => 0, wall: () => fixedWall, setTimer: (f: () => void, ms: number) => setTimeout(f, ms), clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)
                };
                const w = world(scope, undefined, undefined, clock), out = await issued(w, p), original = validationInput(p, out);
                await expiry(db, out.receipt.sessionId, expires ? 2 : 4);
                const input = await baselineFromDatabase(db, original);
                const holder = await lock(scope, db);
                if (boundary === 'service')
                    await holder.query('select id from public.services where id=$1 for update', [p.f.service]);
                else
                    await holder.query('lock table public.flow_versions in access exclusive mode');
                const n = w.raw.records.length, pending = w.validator.validateExisting(input);
                const waiting = await waiter(db, w, n, pid(holder));
                if (boundary === 'render')
                    assert.equal((await db.query("select exists(select 1 from pg_locks where pid=$1 and relation='public.mode_flow_sessions'::regclass and mode='RowShareLock' and granted) ok", [waiting])).rows[0].ok, true, 'session lock precedes blocked render');
                if (expires)
                    await observe(async () => (await db.query('select clock_timestamp()>=$1::timestamptz expired', [input.baseline.expiresAt])).rows[0].expired, 'real database expiry reached', 3500);
                await holder.query('ROLLBACK');
                holder.release();
                const outcome = await pending;
                if (expires)
                    denied(outcome);
                else {
                    const receipt = data(outcome);
                    assert.equal(receipt.sessionId, input.baseline.sessionId);
                    assert.equal(receipt.expiresAt, input.baseline.expiresAt);
                }
                assert.equal((await snapshot(db, p.f.tenant)).mode_flow_sessions.length, 1);
                await w.close();
            }
    });
    await group('VALIDATION_NATIVE_06', async (scope) => {
        const p = await prepared(db), proxy = scope.own(await lossProxy('COMMIT', false), x => x.close()), w = world(scope, proxy.port), out = await issued(w, p), input = validationInput(p, out), before = await snapshot(db, p.f.tenant);
        proxy.arm();
        const lost = await w.validator.validateExisting(input);
        assert.deepEqual(lost, {
            kind: 'completion_uncertain', code: 'READ_COMPLETION_UNCERTAIN', data: null, backendMayStillRun: true
        });
        assert.ok(proxy.sawTag && proxy.sawReady);
        assert.deepEqual(proxy.errors, []);
        await gone(db, w.raw.records.at(-1)!.pid);
        assert.deepEqual(await snapshot(db, p.f.tenant), before);
        data(await w.validator.validateExisting(input), out.receipt);
        await w.close();
        let armed = false;
        const rolled = world(scope, undefined, async (c, sql, run) => {
            if (armed && sql === 'COMMIT') {
                armed = false;
                await c.query('select 1/0').catch(() => {
                });
            }
            return run();
        });
        const prior = await issued(rolled, p), v = validationInput(p, prior);
        armed = true;
        assert.deepEqual(await rolled.validator.validateExisting(v), {
            kind: 'failed', code: 'INTERNAL_ERROR', data: null, transaction: 'rolled_back', backendMayStillRun: false
        });
        data(await rolled.validator.validateExisting(v), prior.receipt);
        await rolled.close();
        const commitSeen = gate(), release = gate();
        let delay = false;
        const late = world(scope, undefined, async (_c, sql, run) => {
            const r = await run();
            if (delay && sql === 'COMMIT') {
                delay = false;
                commitSeen.resolve();
                await release.promise;
            }
            return r;
        });
        scope.own(release, g => g.resolve());
        const priorLate = await issued(late, p), lateInput = validationInput(p, priorLate), abort = new AbortController();
        delay = true;
        const pending = late.validator.validateExisting(lateInput, {
            signal: abort.signal
        });
        await bounded(commitSeen.promise, 4000);
        abort.abort();
        assert.equal((await pending).kind, 'completion_uncertain');
        data(await late.validator.validateExisting(lateInput), priorLate.receipt);
        const state = late.admission.snapshot();
        release.resolve();
        await observe(async () => late.raw.records.every(r => r.pending === 0), 'late actual COMMIT callback settled');
        assert.deepEqual(late.admission.snapshot(), state);
        await late.close();
    });
    await group('VALIDATION_NATIVE_07', async (scope) => {
        const p = await prepared(db), w = world(scope), out = await issued(w, p), input = validationInput(p, out), before = await snapshot(db, p.f.tenant), n = w.raw.records.length;
        for (let i = 0; i < 8; i++) {
            denied(await w.validator.validateExisting({
                ...input, tokenHash: 'f'.repeat(64)
            }));
            await gone(db, w.raw.records.at(-1)!.pid);
            assert.equal(w.admission.snapshot().quarantined, i + 1);
        }
        const connections = w.raw.counts().connects;
        assert.deepEqual(await w.validator.validateExisting(input), {
            kind: 'failed', code: 'CONNECTION_FAILED', data: null, transaction: 'not_started', backendMayStillRun: false
        });
        assert.equal(w.raw.counts().connects, connections);
        validationOnly(w, n);
        assert.deepEqual(await snapshot(db, p.f.tenant), before);
        await w.close();
    });
    await group('VALIDATION_NATIVE_08', async (scope) => {
        const p = await prepared(db), w = world(scope), out = await issued(w, p), holder = await lock(scope, db);
        await holder.query('select id from public.services where id=$1 for update', [p.f.service]);
        const n = w.raw.records.length, pending = w.validator.validateExisting(validationInput(p, out));
        const backend = await waiter(db, w, n, pid(holder));
        assert.equal(w.validator.close(), undefined);
        assert.deepEqual(await pending, {
            kind: 'failed', code: 'CLOSED', data: null, transaction: 'no_commit_submitted', backendMayStillRun: true
        });
        assert.equal(w.raw.counts().ends, 0);
        await gone(db, backend);
        await holder.query('ROLLBACK');
        holder.release();
        // Validator stop alone does not stop sibling repository operations.
        await issued(w, p);
        assert.equal(w.raw.counts().ends, 0);
        const repositoryClose = w.repository.close(), facadeClose = w.admission.close();
        await Promise.all([repositoryClose, facadeClose]);
        assert.equal(w.raw.counts().ends, 1);
        assert.equal(w.admission.snapshot().accepting, false);
        // Observe the actual queued connection fate; native pool.end may cause rejection.
        const queued = world(scope), held = await queued.admission.pool.connect();
        await held.query('BEGIN');
        await held.query('COMMIT');
        const acquiring = queued.validator.validateExisting(validationInput(p, out));
        await observe(async () => queued.raw.counts().connects === 2, 'queued native acquisition');
        assert.deepEqual(queued.acquisitions(), ['resolved', 'pending']);
        queued.validator.close();
        assert.equal((await acquiring).kind, 'failed');
        const repoEnd = queued.repository.close(), admissionEnd = queued.admission.close();
        assert.equal(queued.raw.counts().ends, 1);
        // Fixture release happens AFTER observing genuine composition shutdown, never as proof of drain.
        held.release(Error('VALIDATION_FIXTURE_RELEASE'));
        await Promise.all([repoEnd, admissionEnd]);
        await observe(async () => queued.acquisitions()[1] !== 'pending', 'actual queued native connection settled');
        const fate = queued.acquisitions();
        assert.equal(fate.length, 2);
        if (fate[1] === 'rejected') {
            assert.deepEqual(fate, ['resolved', 'rejected']);
            assert.equal(queued.raw.records.length, 1);
            console.log('OBSERVED VALIDATION_NATIVE_08_ACQUISITION_REJECTED');
        } else {
            assert.deepEqual(fate, ['resolved', 'resolved']);
            assert.equal(queued.raw.records.length, 2);
            const late = queued.raw.records[1]!;
            await observe(async () => late.releases === 1, 'late delivered native client discarded');
            assert.equal(late.badReleases, 1);
            assert.equal(late.pending, 0);
            assert.deepEqual(late.commands, []);
            console.log('OBSERVED VALIDATION_NATIVE_08_ACQUISITION_DELIVERED_DISCARDED');
        }
        assert.equal(queued.raw.records[0]!.releases, 1);
        assert.equal(queued.admission.snapshot().accepting, false);
    });
    assert.equal(cases, 8);
}
catch {
    faulted = true;
}
finally {
    try {
        await all.close();
    }
    catch {
        faulted = true;
    }
    process.removeListener('unhandledRejection', failure);
    process.removeListener('warning', failure);
}
if (faulted) {
    console.log('FAIL VALIDATION_NATIVE_' + stage);
    process.exitCode = 1;
}
else
    console.log('PASS native validation suite 8 groups');

/** Six genuine native groups; author harness requires independent review before execution. */
import assert from 'node:assert/strict';
import { Scope, Pool, config, setup, prepared, snapshot, observe, gone, transaction, apply, policy, secondVersion, lossProxy, EXISTING_SESSION_VALIDATION_SQL as SQL, bounded, gate, world, capability, delivery, status, accepted, commands, validationOnly, sessionRow } from './mode-session-delivery-fixtures.js';
let faulted = false, groups = 0, stage = 'SETUP';
const fault = () => { faulted = true; };
process.on('warning', fault); process.on('unhandledRejection', fault);
const all = new Scope();
async function group(name: string, body: (scope: Scope) => Promise<void>) {
    stage = name;
    const scope = new Scope();
    try { await bounded(body(scope), 45000); }
    finally { await scope.close(); }
    groups++; console.log('PASS ' + name);
}
try {
    const db = all.own(new Pool({ ...config(), max: 4 }), p => bounded(p.end()));
    db.on('error', fault);
    await setup(db);
    assert.ok((await db.query("select to_regprocedure('public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamp with time zone,timestamp with time zone)') is not null ok")).rows[0].ok);
    await group('DELIVERY_NATIVE_01', async scope => {
        const w = world(scope);
        for (const v2 of [false, true]) {
            const p = await prepared(db, v2 ? 'iframe' : 'hosted', v2);
            const before = await snapshot(db, p.f.tenant), n = commands(w).length;
            const cap = capability(w, p);
            assert.equal(commands(w).length, n);
            assert.deepEqual(w.calls, { issue: v2 ? 1 : 0, recover: 0, validate: v2 ? 1 : 0 });
            assert.deepEqual(await snapshot(db, p.f.tenant), before);
            const first = delivery(await w.coordinator.issue(cap), p);
            await sessionRow(db, p, first);
            const after = await snapshot(db, p.f.tenant), from = commands(w).length;
            const again = delivery(await w.coordinator.deliver(cap), p);
            assert.equal(again.body, first.body); assert.equal(again.deliveryId, first.deliveryId);
            assert.deepEqual(await snapshot(db, p.f.tenant), after); validationOnly(w, from);
            const count = commands(w).length;
            status(w.coordinator.acknowledge(cap, first.deliveryId), 'ACKED', 'known_committed');
            status(await w.coordinator.deliver(cap), 'ACKED', 'known_committed');
            assert.equal(commands(w).length, count);
        }
        assert.deepEqual(w.calls, { issue: 2, recover: 0, validate: 2 });
        assert.equal(w.admission.snapshot().quarantined, 0);
        await w.close(); assert.equal(w.raw.counts().ends, 1);
    });
    await group('DELIVERY_NATIVE_02', async scope => {
        const committed = gate(), release = scope.own(gate(), g => g.resolve());
        let delay = true;
        const w = world(scope, undefined, async (_client, text, run) => {
            const result = await run();
            if (delay && text === 'COMMIT') {
                delay = false; assert.equal(result.command, 'COMMIT');
                committed.resolve(); await bounded(release.promise, 8000);
            }
            return result;
        });
        const p = await prepared(db), cap = capability(w, p), abort = new AbortController();
        const pending = w.coordinator.issue(cap, { signal: abort.signal });
        await bounded(committed.promise, 4000);
        const before = await snapshot(db, p.f.tenant);
        assert.equal(before.mode_flow_sessions.length, 1);
        abort.abort(); status(await pending, 'WAIT_CANCELLED');
        assert.equal(w.raw.records[0]!.pending, 1);
        release.resolve(); await accepted(w, cap);
        const from = commands(w).length;
        const recovered = delivery(await w.coordinator.deliver(cap), p);
        validationOnly(w, from); await sessionRow(db, p, recovered);
        assert.deepEqual(await snapshot(db, p.f.tenant), before);
        assert.deepEqual(w.calls, { issue: 1, recover: 0, validate: 1 });
        await w.close();
    });
    await group('DELIVERY_NATIVE_03', async scope => {
        for (const tag of ['COMMIT', 'ROLLBACK'] as const) {
            const proxy = scope.own(await lossProxy(tag), p => bounded(p.close()));
            let inject = tag === 'ROLLBACK', injected = false;
            const w = world(scope, proxy.port, async (client, text, run) => {
                if (inject && text === 'COMMIT') {
                    inject = false;
                    try { await client.query('select 1/0'); }
                    catch (error) { assert.equal((error as {code?: string}).code, '22012'); injected = true; }
                    assert.equal(injected, true);
                }
                return run();
            });
            const p = await prepared(db), cap = capability(w, p);
            status(await w.coordinator.issue(cap), 'RECOVERY_REQUIRED', 'unknown');
            assert.ok(proxy.sawTag && proxy.sawReady); assert.deepEqual(proxy.errors, []);
            assert.equal(injected, tag === 'ROLLBACK');
            await gone(db, w.raw.records[0]!.pid);
            const prior = await snapshot(db, p.f.tenant);
            assert.equal(prior.mode_flow_sessions.length, tag === 'COMMIT' ? 1 : 0);
            assert.equal(w.admission.snapshot().quarantined, 1);
            assert.equal(commands(w).filter(q => q === 'COMMIT').length, 1);
            const reconciled = delivery(await w.coordinator.recover(cap), p);
            await sessionRow(db, p, reconciled);
            const after = await snapshot(db, p.f.tenant);
            assert.equal(after.mode_flow_sessions.length, 1);
            if (tag === 'COMMIT') assert.deepEqual(after, prior);
            else for (const key of Object.keys(prior)) if (key !== 'mode_flow_sessions') assert.deepEqual(after[key], prior[key]);
            assert.deepEqual(w.calls, { issue: 1, recover: 1, validate: 0 });
            assert.equal(w.admission.snapshot().quarantined, 1);
            console.log('OBSERVED DELIVERY_NATIVE_03_' + tag + '_WIRE_LOST');
            await w.close();
        }
    });
    await group('DELIVERY_NATIVE_04', async scope => {
        const w = world(scope), p = await prepared(db), cap = capability(w, p);
        const first = delivery(await w.coordinator.issue(cap), p);
        const next = await secondVersion(db, p.f);
        await transaction(db, c => apply(c, p.f, p.installed.installationId, p.published.versionId, next.versionId));
        const before = await snapshot(db, p.f.tenant), from = commands(w).length;
        assert.equal(delivery(await w.coordinator.deliver(cap), p).body, first.body);
        validationOnly(w, from); assert.deepEqual(await snapshot(db, p.f.tenant), before);
        await transaction(db, c => policy(c, p.f, p.installed.installationId, 1, false));
        const deniedBefore = await snapshot(db, p.f.tenant), denyFrom = commands(w).length;
        status(await w.coordinator.deliver(cap), 'VALIDATION_UNAVAILABLE', 'known_committed');
        validationOnly(w, denyFrom); assert.deepEqual(await snapshot(db, p.f.tenant), deniedBefore);
        assert.deepEqual(w.calls, { issue: 1, recover: 0, validate: 2 });
        assert.equal(w.admission.snapshot().quarantined, 1);
        await w.close();
    });
    await group('DELIVERY_NATIVE_05', async scope => {
        for (const action of ['ACK', 'CLOSE', 'EXPIRY'] as const) {
            const committed = gate(), release = scope.own(gate(), g => g.resolve());
            let armed = false;
            const w = world(scope, undefined, async (_client, text, run) => {
                const result = await run();
                if (armed && text === 'COMMIT') {
                    armed = false; assert.equal(result.command, 'COMMIT');
                    committed.resolve(); await bounded(release.promise, 8000);
                }
                return result;
            });
            const p = await prepared(db), cap = capability(w, p);
            const first = delivery(await w.coordinator.issue(cap), p);
            const before = await snapshot(db, p.f.tenant);
            armed = true; const from = commands(w).length;
            const pending = w.coordinator.deliver(cap);
            await bounded(committed.promise, 4000);
            const code = action === 'ACK' ? 'ACKED' : action === 'CLOSE' ? 'CLOSED' : 'EXPIRED';
            if (action === 'ACK') status(w.coordinator.acknowledge(cap, first.deliveryId), code, 'known_committed');
            else if (action === 'CLOSE') w.coordinator.close();
            else {
                // Shared trusted clock jump only; no SQL row or receipt rewriting.
                w.time.advance(900000);
                status(await w.coordinator.wait(cap), code, 'known_committed');
            }
            const settled = await pending; status(settled, code, 'known_committed');
            await observe(async () => w.admission.snapshot().quarantined === 1, 'aborted read retains admission charge', 4000);
            const retained = w.admission.snapshot();
            assert.equal(w.raw.records.at(-1)!.pending, 1);
            release.resolve();
            await observe(async () => w.raw.records.every(r => r.pending === 0), 'actual late COMMIT result consumed', 4000);
            assert.deepEqual(w.admission.snapshot(), retained);
            status(settled, code, 'known_committed');
            const after = await w.coordinator.deliver(cap);
            assert.equal(after.kind, 'status');
            if (after.kind === 'status') assert.ok(after.code === code || after.code === 'UNAVAILABLE');
            validationOnly(w, from);
            assert.deepEqual(await snapshot(db, p.f.tenant), before);
            assert.deepEqual(w.calls, { issue: 1, recover: 0, validate: 1 });
            console.log('OBSERVED DELIVERY_NATIVE_05_' + action + '_LATE_NO_DELIVERY');
            await w.close();
        }
    });
    await group('DELIVERY_NATIVE_06', async scope => {
        const w = world(scope), p = await prepared(db), cap = capability(w, p);
        const held = await w.admission.pool.connect();
        scope.own(held, c => { if (w.raw.records[0]!.releases === 0) c.release(Error('DELIVERY_FIXTURE_DISCARD')); });
        assert.equal((await held.query('BEGIN')).command, 'BEGIN');
        assert.equal((await held.query('COMMIT')).command, 'COMMIT');
        const pending = w.coordinator.issue(cap);
        await observe(async () => w.raw.counts().connects === 2, 'actual queued issuance acquisition', 4000);
        assert.deepEqual(w.acquisitions(), ['resolved', 'pending']);
        w.coordinator.close();
        status(await pending, 'CLOSED', 'unknown');
        assert.equal(w.raw.counts().ends, 0);
        w.validator.close();
        const repositoryClose = w.repository.close(), admissionClose = w.admission.close();
        assert.equal(w.raw.counts().ends, 1);
        // Deliberate fixture release follows the observed composition stop/end,
        // and is not evidence that coordinator.close drained native resources.
        held.release(Error('DELIVERY_FIXTURE_RELEASE'));
        await bounded(Promise.all([repositoryClose, admissionClose]));
        await observe(async () => w.acquisitions()[1] !== 'pending', 'actual queued acquisition fate', 5000);
        const fate = w.acquisitions(); assert.equal(fate.length, 2);
        if (fate[1] === 'rejected') {
            assert.deepEqual(fate, ['resolved', 'rejected']); assert.equal(w.raw.records.length, 1);
            console.log('OBSERVED DELIVERY_NATIVE_06_ACQUISITION_REJECTED');
        } else {
            assert.deepEqual(fate, ['resolved', 'resolved']); assert.equal(w.raw.records.length, 2);
            const late = w.raw.records[1]!;
            await observe(async () => late.releases === 1, 'late native client discarded', 4000);
            assert.equal(late.badReleases, 1); assert.equal(late.pending, 0); assert.deepEqual(late.commands, []);
            console.log('OBSERVED DELIVERY_NATIVE_06_ACQUISITION_DELIVERED_DISCARDED');
        }
        assert.equal(w.raw.records[0]!.releases, 1);
        assert.equal(w.admission.snapshot().accepting, false);
        const calls = { ...w.calls }, count = commands(w).length;
        const denied = await w.coordinator.issue(cap); assert.equal(denied.kind, 'status');
        assert.deepEqual(w.calls, calls); assert.equal(commands(w).length, count);
        await w.close(); assert.equal(w.raw.counts().ends, 1);
    });
    assert.equal(groups, 6);
} catch { faulted = true; }
finally {
    try { await all.close(); } catch { faulted = true; }
    process.removeListener('warning', fault); process.removeListener('unhandledRejection', fault);
}
if (faulted) { console.log('FAIL DELIVERY_NATIVE_' + stage); process.exitCode = 1; }
else console.log('PASS native delivery suite 6 groups');

/** Independent actual HTTP/PostgreSQL journey. Root owns CREATE-only migration setup. */
import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
let phase = 'startup', finished = false;
process.on('uncaughtException', () => { writeSync(2, 'MODE_OWNER_UNCAUGHT_' + phase + '\n'); process.exit(1); });
process.on('unhandledRejection', () => { writeSync(2, 'MODE_OWNER_REJECTION_' + phase + '\n'); process.exit(1); });
process.on('beforeExit', () => { if (!finished) {
    writeSync(2, 'MODE_OWNER_INCOMPLETE_' + phase + '\n');
    process.exitCode = 1;
} });
process.on('exit', code => writeSync(2, JSON.stringify({ category: 'MODE_OWNER_HTTP_TERMINAL', phase, code, finished }) + '\n'));
import { startModeOwnerLocal, __startModeOwnerLocalForTests } from './mode-owner-local.js';
import { __createModeOwnerHttpServerForTests } from './mode-owner-http.js';
import { Pool, type PoolConfig } from 'pg';
import { createLocalModeOwnerComposition, __createModeOwnerCompositionForTests } from './mode-owner-composition.js';
import { observer, world, endpoints, profile, config, transaction, call, wire, ownerHeaders, committed, completed, failure, state, id, boundedClose, waitFor, deferred, ready, observeOwnerWait, disconnectable, truncatedReply, ownerPoolConfig, seedOwnerRequests, type World } from './mode-owner-journey-fixtures.js';
async function main() {
    const db = await observer();
    const addresses = endpoints();
    let service: Awaited<ReturnType<typeof startModeOwnerLocal>> | undefined, cases = 0;
    const pass = (code: string) => { cases++; phase = code; process.stdout.write('PASS ' + code + '\n'); };
    async function start(w: World, profiles = [profile]) { service = await startModeOwnerLocal({ profiles, credentials: w.credentials, localPortalOrigin: addresses.portal }); }
    async function stop() { if (service) {
        const s = service;
        service = undefined;
        await boundedClose(() => s.close());
    } }
    const listing = (w: World) => ({ tenantId: w.f.tenant, flowId: w.f.flow, afterId: null, limit: 100 });
    const publishing = (w: World, revision = w.revision) => ({ tenantId: w.f.tenant, flowId: w.f.flow, expectedDraftRevision: revision, idempotencyKey: id() });
    function installation(w: World, versionId: string, mode: 'hosted' | 'iframe' = 'hosted') { return { tenantId: w.f.tenant, flowId: w.f.flow, versionId, expectedPublishedVersionId: versionId, mode, deploymentProfileVersion: profile.profileVersion, allowedParentOrigins: mode === 'hosted' ? [] : ['https://merchant.example.test'], idempotencyKey: id() }; }
    try {
        for (const v2 of [false, true]) {
            phase = v2 ? 'v2-fixture' : 'v1-fixture';
            const w = await world(db, v2);
            await start(w);
            const initial = await state(db, w.f);
            const path = `/api/${v2 ? 'configurable-flows' : 'flows'}/${w.f.flow}/draft?tenantId=${w.f.tenant}`;
            const save = { serviceId: w.f.service, expectedRevision: w.revision, name: 'Owner saved through actual draft HTTP', ...(v2 ? { authoring: { authoringVersion: 2, config, questionOverrides: {} } } : { config }) };
            const saved = await wire(addresses.draft, path, { body: save, headers: ownerHeaders(w.credential) });
            assert.equal(saved.status, 200);
            assert.equal(saved.body.ok, true);
            w.revision++;
            const request = publishing(w), pub = committed(await call(addresses.owner, 'publish', w.credential, request));
            assert.equal(pub.sourceRevision, w.revision);
            let current = await state(db, w.f);
            assert.equal((current.mode_flow_installations as any[]).length, 0);
            assert.equal((current.flow_installations as any[]).length, 0);
            const listReply = await wire(addresses.draft, `/api/${v2 ? 'configurable-flows' : 'flows'}?tenantId=${w.f.tenant}`, { method: 'GET', headers: ownerHeaders(w.credential) });
            assert.equal(listReply.status, 200);
            assert.ok(JSON.stringify(listReply.body).includes(pub.versionId));
            const hosted = committed(await call(addresses.owner, 'install', w.credential, installation(w, pub.versionId)));
            const embedded = committed(await call(addresses.owner, 'install', w.credential, installation(w, pub.versionId, 'iframe')));
            assert.notEqual(hosted.installationId, embedded.installationId);
            const listed = completed(await call(addresses.owner, 'installations', w.credential, listing(w)));
            assert.equal(listed.installations.length, 2);
            const history = completed(await call(addresses.owner, 'installation-history', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, installationId: hosted.installationId, beforeSequence: null, limit: 100 }));
            assert.equal(history.history.length, 1);
            current = await state(db, w.f);
            for (const table of ['mode_flow_sessions', 'mode_flow_requests', 'bookings', 'customers', 'payments', 'capacity_holds'])
                assert.deepEqual(current[table], initial[table]);
            await stop();
            await start(w);
            const reopened = completed(await call(addresses.owner, 'installations', w.credential, listing(w)));
            assert.deepEqual(reopened, listed);
            pass(v2 ? 'owner-http-v2-persisted-publication-installation' : 'owner-http-v1-persisted-publication-installation');
            const save2 = await wire(addresses.draft, path, { body: { ...save, expectedRevision: w.revision }, headers: ownerHeaders(w.credential) });
            assert.equal(save2.status, 200);
            w.revision++;
            const pub2 = committed(await call(addresses.owner, 'publish', w.credential, publishing(w)));
            assert.notEqual(pub2.versionId, pub.versionId);
            failure(await call(addresses.owner, 'install', w.credential, installation(w, pub.versionId)), 'CONFLICT');
            const beforeApply = completed(await call(addresses.owner, 'installations', w.credential, listing(w)));
            assert.ok(beforeApply.installations.every((x: any) => x.currentVersionId === pub.versionId));
            const applied = committed(await call(addresses.owner, 'apply-version', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, installationId: hosted.installationId, expectedTargetRevision: 1, expectedCurrentVersionId: pub.versionId, newVersionId: pub2.versionId, idempotencyKey: id() }));
            assert.equal(applied.installationId, hosted.installationId);
            assert.equal(applied.targetRevision, 2);
            failure(await call(addresses.owner, 'apply-version', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, installationId: hosted.installationId, expectedTargetRevision: 1, expectedCurrentVersionId: pub.versionId, newVersionId: pub2.versionId, idempotencyKey: id() }), 'CONFLICT');
            const policy = { tenantId: w.f.tenant, flowId: w.f.flow, installationId: hosted.installationId, expectedPolicyRevision: 1, enabled: false, allowedParentOrigins: [], idempotencyKey: id() };
            const disabled = committed(await call(addresses.owner, 'update-policy', w.credential, policy));
            assert.equal(disabled.policyRevision, 2);
            const recovered = completed(await call(addresses.owner, 'operation', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, operation: 'policy', idempotencyKey: policy.idempotencyKey }));
            assert.deepEqual(recovered, disabled);
            for (const bad of [w.credentials[2]!, w.credentials[3]!])
                failure(await call(addresses.owner, 'installations', bad.credential, listing(w)), 'FORBIDDEN');
            const revokedState = await state(db, w.f);
            await db.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2", [w.f.tenant, w.f.actor]);
            failure(await call(addresses.owner, 'operation', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, operation: 'policy', idempotencyKey: policy.idempotencyKey }), 'FORBIDDEN');
            assert.deepEqual(await state(db, w.f), revokedState);
            await db.query("update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=$1 and user_id=$2", [w.f.tenant, w.f.actor]);
            await db.query("update public.flows set status='archived' where tenant_id=$1 and id=$2", [w.f.tenant, w.f.flow]);
            failure(await call(addresses.owner, 'operation', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, operation: 'policy', idempotencyKey: policy.idempotencyKey }), 'UNAVAILABLE');
            const bookings = completed(await call(addresses.owner, 'request-history', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, beforeCreatedAt: null, beforeBookingId: null, limit: 100 }));
            assert.deepEqual(bookings.requests, []);
            pass(v2 ? 'owner-http-v2-cas-authority-archive' : 'owner-http-v1-cas-authority-archive');
            await stop();
        }
        {
            const w = await world(db);
            await start(w);
            const before = await state(db, w.f), body = publishing(w);
            const path = '/api/local/mode-owner/publish';
            for (const origin of [undefined, 'null', 'https://foreign.example.test']) {
                const reply = await wire(addresses.owner, path, { body, headers: { Authorization: `Bearer ${w.credential}`, ...(origin ? { Origin: origin } : {}) } });
                assert.equal(reply.status, 403);
                assert.equal(reply.headers['access-control-allow-origin'], undefined);
            }
            for (const headers of [{ Origin: addresses.portal }, { ...ownerHeaders(w.credential), Cookie: 'ambient=x' }, { ...ownerHeaders(w.credential), 'Content-Type': 'text/plain' }, { ...ownerHeaders(w.credential), Host: 'foreign.example.test' }]) {
                const r = await wire(addresses.owner, path, { body, headers });
                assert.ok(r.status >= 400);
                assert.equal(r.body.phase, 'not_dispatched');
            }
            for (const badPath of [path + '/', path + '?x=1', '/api/local/mode-owner/%70ublish', '//api/local/mode-owner/publish']) {
                const denied = await wire(addresses.owner, badPath, { body, headers: ownerHeaders(w.credential) });
                assert.equal(denied.status, 400);
                assert.equal(denied.body.error.code, 'INVALID_HTTP');
            }
            assert.equal((await call(addresses.owner, 'unknown', w.credential, body)).status, 404);
            for (const key of ['actor', 'userId', 'credential'])
                assert.ok((await call(addresses.owner, 'publish', w.credential, { ...body, [key]: w.f.actor })).status >= 400);
            const pre = await wire(addresses.owner, path, { method: 'OPTIONS', headers: { Origin: addresses.portal, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
            assert.equal(pre.status, 204);
            const forbidden = await wire(addresses.owner, path, { method: 'OPTIONS', headers: { Origin: addresses.portal, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization,x-actor' } });
            assert.equal(forbidden.status, 403);
            assert.equal((await wire(addresses.owner, path, { method: 'GET', headers: ownerHeaders(w.credential) })).status, 405);
            assert.equal((await call(addresses.owner, 'public-policy', w.credential, { installationId: id() })).status, 404);
            assert.deepEqual(await state(db, w.f), before);
            pass('owner-http-origin-csrf-path-and-actor-attacks-no-mutation');
            await stop();
        }
        {
            const w = await world(db);
            await start(w, []);
            const p = await wire(addresses.owner, '/api/local/mode-owner/profile', { method: 'GET', headers: ownerHeaders(w.credential) });
            assert.equal(p.status, 200);
            assert.equal(p.body.profile, null);
            committed(await call(addresses.owner, 'publish', w.credential, publishing(w)));
            pass('owner-http-empty-profile-still-permits-publication');
            await stop();
        }
        for (const fault of ['throw', 'overflow'] as const) {
            const w = await world(db);
            let fired = false;
            const composition = createLocalModeOwnerComposition({ profiles: [profile], credentials: w.credentials, localPortalOrigin: addresses.portal });
            service = await __startModeOwnerLocalForTests({ composition, ownerHttp: __createModeOwnerHttpServerForTests({ composition, serialize(value) { if (!fired) {
                        fired = true;
                        if (fault === 'throw')
                            throw Error('CONTROLLED_SERIALIZATION_FAILURE');
                        return 'x'.repeat(1048577);
                    } return JSON.stringify(value); } }) });
            const request = publishing(w);
            const result = await call(addresses.owner, 'publish', w.credential, request);
            assert.equal(fired, true);
            assert.equal(result.status, 202);
            assert.deepEqual(result.body, { schemaVersion: 1, phase: 'delivery_uncertain', operationKind: 'mutation', code: 'OUTCOME_UNAVAILABLE' });
            const rows = (await db.query('select published_version_id from public.flows where tenant_id=$1 and id=$2', [w.f.tenant, w.f.flow])).rows;
            assert.ok(rows[0].published_version_id);
            const recovered = completed(await call(addresses.owner, 'operation', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, operation: 'publish', idempotencyKey: request.idempotencyKey }));
            assert.equal(recovered.versionId, rows[0].published_version_id);
            const before = await state(db, w.f);
            const retry = committed(await call(addresses.owner, 'publish', w.credential, request));
            assert.equal(retry.versionId, recovered.versionId);
            assert.deepEqual(await state(db, w.f), before);
            pass('owner-http-real-commit-' + fault + '-delivery-uncertainty-and-same-key-recovery');
            await stop();
        }
        {
            const w = await world(db);
            let fired = false;
            const composition = createLocalModeOwnerComposition({ profiles: [profile], credentials: w.credentials, localPortalOrigin: addresses.portal });
            service = await __startModeOwnerLocalForTests({ composition, ownerHttp: __createModeOwnerHttpServerForTests({ composition, serialize(value) { if (!fired) {
                        fired = true;
                        throw Error('CONTROLLED_READ_SERIALIZATION_FAILURE');
                    } return JSON.stringify(value); } }) });
            const before = await state(db, w.f);
            const result = await call(addresses.owner, 'installations', w.credential, listing(w));
            assert.equal(fired, true);
            assert.equal(result.status, 202);
            assert.deepEqual(result.body, { schemaVersion: 1, phase: 'delivery_uncertain', operationKind: 'read', code: 'OUTCOME_UNAVAILABLE' });
            assert.deepEqual(await state(db, w.f), before);
            completed(await call(addresses.owner, 'installations', w.credential, listing(w)));
            pass('owner-http-real-read-serialization-loss-is-read-uncertainty');
            await stop();
        }
        {
            const w = await world(db), pools: Pool[] = [], configs: PoolConfig[] = [];
            const composition = __createModeOwnerCompositionForTests({ profiles: [profile], credentials: w.credentials, localPortalOrigin: addresses.portal }, { environment: { ...process.env }, poolFactory(c) { configs.push(c); const pool = new Pool(c); pools.push(pool); return pool; } });
            try {
                assert.equal(pools.length, 3);
                assert.equal(new Set(pools).size, 3);
                assert.equal(new Set(configs.map(c => c.application_name)).size, 3);
                for (let i = 0; i < 3; i++) {
                    assert.equal(configs[i]!.max, 2);
                    assert.equal(configs[i]!.database, process.env.PGDATABASE);
                    assert.equal(typeof configs[i]!.password, 'function');
                    const identity = (await pools[i]!.query('select current_database() db,current_user usr')).rows[0];
                    assert.equal(identity.db, process.env.PGDATABASE);
                    assert.equal(identity.usr, 'postgres');
                }
                assert.deepEqual(Object.keys(composition.owner).sort(), ['applyVersion', 'install', 'ownerHistory', 'ownerInstallations', 'ownerOperation', 'publish', 'requestHistory', 'updatePolicy'].sort());
                const before = await state(db, w.f);
                for (const method of ['publish_bound_flow', 'publish_configurable_flow', 'issue_flow_session', 'submit_flow_request', 'flow_owner_requests'] as const)
                    await assert.rejects(composition.draftRepository.call(method, []));
                assert.deepEqual(await state(db, w.f), before);
            }
            finally {
                await boundedClose(() => composition.close());
            }
            pass('owner-http-three-distinct-same-database-pools-and-draft-rpc-denial');
        }
        {
            const w = await world(db);
            await start(w);
            const request = publishing(w);
            const first = committed(await call(addresses.owner, 'publish', w.credential, request));
            for (let i = 1; i < 30; i++)
                assert.deepEqual(committed(await call(addresses.owner, 'publish', w.credential, request)), first);
            const before = await state(db, w.f);
            const denied = await call(addresses.owner, 'publish', w.credential, request);
            assert.equal(denied.status, 429);
            assert.equal(denied.body.phase, 'not_dispatched');
            assert.equal(denied.body.error.code, 'RATE_LIMITED');
            assert.ok(Number(denied.headers['retry-after']) >= 1);
            assert.deepEqual(await state(db, w.f), before);
            pass('owner-http-actual-mutation-window30-denies31-without-new-state');
            await stop();
        }
        // Real commit is already known to the repository before transport loss/expiry.
        for (const fault of ['before-headers', 'deadline', 'mid-json'] as const) {
            phase = 'wire-' + fault;
            const w = await world(db), committedAt = deferred(), release = deferred();
            let clock = 0, hooked = false;
            const composition = createLocalModeOwnerComposition({ profiles: [profile], credentials: w.credentials, localPortalOrigin: addresses.portal });
            service = await __startModeOwnerLocalForTests({ composition, ownerHttp: __createModeOwnerHttpServerForTests({ composition, now: () => clock, async afterRepository(context) { if (context.route === 'publish' && !hooked) {
                        hooked = true;
                        assert.equal((context.outcome as any).kind, 'committed');
                        committedAt.resolve();
                        if (fault === 'before-headers')
                            await release.promise;
                        if (fault === 'deadline')
                            clock = 15000;
                    } } }) });
            const request = publishing(w);
            if (fault === 'before-headers') {
                const transport = disconnectable(addresses.owner, '/api/local/mode-owner/publish', request, ownerHeaders(w.credential));
                try { await ready(committedAt.promise, 'known_commit');
                assert.equal(transport.sawResponse(), false);
                assert.ok((await db.query('select published_version_id from public.flows where tenant_id=$1 and id=$2', [w.f.tenant, w.f.flow])).rows[0].published_version_id);
                transport.drop();
                await ready(transport.terminal, 'dropped_before_headers');
                release.resolve(); } finally {transport.drop();release.resolve();await ready(transport.terminal,'owned_transport_cleanup');}
            }
            else if (fault === 'deadline') {
                const response = await call(addresses.owner, 'publish', w.credential, request);
                assert.equal(response.status, 202);
                assert.equal(response.body.phase, 'delivery_uncertain');
                assert.equal(response.body.operationKind, 'mutation');
                clock = 15001;
            }
            else
                await truncatedReply(addresses.owner, '/api/local/mode-owner/publish', request, ownerHeaders(w.credential));
            const recovered = completed(await call(addresses.owner, 'operation', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, operation: 'publish', idempotencyKey: request.idempotencyKey }));
            assert.equal(recovered.operation, 'publish');
            const before = await state(db, w.f);
            assert.equal(committed(await call(addresses.owner, 'publish', w.credential, request)).versionId, recovered.versionId);
            assert.deepEqual(await state(db, w.f), before);
            pass('owner-http-actual-' + fault + '-commit-delivery-loss-recovery');
            await stop();
        }
        // Disconnect while actual SQL is still waiting: no availability/rollback inference from client loss.
        {
            phase = 'inflight-disconnect';
            const w = await world(db);
            await start(w);
            const before = await state(db, w.f), holder = await db.connect();
            try {
                await holder.query('BEGIN');
                await holder.query('SET LOCAL idle_in_transaction_session_timeout=5000');
                await holder.query('select id from public.flows where tenant_id=$1 and id=$2 for update', [w.f.tenant, w.f.flow]);
                const request = publishing(w), transport = disconnectable(addresses.owner, '/api/local/mode-owner/publish', request, ownerHeaders(w.credential));
                const pid = await observeOwnerWait(db, (holder as any).processID);
                assert.equal(transport.sawResponse(), false);
                transport.drop();
                await ready(transport.terminal, 'inflight_disconnected');
                await holder.query('ROLLBACK');
                await waitFor(async () => !(await db.query('select exists(select 1 from pg_stat_activity where pid=$1) ok', [pid])).rows[0].ok, 'cancelled_backend_gone', 7000);
                assert.deepEqual(await state(db, w.f), before);
                failure(await call(addresses.owner, 'operation', w.credential, { tenantId: w.f.tenant, flowId: w.f.flow, operation: 'publish', idempotencyKey: request.idempotencyKey }), 'UNAVAILABLE');
                const recovered = committed(await call(addresses.owner, 'publish', w.credential, request));
                assert.ok(recovered.versionId);
            }
            finally {
                await holder.query('ROLLBACK').catch(() => { });
                holder.release();
                await stop();
            }
            pass('owner-http-disconnect-while-actual-sql-blocked-clean-retry');
        }
        // Both publication/installation orders use actual SQL locks rather than a sleep or stale-only assertion.
        for (const first of ['publication', 'installation'] as const) {
            phase = 'writer-' + first;
            const w = await world(db);
            await start(w);
            const published = committed(await call(addresses.owner, 'publish', w.credential, publishing(w)));
            await stop();
            await transaction(db, c => c.query('select public.save_bound_flow_draft($1,$2,$3,$4,1,$5,$6)', [w.f.actor, w.f.tenant, w.f.flow, w.f.service, 'Next draft', JSON.stringify(config)]));
            w.revision = 2;
            const holder = await db.connect();
            let pending: Promise<any> | undefined;
            try {
                await holder.query('BEGIN ISOLATION LEVEL READ COMMITTED');
                await holder.query('SET LOCAL idle_in_transaction_session_timeout=5000');
                await holder.query('SET LOCAL ROLE service_role');
                if (first === 'publication')
                    await holder.query('select public.mode_publish_flow($1,$2,$3,2,$4)', [w.f.actor, w.f.tenant, w.f.flow, id()]);
                else
                    await holder.query("select public.mode_install_flow($1,$2,$3,$4,$4,'hosted',$5,'[]'::jsonb,$6)", [w.f.actor, w.f.tenant, w.f.flow, published.versionId, profile.profileVersion, id()]);
                await start(w);
                pending = first === 'publication' ? call(addresses.owner, 'install', w.credential, installation(w, published.versionId)) : call(addresses.owner, 'publish', w.credential, publishing(w));
                await observeOwnerWait(db, (holder as any).processID);
                await holder.query('COMMIT');
                const result = await pending;
                if (first === 'publication') {
                    failure(result, 'CONFLICT');
                    assert.equal((await state(db, w.f)).mode_flow_installations instanceof Array, true);
                    assert.equal(((await state(db, w.f)).mode_flow_installations as any[]).length, 0);
                }
                else {
                    const pub2 = committed(result);
                    assert.notEqual(pub2.versionId, published.versionId);
                    const rows = completed(await call(addresses.owner, 'installations', w.credential, listing(w))).installations;
                    assert.equal(rows.length, 1);
                    assert.equal(rows[0].currentVersionId, published.versionId);
                    assert.equal(rows[0].targetRevision, 1);
                }
            }
            finally {
                await holder.query('ROLLBACK').catch(() => { });
                holder.release();
                if (pending)
                    await pending.catch(() => { });
                await stop();
            }
            pass('owner-http-observed-' + first + '-first-writer-order');
        }
        // Synthetic trusted progressed-state fixtures exercise the real owner summary without public session routes.
        {
            phase = 'progressed-summary';
            const w = await world(db);
            await start(w);
            const pub = committed(await call(addresses.owner, 'publish', w.credential, publishing(w))), installed = committed(await call(addresses.owner, 'install', w.credential, installation(w, pub.versionId)));
            try {
                const seeded=await seedOwnerRequests(db,w,pub.versionId,installed.installationId);assert.equal(seeded.length,2);
                await db.query("update public.flows set status='archived' where tenant_id=$1 and id=$2",[w.f.tenant,w.f.flow]);
                const request = { tenantId: w.f.tenant, flowId: w.f.flow, beforeCreatedAt: null, beforeBookingId: null, limit: 1 };
                const first = completed(await call(addresses.owner, 'request-history', w.credential, request));
                assert.equal(first.requests.length, 1);
                assert.ok(first.nextCursor);
                assert.equal(first.nextCursor.createdAt, '2026-09-10T12:00:00.123456Z');
                const second = completed(await call(addresses.owner, 'request-history', w.credential, { ...request, beforeCreatedAt: first.nextCursor.createdAt, beforeBookingId: first.nextCursor.bookingId }));
                assert.equal(second.requests.length, 1);
                assert.notEqual(second.requests[0].bookingId, first.requests[0].bookingId);
                assert.deepEqual(new Set([first.requests[0].state, second.requests[0].state]), new Set(['completed', 'cancelled']));
                for (const row of [...first.requests, ...second.requests])
                    assert.deepEqual(Object.keys(row).sort(), ['bookingId', 'reference', 'state', 'slotStart', 'createdAt'].sort());
                const snapshot = await state(db, w.f);
                assert.equal((snapshot.payments as any[]).length, 0);
                assert.equal((snapshot.capacity_holds as any[]).length, 0);
                await stop();let overflowed=false;
                const readComposition=createLocalModeOwnerComposition({profiles:[profile],credentials:w.credentials,localPortalOrigin:addresses.portal});
                service=await __startModeOwnerLocalForTests({composition:readComposition,ownerHttp:__createModeOwnerHttpServerForTests({composition:readComposition,serialize(value){const envelope=value as any;if(!overflowed&&envelope.outcome?.kind==='completed'){assert.equal(envelope.outcome.data.requests.length,1);overflowed=true;return 'x'.repeat(1048577);}return JSON.stringify(value);}})});
                const oversized=await call(addresses.owner,'request-history',w.credential,request);assert.equal(overflowed,true);assert.equal(oversized.status,202);assert.deepEqual(oversized.body,{schemaVersion:1,phase:'delivery_uncertain',operationKind:'read',code:'OUTCOME_UNAVAILABLE'});assert.deepEqual(await state(db,w.f),snapshot);assert.deepEqual(completed(await call(addresses.owner,'request-history',w.credential,request)),first);
                const badId = second.requests[0].bookingId, original = second.requests[0].reference;
                // Trusted impossible legacy-reference fixture proves the selected lookahead row fails the whole page.
                await transaction(db, async (c) => { await c.query('alter table public.bookings disable trigger user'); await c.query('update public.bookings set reference=$1 where id=$2', ['x'.repeat(129), badId]); await c.query('alter table public.bookings enable trigger user'); }, 'owner');
                try {
                    const invalid = await call(addresses.owner, 'request-history', w.credential, request);
                    failure(invalid, 'INTERNAL_ERROR');
                    assert.equal('data' in invalid.body.outcome, false);
                }
                finally {
                    await transaction(db, async (c) => { await c.query('alter table public.bookings disable trigger user'); await c.query('update public.bookings set reference=$1 where id=$2', [original, badId]); await c.query('alter table public.bookings enable trigger user'); }, 'owner');
                }
                assert.deepEqual(await state(db, w.f), snapshot);
            }
            finally {
                await stop();
            }
            pass('owner-http-archived-progressed-summary-exact-microsecond-cursor');
        }
        assert.equal(cases, 18, 'all current scenario groups completed');
        process.stdout.write(`MODE OWNER HTTP PASS ${cases} actual scenarios\n`);
    }
    catch {
        process.stderr.write('MODE_OWNER_HTTP_FAILURE\n');
        process.exitCode = 1;
    }
    finally {
        await stop();
        await boundedClose(() => db.end());
    }
}
void main().then(() => { finished = true; }).catch(() => { finished = true; process.stderr.write("MODE_OWNER_HTTP_STARTUP_OR_CLEANUP_FAILURE\n"); process.exitCode = 1; });

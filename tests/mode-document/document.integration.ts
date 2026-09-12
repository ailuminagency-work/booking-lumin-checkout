import https from 'node:https';
import { Pool } from 'pg';
import { __createLocalModePolicyCompositionForTests, __restrictModePolicyPoolForTests, startLocalModePolicyServer } from '../../packages/action-api/server/mode-policy-local.js';
import { profile, observerConfig, listen, closeServer } from './fixtures.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { observer, seed, loadTls, startWorld, wire, snapshot, updatePolicy, advanceTarget, closeWithin } from './fixtures.js';
let phase = 'startup'; let passed = 0;
async function check(name: string, fn: () => Promise<void>) { phase = name; await fn(); passed++; process.stdout.write('PASS document-http-' + name + '\n'); }
async function main() {
  const t = await loadTls(); const db = await observer(); let local: Awaited<ReturnType<typeof startWorld>> | undefined;
  try {
    const w = await seed(db); local = await startWorld(t); const a = local.addresses;
    const api = '/api/public/installation-policies/'; const hosted = '/checkout/flow/' + w.hosted.installationId; const embedded = '/embed/flow/' + w.iframe.installationId;
    await check('actual-v1-public-policy-and-minimized-projection', async () => {
      const before = await snapshot(db, w.f); const out = await wire(a.api, api + w.hosted.installationId, t); assert.equal(out.status, 200);
      const policy = JSON.parse(out.bytes.toString('utf8')); assert.equal(policy.installationId, w.hosted.installationId); assert.equal(policy.currentVersionId, w.published.versionId);
      assert.deepEqual(Object.keys(policy).sort(), ['schemaVersion','installationId','mode','deploymentProfileVersion','rendererOrigin','apiOrigin','loaderUrl','currentVersionId','targetRevision','policyRevision','allowedParentOrigins','enabled'].sort()); assert.deepEqual(await snapshot(db, w.f), before);
    });
    await check('actual-v2-policy', async () => { const v2 = await seed(db, true); const before = await snapshot(db, v2.f); assert.equal((await wire(a.api, api + v2.hosted.installationId, t)).status, 200); assert.deepEqual(await snapshot(db, v2.f), before); });
    await check('document-current-csp-and-inert-bootstrap', async () => {
      const out = await wire(a.renderer, embedded, t); assert.equal(out.status, 200); assert.equal(out.headers['x-frame-options'], undefined); assert.ok(String(out.headers['content-security-policy']).includes('frame-ancestors ' + [a.merchant, a.second].sort().join(' ')));
      const html = out.bytes.toString('utf8'); assert.ok(html.includes('lumin-mode-bootstrap')); assert.ok(!/<script|<form|<iframe|<img|<link/i.test(html)); assert.ok(html.includes('Booking experience is not available yet'));
    });
    await check('head-and-cache-header-parity', async () => {
      for (const [base, target] of [[a.api, api + w.hosted.installationId], [a.renderer, hosted], [a.renderer, '/checkout/flow/' + randomUUID()]]) {
        const get = await wire(base!, target!, t), head = await wire(base!, target!, t, { method: 'HEAD' }); assert.equal(head.status, get.status); assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], String(get.bytes.length));
        for (const name of ['content-type','cache-control','cdn-cache-control','netlify-cdn-cache-control','content-security-policy','x-frame-options']) assert.equal(head.headers[name], get.headers[name]);
        assert.equal(get.headers['cache-control'], 'no-store,max-age=0'); assert.equal(get.headers['cdn-cache-control'], 'no-store'); assert.equal(get.headers['netlify-cdn-cache-control'], 'no-store');
      }
    });
    await check('unknown-disabled-and-reenabled', async () => {
      assert.equal((await wire(a.api, api + randomUUID(), t)).status, 404); await updatePolicy(db, w, false, [a.merchant, a.second].sort()); assert.equal((await wire(a.api, api + w.iframe.installationId, t)).status, 404); assert.equal((await wire(a.renderer, embedded, t)).status, 404); await updatePolicy(db, w, true, [a.merchant, a.second].sort(), 2); assert.equal((await wire(a.renderer, embedded, t)).status, 200);
    });
    await check('committed-target-and-parent-policy-refresh', async () => { const next = await advanceTarget(db, w); await updatePolicy(db, w, true, [a.second], 3); const out = await wire(a.api, api + w.iframe.installationId, t); const policy = JSON.parse(out.bytes.toString()); assert.equal(policy.currentVersionId, next.versionId); assert.equal(policy.targetRevision, 2); assert.equal(policy.policyRevision, 4); assert.deepEqual(policy.allowedParentOrigins, [a.second]); });
    await check('archived-service-and-tenant-public-unavailability', async () => {
      await db.query("update public.flows set status='archived' where id=$1", [w.f.flow]); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 404); await db.query("update public.flows set status='active' where id=$1", [w.f.flow]);
      await db.query('update public.services set active=false where id=$1', [w.f.service]); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 404); await db.query('update public.services set active=true where id=$1', [w.f.service]);
      await db.query("update public.tenants set status='inactive' where id=$1", [w.f.tenant]); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 404); await db.query("update public.tenants set status='active' where id=$1", [w.f.tenant]); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 200);
    });
    await check('raw-aliases-denied-without-policy-fetch', async () => {
      const count = local!.attempted.reads;
      for (const target of [hosted + '?', hosted + '#', hosted + '/', hosted + '/extra', '/checkout//flow/' + w.hosted.installationId, '/checkout/flow/../' + w.hosted.installationId, '/checkout/flow/%31' + w.hosted.installationId.slice(1), '/checkout\\flow\\' + w.hosted.installationId]) assert.equal((await wire(a.renderer, target, t)).status, 400);
      assert.equal(local!.attempted.reads, count);
    });
    await check('no-static-spa-fallback-or-method-alias', async () => {
      for (const target of ['/index.html', '/checkout/index.html', '/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js']) { const out = await wire(a.renderer, target, t); assert.equal(out.status, 404); assert.ok(!out.bytes.toString().includes('FIXTURE_STATIC')); }
      const method = await wire(a.renderer, hosted, t, { method: 'POST' }); assert.equal(method.status, 405); assert.equal(method.headers.allow, 'GET, HEAD'); assert.equal((await wire(a.api, api + w.hosted.installationId, t, { method: 'POST' })).status, 405);
    });
    await check('origin-cors-and-options-are-not-authentication', async () => {
      const target = api + w.hosted.installationId; const yes = await wire(a.api, target, t, { headers: { Origin: a.renderer } }); assert.equal(yes.status, 200); assert.equal(yes.headers['access-control-allow-origin'], a.renderer); assert.equal(yes.headers['access-control-allow-credentials'], undefined);
      assert.equal((await wire(a.api, target, t, { headers: { Origin: a.merchant } })).status, 403);
      const preflight = await wire(a.api, target, t, { method: 'OPTIONS', headers: { Origin: a.renderer, 'Access-Control-Request-Method': 'GET' } }); assert.equal(preflight.status, 204); assert.equal(preflight.bytes.length, 0);
      assert.equal((await wire(a.api, target, t, { method: 'OPTIONS', headers: { Origin: a.renderer, 'Access-Control-Request-Method': 'POST' } })).status, 400);
    });
    await check('empty-auth-cookie-and-raw-duplicate-authority-denied', async () => {
      const target = api + w.hosted.installationId;
      for (const headers of [{ Authorization: '' }, { Cookie: '' }] as Array<Record<string,string>>) assert.equal((await wire(a.api, target, t, { headers })).status, 400);
      for (const pair of [['Host', new URL(a.api).host], ['Origin', a.renderer], ['Authorization', ''], ['Content-Length', '0']]) {
        const headers = pair[0] === 'Host' ? [pair[0]!, pair[1]!, pair[0]!, pair[1]!] : ['Host', new URL(a.api).host, pair[0]!, pair[1]!, pair[0]!, pair[1]!];
        try { assert.equal((await wire(a.api, target, t, { rawHeaders: headers })).status, 400); } catch (error) { assert.match((error as Error).message, /^TLS_REQUEST_FAILED(?:_ECONNRESET)?$/); }
      }
    });
    await check('node-ca-hostname-and-key-negatives-with-valid-neighbor', async () => {
      await assert.rejects(wire(a.untrusted, '/', t, { servername: 'wrong.mode.test', ca: t.untrustedCert }), /TLS_REQUEST_FAILED_ERR_TLS_CERT_ALTNAME_INVALID/); await assert.rejects(wire(a.untrusted, '/', t), /TLS_REQUEST_FAILED_DEPTH_ZERO_SELF_SIGNED_CERT/); assert.equal((await wire(a.untrusted, '/', t, { ca: t.untrustedCert })).bytes.toString(), 'UNPINNED_KEY_MARKER'); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 200);
    });
    await check('real-sql-lock-deadline-and-backend-cleanup', async () => {
      const holder = await db.connect(); await holder.query('BEGIN'); await holder.query('SET LOCAL idle_in_transaction_session_timeout=\'8s\''); await holder.query('LOCK TABLE public.mode_flow_installations IN ACCESS EXCLUSIVE MODE');
      try {
        const start = performance.now(); const waiting = wire(a.api, api + w.hosted.installationId, t); const deadline = performance.now() + 1500; let observed = false; let blockedPids: number[] = [];
        while (performance.now() < deadline) { const rows = (await db.query("select pid from pg_stat_activity where application_name='mode-policy-local' and wait_event_type='Lock'")).rows; if (rows.length) { observed = true; blockedPids = rows.map(row => Number(row.pid)); break; } await new Promise(r => setTimeout(r, 20)); }
        assert.equal(observed, true); process.stdout.write('OBSERVED document-policy-lock\n'); assert.equal((await waiting).status, 503); assert.ok(performance.now() - start < 3500);
        let terminated = false;
        while (performance.now() - start < 5500) { const remaining = Number((await db.query('select count(*) n from pg_stat_activity where pid=any($1::integer[])', [blockedPids])).rows[0].n); if (remaining === 0) { terminated = true; break; } await new Promise(r => setTimeout(r, 20)); }
        assert.equal(terminated, true); // Controller table lock is still held: completion cannot be explained by unlocking.
      } finally { await holder.query('ROLLBACK'); holder.release(); }
      assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 200);
    });
    await check('readonly-query-inventory-no-customer-session-side-effects', async () => {
      const before = await snapshot(db, w.f); await wire(a.renderer, hosted, t); assert.deepEqual(await snapshot(db, w.f), before); assert.equal(local!.attempted.issuance, 0);
      const allowed = new Set(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role', 'SELECT public.mode_public_installation_policy($1::uuid) AS result', 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT']);
      assert.ok(local!.queries.length > 0 && local!.queries.every(sql => allowed.has(sql)));
    });
    await check('native-header-overflow-and-nonzero-body-framing', async () => {
      await assert.rejects(wire(a.api, api + w.hosted.installationId, t, { headers: { 'X-Oversize': 'x'.repeat(9000) } }), /TLS_REQUEST_FAILED/);
      assert.equal((await wire(a.api, api + w.hosted.installationId, t, { headers: { 'Content-Length': '1' } })).status, 400);
    });
    await check('zero-and-mismatched-registry-without-fabricated-outcomes', async () => {
      let created = 0;
      const empty = __createLocalModePolicyCompositionForTests({ profiles: [] }, { env: { ...process.env }, poolFactory: value => { created++; return new Pool(value); } });
      try { assert.equal((await empty.reader.publicPolicy({ installationId: w.hosted.installationId })).kind, 'failed'); assert.equal(created, 0); } finally { await empty.close(); }
      const mismatch = __createLocalModePolicyCompositionForTests({ profiles: [{ ...profile(), profileVersion: 'different-document-profile' }] }, { env: { ...process.env }, poolFactory: value => new Pool(value) });
      try { const result = await mismatch.reader.publicPolicy({ installationId: w.hosted.installationId }); assert.equal(result.kind, 'failed'); } finally { await mismatch.close(); }
    });
    await check('actual-restricted-pool-denies-owner-query-before-driver', async () => {
      const pool = new Pool(observerConfig()); pool.on('error', () => {}); let calls = 0;
      const guarded = __restrictModePolicyPoolForTests({ connect: async () => { const c = await pool.connect(); return { query: (sql, values) => { calls++; return c.query(sql, values); }, release: c.release.bind(c), on: c.on.bind(c), removeListener: c.removeListener.bind(c) }; }, end: () => pool.end(), on: pool.on.bind(pool), removeListener: pool.removeListener.bind(pool) });
      try { const c = await guarded.connect(); try { await assert.rejects(c.query('SELECT public.mode_owner_installations($1,$2,$3,$4,$5)', []), /MODE_POLICY_QUERY_DENIED/); assert.equal(calls, 0); await c.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await c.query('COMMIT'); assert.equal(calls, 2); } finally { c.release(); } } finally { await guarded.end(); }
    });
    await check('two-real-blocked-backends-retained-through-disconnect', async () => {
      const holder = await db.connect(); await holder.query('BEGIN'); await holder.query("SET LOCAL idle_in_transaction_session_timeout='8s'"); await holder.query('LOCK TABLE public.mode_flow_installations IN ACCESS EXCLUSIVE MODE');
      const abort = new AbortController(); const first = wire(a.api, api + w.hosted.installationId, t, { signal: abort.signal }).then(x => x.status, () => -1); const second = wire(a.api, api + w.hosted.installationId, t).then(x => x.status, () => -1);
      try {
        const deadline = performance.now() + 1500; let observed = false; let blockedPids: number[] = [];
        while (performance.now() < deadline) { const count = Number((await db.query("select count(*) n from pg_stat_activity where application_name='mode-policy-local' and wait_event_type='Lock'")).rows[0].n); if (count === 2) { observed = true; break; } await new Promise(r => setTimeout(r, 20)); }
        assert.equal(observed, true); process.stdout.write('OBSERVED document-policy-two-backends\n');
        assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 429); abort.abort(); assert.equal(await first, -1); assert.equal(await second, 503);
      } finally { await holder.query('ROLLBACK'); holder.release(); }
    });
    await local.close(); local = undefined;
    await check('public-tls-startup-and-second-bind-failure-cleanup', async () => {
      const occupied = https.createServer({ key: t.key, cert: t.cert }, (_req, res) => res.end('OWNED_OCCUPIER'));
      await listen(occupied, a.renderer);
      try { await assert.rejects(startWorld(t), /DOCUMENT_WORLD_START_FAILED/); assert.equal((await wire(a.renderer, '/', t)).bytes.toString(), 'OWNED_OCCUPIER'); }
      finally { await closeServer(occupied); }
      const started = await startLocalModePolicyServer({ profiles: [profile()], tls: { key: t.key.toString(), cert: t.cert.toString() } });
      try { assert.equal(started.origin, a.api); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 200); await assert.rejects(startLocalModePolicyServer({ profiles: [profile()], tls: { key: t.key.toString(), cert: t.cert.toString() } }), /MODE_POLICY_STARTUP_FAILED/); assert.equal((await wire(a.api, api + w.hosted.installationId, t)).status, 200); }
      finally { await started.close(); }
    });
    assert.equal(passed, 19); process.stdout.write('MODE DOCUMENT HTTP PASS 19 actual scenarios\n');
  } finally { await closeWithin([...(local ? [() => local!.close()] : []), () => db.end()]); }
}
void main().catch(() => { process.stderr.write(JSON.stringify({ category: 'MODE_DOCUMENT_HTTP_FAILED', phase, passed }) + '\n'); process.exitCode = 1; });

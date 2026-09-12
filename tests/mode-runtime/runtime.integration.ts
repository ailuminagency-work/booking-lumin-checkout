import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { observer, seed, loadTls, startWorld, wire, snapshot, closeWithin, assertNativeNoReferrer, assertNativePrivacy, assertPolicyQueries } from './fixtures.js';
let phase = 'startup', passed = 0;
async function check(name: string, work: () => Promise<void>) { phase = name; await work(); passed++; process.stdout.write('PASS runtime-http-' + name + '\n'); }
async function main() {
  const t = await loadTls(), db = await observer(); let local: Awaited<ReturnType<typeof startWorld>> | undefined;
  try {
    const w = await seed(db); local = await startWorld(t); const a = local.addresses; const baseline = await snapshot(db, w.f);
    const loader = new URL(local.assets.profile.loaderUrl).pathname;
    const controller = '/assets/booking-lumin-controller.' + local.assets.controllerSha256 + '.js';
    await check('registered-emitted-asset-bytes-and-head', async () => {
      for (const target of [loader, controller]) {
        const get = await wire(a.renderer, target, t), head = await wire(a.renderer, target, t, { method: 'HEAD' });
        assert.equal(get.status, 200); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
        assert.ok(target.includes(createHash('sha256').update(get.bytes).digest('hex')));
        for (const name of ['content-type','content-length','cache-control','cdn-cache-control','netlify-cdn-cache-control','x-content-type-options','referrer-policy','access-control-allow-origin']) assert.equal(head.headers[name], get.headers[name]);
        assert.equal(get.headers['content-type'], 'application/javascript;charset=utf-8'); assert.equal(get.headers['x-content-type-options'], 'nosniff'); assert.equal(get.headers['access-control-allow-origin'], '*');
        assert.equal(get.headers['cache-control'], 'public,max-age=31536000,immutable'); assert.equal(Number(get.headers['content-length']), get.bytes.length);
      }
    });
    await check('asset-raw-aliases-and-methods', async () => {
      for (const target of [loader + '?', loader + '#', loader.replace('/assets/', '/assets//'), loader.replace('/assets/', '/assets/%2e/')]) assert.equal((await wire(a.renderer, target, t)).status, 400);
      assert.equal((await wire(a.renderer, '/assets/booking-lumin-loader.' + 'f'.repeat(64) + '.js', t)).status, 404);
      for (const method of ['POST', 'OPTIONS']) { const out = await wire(a.renderer, loader, t, { method }); assert.equal(out.status, 405); assert.equal(out.headers.allow, 'GET, HEAD'); }
      for (const headers of [{ Authorization: '' }, { Cookie: '' }, { Range: 'bytes=0-10' }] as Record<string,string>[]) assert.equal((await wire(a.renderer, loader, t, { headers })).status, 400);
    });
    await check('runtime-document-integrity-csp-and-budgeted-policy', async () => {
      const out = await wire(a.renderer, '/embed/flow/' + w.iframe.installationId, t); assert.equal(out.status, 200);
      const html = out.bytes.toString('utf8'), integrity = 'sha256-' + Buffer.from(local!.assets.controllerSha256, 'hex').toString('base64');
      assert.ok(html.includes(a.renderer + controller)); assert.ok(html.includes(integrity)); assert.ok(html.includes('crossorigin="anonymous"'));
      assert.ok(String(out.headers['content-security-policy']).includes(integrity)); assert.ok(String(out.headers['content-security-policy']).includes('connect-src ' + a.api));
      assert.ok(html.includes('Booking experience is not available yet.')); assert.equal((html.match(/<script\b/g) ?? []).length, 1);
      const head = await wire(a.renderer, '/embed/flow/' + w.iframe.installationId, t, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
    });
    await check('unchanged-real-compose-install', async () => {
      const html = await local!.snippet(w); assert.equal(html, '<div data-booking-lumin-installation="' + w.iframe.installationId + '" data-booking-lumin-height="640"></div>\n<script src="' + local!.assets.profile.loaderUrl + '" defer></script>');
    });
    await check('asset-errors-have-no-runtime-or-cache-authority', async () => {
      const out = await wire(a.renderer, '/assets/no.js', t); assert.equal(out.status, 404);
      assert.deepEqual(JSON.parse(out.bytes.toString('utf8')), { error: 'ASSET_UNAVAILABLE' }); assert.equal(out.headers['cache-control'], 'no-store,max-age=0'); assert.equal(out.headers['cdn-cache-control'], 'no-store'); assert.equal(out.headers['netlify-cdn-cache-control'], 'no-store'); assert.equal(out.headers['access-control-allow-origin'], undefined); assert.equal(out.headers.location, undefined);
    });
    await check('no-session-or-customer-authority', async () => { assert.equal(local!.attempted.issuance, 0); assert.deepEqual(await snapshot(db, w.f), baseline); });
    await check('native-referrer-detector-positive-negative', async () => {
      assertNativeNoReferrer(local!.wirePrivacy);
      const out=await wire(a.renderer,loader,t,{headers:{Referer:a.merchant}});assert.equal(out.status,200);
      assert.equal(local!.wirePrivacy.asset.referrer,1);
      assert.throws(()=>assertNativeNoReferrer(local!.wirePrivacy),/RUNTIME_NATIVE_REFERRER_DETECTED/);
    });
    await check('sequential-world-assets-remain-live', async () => {
      await local!.close(); local = undefined; local = await startWorld(t);
      assert.equal((await wire(local.addresses.renderer, loader, t)).status, 200);
      assert.equal((await wire(local.addresses.renderer, controller, t)).status, 200);
    });
    await check('native-method-body-query-header-and-sql-detectors',async()=>{
      assertNativePrivacy(local!.wirePrivacy);assertPolicyQueries(local!.queries);
      const controls=[{field:'method',method:'POST',headers:{},status:405},{field:'body',method:'GET',headers:{'Content-Length':'1'},body:'x',status:400},{field:'query',method:'GET',headers:{},target:loader+'?unexpected=1',status:400},{field:'auth',method:'GET',headers:{Authorization:'synthetic-fixture'},status:400},{field:'cookie',method:'GET',headers:{Cookie:'fixture=public'},status:400}] as const;
      for(const control of controls){const before=JSON.parse(JSON.stringify(local!.wirePrivacy));const headers:Record<string,string>={...control.headers};const out=await wire(a.renderer,'target'in control?control.target:loader,t,{method:control.method,headers,...('body'in control?{body:control.body}:{})});assert.equal(out.status,control.status);const delta=Object.fromEntries(Object.entries(local!.wirePrivacy).map(([role,value])=>[role,Object.fromEntries(Object.entries(value).map(([key,count])=>[key,count-before[role][key]]))])) as NonNullable<typeof local>['wirePrivacy'];assert.equal(delta.asset[control.field],1);assert.throws(()=>assertNativePrivacy(delta),new RegExp('RUNTIME_NATIVE_'+control.field.toUpperCase()+'_DETECTED'));}
      assert.throws(()=>assertPolicyQueries([...local!.queries,'SELECT 1']),/RUNTIME_SQL_ALLOWLIST_FAILED/);
    });
    assert.equal(passed, 9); process.stdout.write('PASS runtime-http-suite scenarios=9\n');
  } finally { await closeWithin([...(local ? [() => local!.close()] : []), () => db.end()]); }
}
main().catch(() => { process.stderr.write('FAIL runtime-http-' + phase + '\n'); process.exitCode = 1; });




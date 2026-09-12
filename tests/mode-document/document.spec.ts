import { test, expect } from './browser-fixtures';
import { updatePolicy, advanceTarget, wire } from './fixtures';
const frame = (parent: string, child: string) => parent + '/frame?frame=' + encodeURIComponent(child);
const marker = 'Booking experience is not available yet.';
async function blocked(page: import('@playwright/test').Page, url: string) {
  let violation = false;
  const observe = (message: import('@playwright/test').ConsoleMessage) => { const text = message.text(); if (text.includes('frame-ancestors') && /refus|violat|block/i.test(text)) violation = true; };
  page.on('console', observe);
  try { await page.goto(url); await expect.poll(() => violation).toBe(true); for (const f of page.frames()) expect(await f.getByText(marker, { exact: true }).count()).toBe(0); }
  finally { page.off('console', observe); }
}
async function guarded(work: () => Promise<void>) { try { await work(); } catch { throw Error('SAFE_DOCUMENT_ASSERTION_FAILED'); } }

test('document-01 hosted top-level inert and denies every parent', async ({ journey: j }) => guarded(async () => {
  const url = j.local.addresses.renderer + '/checkout/flow/' + j.w.hosted.installationId;
  const out = await j.page.goto(url); expect(out?.status()).toBe(200); expect(out?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(j.page.getByText(marker, { exact: true })).toBeVisible(); await j.capture('document-01-1440.png', 1440);
  await blocked(j.page, frame(j.local.addresses.merchant, url));
  await j.unchanged();
}));
test('document-02 iframe approved parent visible and denied parent blocked', async ({ journey: j }) => guarded(async () => {
  const url = j.local.addresses.renderer + '/embed/flow/' + j.w.iframe.installationId;
  await j.page.goto(frame(j.local.addresses.merchant, url)); await expect(j.page.frameLocator('iframe').getByText(marker, { exact: true })).toBeVisible(); await j.capture('document-02-768.png', 768);
  await blocked(j.page, frame(j.local.addresses.forbidden, url)); await j.unchanged();
}));
test('document-03 every ancestor enforced beyond immediate allowed parent', async ({ journey: j }) => guarded(async () => {
  const url = j.local.addresses.renderer + '/embed/flow/' + j.w.iframe.installationId;
  await j.page.goto(frame(j.local.addresses.second, frame(j.local.addresses.merchant, url)));
  await expect(j.page.frameLocator('iframe').frameLocator('iframe').getByText(marker, { exact: true })).toBeVisible(); await j.capture('document-03-1440.png', 1440);
  await blocked(j.page, frame(j.local.addresses.forbidden, frame(j.local.addresses.merchant, url))); await j.unchanged();
}));
test('document-04 committed policy target and disable are freshly reflected', async ({ journey: j }) => guarded(async () => {
  const a = j.local.addresses, url = a.renderer + '/embed/flow/' + j.w.iframe.installationId;
  const old = await j.page.goto(url); expect(old?.status()).toBe(200);
  const next = await advanceTarget(j.db, j.w); await updatePolicy(j.db, j.w, true, [a.second], 1);
  const fresh = await j.page.reload(); expect(fresh?.headers()['content-security-policy']).toContain('frame-ancestors ' + a.second);
  const bootstrap = await j.page.locator('#lumin-mode-bootstrap').evaluate(e => JSON.parse((e as HTMLTemplateElement).content.textContent!)); expect(bootstrap.policy.currentVersionId).toBe(next.versionId); expect(bootstrap.policy.targetRevision).toBe(2); expect(bootstrap.policy.policyRevision).toBe(2);
  await updatePolicy(j.db, j.w, false, [a.second], 2); expect((await j.page.reload())?.status()).toBe(404);
}));
test('document-05 dedicated route boundary has no SPA static aliases or loader', async ({ journey: j }) => guarded(async () => {
  const a = j.local.addresses;
  for (const target of ['/index.html', '/checkout/index.html', '/assets/missing.js']) { const out = await j.page.goto(a.renderer + target); expect(out?.status()).toBe(404); expect(await j.page.content()).not.toContain('FIXTURE_STATIC'); }
  expect((await j.page.goto(a.renderer + '/checkout/flow/' + j.w.hosted.installationId + '?'))?.status()).toBe(400);
  await j.page.goto(a.renderer + '/checkout/flow/' + j.w.hosted.installationId); expect(await j.page.locator('script,form,img,link,iframe').count()).toBe(0); await j.unchanged();
}));
test('document-06 scoped TLS rejects unpinned key and Node wrong identity', async ({ journey: j }) => guarded(async () => {
  let rejected = false; try { await j.page.goto(j.local.addresses.untrusted + '/'); } catch (error) { rejected = error instanceof Error && error.message.includes('net::ERR_CERT_AUTHORITY_INVALID'); } expect(rejected).toBe(true);
  await expect(wire(j.local.addresses.untrusted, '/', j.tls, { servername: 'wrong.mode.test', ca: j.tls.untrustedCert })).rejects.toThrow('TLS_REQUEST_FAILED_ERR_TLS_CERT_ALTNAME_INVALID');
  await expect(wire(j.local.addresses.untrusted, '/', j.tls)).rejects.toThrow('TLS_REQUEST_FAILED_DEPTH_ZERO_SELF_SIGNED_CERT');
  expect((await wire(j.local.addresses.untrusted, '/', j.tls, { ca: j.tls.untrustedCert })).bytes.toString()).toBe('UNPINNED_KEY_MARKER');
  expect((await wire(j.local.addresses.api, '/api/public/installation-policies/' + j.w.hosted.installationId, j.tls)).status).toBe(200); await j.unchanged();
}));
test('document-07 no issuance customer authority or browser persistence', async ({ journey: j }) => guarded(async () => {
  await j.page.goto(j.local.addresses.renderer + '/checkout/flow/' + j.w.hosted.installationId);
  expect(await j.page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), cookie: document.cookie }))).toEqual({ local: [], session: [], cookie: '' }); expect(await j.context.cookies()).toEqual([]);
  expect(j.local.attempted.issuance).toBe(0); expect(j.local.queries.filter(s => /^SELECT/.test(s)).every(s => s === 'SELECT public.mode_public_installation_policy($1::uuid) AS result')).toBe(true); await j.unchanged();
}));
test('document-08 V2 inert document responsive at three viewport sizes', async ({ journey: j }) => guarded(async () => {
  await j.page.goto(j.local.addresses.renderer + '/checkout/flow/' + j.w.hosted.installationId); await expect(j.page.getByText(marker, { exact: true })).toBeVisible();
  for (const width of [320, 768, 1440]) await j.capture('document-08-' + width + '.png', width); await j.unchanged();
}));

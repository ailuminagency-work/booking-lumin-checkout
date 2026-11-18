import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OBSERVER, validateObserver, inspectFiles } from './no-auto-refund-check.mjs';
const original = fs.readFileSync(new URL('../' + OBSERVER, import.meta.url), 'utf8');
const check = (source, name = OBSERVER) => inspectFiles(new Map([[name, source]]));
test('exact reviewed observer accepted; CRLF and comments do not grant new behavior', () => {
  assert.equal(validateObserver(original), true);
  assert.deepEqual(check(original), []);
  assert.equal(validateObserver('// harmless comment\n' + original.replace(/\r?\n/g, '\r\n')), true);
});
const mutations = {
  'POST transport': s => s.replace("method:'GET',url", "method:'POST',url"),
  'PUT transport': s => s.replace("method:'GET',url", "method:'PUT',url"),
  'default network': s => s.replace('transport:ObservationTransport)', 'transport:ObservationTransport=fetch as any)'),
  'fetch side effect': s => s + "\nfetch('https://api.stripe.com/v1/refunds', {method:'POST'});",
  'SDK refund creation': s => s + "\nstripe.refunds.create({});",
  'legacy refund primitive': s => s + "\nprovider.refund('pi_example');",
  'network import': s => "import https from 'node:https';\n" + s,
  'network construction': s => s + "\nnew XMLHttpRequest();",
  'alias dispatch': s => s + "\nconst send=transport;send({method:'POST'});",
  'dynamic execution': s => s + "\neval('fetch(1)');",
  'extra runtime export': s => s + "\nexport const activate = true;",
  'changed endpoint': s => s.replace('v1/refunds?', 'v1/refunds/'),
  'parse error': s => s + '\nconst = ;',
};
for (const [name, mutate] of Object.entries(mutations)) test('reject observer mutation: ' + name, () => {
  const changed = mutate(original);
  assert.notEqual(changed, original);
  assert.equal(validateObserver(changed), false);
  assert.ok(check(changed).length > 0);
});
for (const [name, code] of Object.entries({
  'SDK creation': 'stripe.refunds.create({})',
  'legacy primitive': "provider.refund('pi_x')",
  'spaced primitive': "provider.refund ('pi_x')",
  'raw endpoint': "fetch('https://api.stripe.com/v1/refunds', {method:'POST'})",
  'observer moved/copied': original,
  'barrel reexport': "export * from './stripeRefundObservation.internal';",
  'static consumer': "import {createStripeRefundObserverInternal} from './stripeRefundObservation.internal';",
  'dynamic consumer': "import('./stripeRefundObservation.internal')",
  'require consumer': "require('./stripeRefundObservation.internal')",
})) test('reject outside observer: ' + name, () => assert.ok(check(code, 'apps/api/src/mutation.ts').length));
test('original test exemption and comment-only prohibition text remain', () => {
  assert.deepEqual(check("provider.refund('x')", 'packages/adapters/test/fakeStripe.ts'), []);
  assert.deepEqual(check("// do not call /v1/refunds\n/* provider.refund( */", 'apps/api/src/note.ts'), []);
});
test('path is exact, not suffix exemption', () => assert.ok(check(original, 'apps/api/src/stripeRefundObservation.internal.ts').length));

test('filesystem scan exit is fail-closed for production TSX and unexpanded test exemptions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumin-refund-guard-'));
  try {
    fs.mkdirSync(path.join(root, 'apps/api/src'), {recursive:true});
    fs.writeFileSync(path.join(root, 'apps/api/src/unsafe.tsx'), "provider.refund('x')");
    const script = `import {scan} from ${JSON.stringify(new URL('./no-auto-refund-check.mjs', import.meta.url).href)}; process.exit(scan(${JSON.stringify(root)}).length ? 1 : 0);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding:'utf8'});
    assert.equal(result.status, 1, result.stderr);
    assert.ok(check("provider.refund('x')", 'apps/api/tests/not-exempt.ts').length);
    assert.ok(check("provider.refund('x')", 'apps/api/src/not-exempt.spec.ts').length);
    fs.writeFileSync(path.join(root, 'apps/api/src/unsafe.tsx'), 'export const harmless = true;');
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding:'utf8'}).status, 0);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

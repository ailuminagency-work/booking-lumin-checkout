import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID, X509Certificate } from 'node:crypto';
import { provisionDocumentTls, validateDocumentTls, DOCUMENT_TLS_HOSTS } from './mode-document-tls.mjs';

test('disposable TLS fixtures validate exact material and reject corruption', async t => {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp,'lumin-document-tls-'));
  const run = randomUUID();
  try {
    const fixture = await provisionDocumentTls(root,run);
    const directory = fixture.directory;
    const originals = Object.fromEntries(await Promise.all(['cert.pem','key.pem','untrusted-cert.pem','untrusted-key.pem','manifest.json'].map(async n=>[n,await readFile(join(directory,n))])));
    const manifest = JSON.parse(originals['manifest.json'].toString());
    async function changed(name,bytes,check) { await writeFile(join(directory,name),bytes); try { await check(); } finally { await writeFile(join(directory,name),originals[name]); } }
    const reject = () => assert.rejects(validateDocumentTls(root,run),/^Error: DOCUMENT_TLS_FIXTURE_INVALID$/);
    await t.test('two independent RSA fixtures expose only validated public metadata and paths', async () => {
      assert.match(fixture.spki,/^[A-Za-z0-9+/]{43}=$/);
      assert.notEqual(fixture.spki,fixture.untrustedSpki);
      assert.deepEqual(fixture.hosts,DOCUMENT_TLS_HOSTS);
      assert.equal(new X509Certificate(originals['cert.pem']).publicKey.asymmetricKeyDetails.modulusLength,2048);
      assert.equal(Object.values(fixture).some(v=>typeof v==='string'&&v.includes('PRIVATE KEY')),false);
      assert.deepEqual(await validateDocumentTls(root,run),fixture);
    });
    await t.test('existing run cannot be provisioned again or overwrite material', async () => {
      await assert.rejects(provisionDocumentTls(root,run),/^Error: DOCUMENT_TLS_FIXTURE_INVALID$/);
      assert.deepEqual(await readFile(fixture.keyPath),originals['key.pem']);
    });
    await t.test('noncanonical run paths fail before filesystem access', async () => {
      for (const id of ['../outside','',run.toUpperCase(),'00000000']) await assert.rejects(provisionDocumentTls(root,id),/^Error: DOCUMENT_TLS_FIXTURE_INVALID$/);
    });
    await t.test('unknown files are rejected rather than ignored', async () => {
      const extra=join(directory,'extra.txt'); await writeFile(extra,'fixture',{flag:'wx'});
      try { await reject(); } finally { await unlink(extra); }
    });
    await t.test('appended certificate cannot extend the scoped CA set', async () => {
      await changed('cert.pem',Buffer.concat([originals['cert.pem'],originals['untrusted-cert.pem']]),reject);
    });
    await t.test('appended private key and mismatched pair are rejected', async () => {
      await changed('key.pem',Buffer.concat([originals['key.pem'],originals['untrusted-key.pem']]),reject);
      await changed('key.pem',originals['untrusted-key.pem'],reject);
    });
    await t.test('manifest unknown fields, wrong hash and wrong public-key pin are rejected', async () => {
      for (const value of [{...manifest,extra:true},{...manifest,certificateSha256:'0'.repeat(64)},{...manifest,spki:manifest.untrustedSpki}]) await changed('manifest.json',JSON.stringify(value),reject);
    });
    await t.test('different run identity and altered SAN list in manifest are rejected', async () => {
      for (const value of [{...manifest,runId:randomUUID()},{...manifest,hosts:[...manifest.hosts,'outside.test']}]) await changed('manifest.json',JSON.stringify(value),reject);
    });
    await t.test('bounded file reads reject oversize before parsing', async () => {
      await changed('manifest.json','x'.repeat(16385),reject);
      await changed('cert.pem','x'.repeat(16385),reject);
    });
    await t.test('expired and not-yet-valid certificate timing boundaries fail closed', async () => {
      const cert=new X509Certificate(originals['cert.pem']), native=Date.now;
      try { Date.now=()=>Date.parse(cert.validFrom)-1000; await reject(); Date.now=()=>Date.parse(cert.validTo)+1000; await reject(); }
      finally { Date.now=native; }
    });
    await t.test('original valid fixture remains usable after negative controls', async () => {
      assert.deepEqual(await validateDocumentTls(root,run),fixture);
    });
  } finally {
    const actual=await realpath(root);
    assert.equal(actual,resolve(root));
    assert.ok(actual.startsWith(temp+sep+'lumin-document-tls-'));
    await rm(actual,{recursive:true,force:false});
  }
});

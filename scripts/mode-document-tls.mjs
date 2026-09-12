import { lstat, mkdir, open, realpath, readdir, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const fail = () => { throw Error('DOCUMENT_TLS_FIXTURE_INVALID'); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DOCUMENT_TLS_HOSTS = Object.freeze(['renderer.mode.test','api.mode.test','portal.mode.test','merchant.mode.test','second.mode.test','forbidden.mode.test']);
const names = ['cert.pem','key.pem','untrusted-cert.pem','untrusted-key.pem','manifest.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function directory(workspace, runId, create) {
  if (typeof runId !== 'string' || !uuid.test(runId)) fail();
  const root = resolve(workspace), actual = await realpath(root);
  let current = root;
  for (const [index,part] of ['.cache','mode-document-tls',runId].entries()) {
    current = join(current,part);
    if (create) {
      try { await mkdir(current, {mode:0o700}); }
      catch (error) { if (error?.code !== 'EEXIST' || index === 2) fail(); }
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== join(actual,'.cache',...(index >= 1 ? ['mode-document-tls'] : []),...(index === 2 ? [runId] : []))) fail();
  }
  return current;
}
async function readBounded(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 16384) fail();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384 || stat.ino !== before.ino || stat.dev !== before.dev) fail();
    const bytes = Buffer.alloc(16385); let length = 0;
    while (length < bytes.length) { const next = await handle.read(bytes,length,bytes.length-length,length); if (!next.bytesRead) break; length += next.bytesRead; }
    if (!length || length > 16384) fail();
    return bytes.subarray(0,length);
  } finally { await handle.close(); }
}
function inspect(certBytes, keyBytes) {
  const cert = new X509Certificate(certBytes), key = createPrivateKey(keyBytes), publicKey = cert.publicKey;
  const pem = bytes => bytes.toString('utf8').replace(/\r\n/g,'\n').trim();
  if (pem(certBytes) !== cert.toString().trim() || pem(keyBytes) !== key.export({type:'pkcs8',format:'pem'}).toString().trim()) fail();
  if (key.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa' || !Number.isInteger(publicKey.asymmetricKeyDetails?.modulusLength) || publicKey.asymmetricKeyDetails.modulusLength < 2048) fail();
  const der = publicKey.export({type:'spki',format:'der'});
  if (!der.equals(createPublicKey(key).export({type:'spki',format:'der'}))) fail();
  if (cert.subjectAltName !== DOCUMENT_TLS_HOSTS.map(x=>'DNS:'+x).join(', ')) fail();
  if (!cert.verify(publicKey)) fail();
  const start = Date.parse(cert.validFrom), end = Date.parse(cert.validTo), now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end-start > 3*86400000 || now-start > 3*86400000) fail();
  return {spki:createHash('sha256').update(der).digest('base64'),certificateSha256:digest(certBytes)};
}
/** Local fixture material only; never use this as a production credential loader. */
export async function validateDocumentTls(workspace, runId) {
  try {
    const dir = await directory(workspace,runId,false);
    const files = await readdir(dir);
    if (files.length !== names.length || files.some(name=>!names.includes(name))) fail();
    const bytes = await Promise.all(names.map(name=>readBounded(join(dir,name))));
    const trusted = inspect(bytes[0],bytes[1]), untrusted = inspect(bytes[2],bytes[3]);
    if (trusted.spki === untrusted.spki) fail();
    const m = JSON.parse(bytes[4].toString('utf8'));
    const expected = {schemaVersion:1,runId,hosts:[...DOCUMENT_TLS_HOSTS],spki:trusted.spki,untrustedSpki:untrusted.spki,certificateSha256:trusted.certificateSha256,untrustedCertificateSha256:untrusted.certificateSha256};
    if (!m || Object.keys(m).length !== Object.keys(expected).length || Object.keys(expected).some(k=>JSON.stringify(m[k])!==JSON.stringify(expected[k]))) fail();
    return Object.freeze({...expected,hosts:DOCUMENT_TLS_HOSTS,directory:dir,keyPath:join(dir,'key.pem'),certPath:join(dir,'cert.pem'),untrustedKeyPath:join(dir,'untrusted-key.pem'),untrustedCertPath:join(dir,'untrusted-cert.pem')});
  } catch { return fail(); }
}
/** Fresh run only. Uses an explicit config and two disposable keys, without global trust changes. */
export async function provisionDocumentTls(workspace, runId) {
  try {
    const dir = await directory(workspace,runId,true);
    const configuration = '[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ext\n[dn]\nCN=renderer.mode.test\n[ext]\nsubjectAltName='+DOCUMENT_TLS_HOSTS.map(x=>'DNS:'+x).join(',')+'\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n';
    const configPath = join(dir,'openssl.cnf');
    await writeFile(configPath,configuration,{flag:'wx',mode:0o600});
    const executable = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : '/usr/bin/openssl';
    // No inherited OpenSSL config/modules, key logging or proxy variables.
    const env = {};
    for (const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH']) if (typeof process.env[name] === 'string') env[name] = process.env[name];
    env.OPENSSL_CONF = configPath;
    const options = {cwd:dir,env,timeout:20000,maxBuffer:16384,windowsHide:true,encoding:'buffer'};
    for (const prefix of ['', 'untrusted-']) {
      const generated = await execute(executable,['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048'],options);
      await writeFile(join(dir,prefix+'key.pem'),generated.stdout,{flag:'wx',mode:0o600});
      const signed = await execute(executable,['req','-x509','-sha256','-days','2','-config',configPath,'-key',join(dir,prefix+'key.pem')],options);
      await writeFile(join(dir,prefix+'cert.pem'),signed.stdout,{flag:'wx',mode:0o600});
    }
    const [cert,key,otherCert,otherKey] = await Promise.all(names.slice(0,4).map(name=>readBounded(join(dir,name))));
    const a=inspect(cert,key), b=inspect(otherCert,otherKey);
    const manifest={schemaVersion:1,runId,hosts:[...DOCUMENT_TLS_HOSTS],spki:a.spki,untrustedSpki:b.spki,certificateSha256:a.certificateSha256,untrustedCertificateSha256:b.certificateSha256};
    await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
    await unlink(configPath);
    return await validateDocumentTls(workspace,runId);
  } catch { return fail(); }
}

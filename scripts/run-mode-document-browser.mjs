import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runBoundedChild, scopedOwnerBrowserCache } from './run-mode-owner-browser.mjs';
import { provisionDocumentTls } from './mode-document-tls.mjs';
import { validateDocumentArtifacts } from './mode-document-artifacts.mjs';
const fail=()=>{throw Error('DOCUMENT_RUN_CONFIGURATION_INVALID');};
export function validateDocumentRunEnvironment(env) {
  for(const name of ['LOCAL_HARNESS','FLOW_TEST_DISPOSABLE','MODE_INSTALLATIONS_TEST_DISPOSABLE','MODE_DOCUMENT_TEST_DISPOSABLE']) if(env[name]!=='1') fail();
  if(!['public','extensions'].includes(env.MODE_DOCUMENT_CRYPTO_LAYOUT)||!['127.0.0.1','localhost'].includes(env.PGHOST)||env.PGUSER!=='postgres'||!/^lumin_mode_document_[a-z0-9_]{1,43}$/.test(env.PGDATABASE??'')) fail();
  if(!/^[1-9][0-9]{0,4}$/.test(env.PGPORT??'')||Number(env.PGPORT)>65535) fail();
  if(env.PGPASSWORD!==undefined&&!['','postgres'].includes(env.PGPASSWORD)) fail();
  for(const name of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS']) if(env[name]) fail();
  const ports=['API','RENDERER','PORTAL','MERCHANT','SECOND','FORBIDDEN','UNTRUSTED'].map(role=>env['MODE_DOCUMENT_'+role+'_PORT']);
  if(ports.some(p=>typeof p!=='string'||!/^[1-9][0-9]{3,4}$/.test(p)||Number(p)<1024||Number(p)>65535)||new Set(ports).size!==7) fail();
  return Object.freeze({layout:env.MODE_DOCUMENT_CRYPTO_LAYOUT});
}
async function main() {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  let receipt={schemaVersion:1,status:'failed',category:'CONFIGURATION_FAILED',artifacts:[]};
  try {
    const environment={...process.env}, selection=validateDocumentRunEnvironment(environment);
    const git=args=>execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
    const candidate=git(['rev-parse','HEAD']); if(!/^[0-9a-f]{40}$/.test(candidate)) fail();
    const sourceDirty=git(['status','--porcelain']).length>0;
    const browserCache=await scopedOwnerBrowserCache(root), runId=randomUUID();
    const tls=await provisionDocumentTls(root,runId);
    const child=await runBoundedChild(process.execPath,[resolve(root,'node_modules/@playwright/test/cli.js'),'test','--config=playwright.mode-document.config.ts'],{
      cwd:root,env:{...environment,PLAYWRIGHT_BROWSERS_PATH:browserCache,PLAYWRIGHT_NO_COPY_PROMPT:'1',MODE_DOCUMENT_ARTIFACT_RUN_ID:runId,MODE_DOCUMENT_TLS_DIR:tls.directory},timeoutMs:600000,outputLimit:131072,
    });
    receipt={schemaVersion:1,...child,artifactRunId:runId,candidate,sourceDirty,cryptoLayout:selection.layout,tlsTrust:'local-scoped-spki-exception',certificateSha256:tls.certificateSha256,untrustedCertificateSha256:tls.untrustedCertificateSha256,artifacts:[]};
    try {
      const artifacts=await validateDocumentArtifacts(root,runId);
      if(child.status==='passed'&&artifacts.status!=='passed') receipt={...receipt,status:'failed',category:'ARTIFACT_STATUS_FAILED'};
      receipt={...receipt,artifacts:artifacts.files};
    } catch { receipt={...receipt,status:'failed',category:'ARTIFACT_VALIDATION_FAILED',artifacts:[]}; }
  } catch { /* Fixed output only: configuration, TLS and child details may contain private fixture material. */ }
  process.stdout.write(JSON.stringify(receipt)+'\n');
  if(receipt.status!=='passed') process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();

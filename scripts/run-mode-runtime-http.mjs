import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runBoundedChild } from './run-mode-owner-browser.mjs';
import { validateRuntimeRunEnvironment } from './run-mode-runtime-browser.mjs';
import { provisionDocumentTls } from './mode-document-tls.mjs';
import { buildModeRuntime } from './build-mode-runtime.mjs';
async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 let receipt={schemaVersion:1,status:'failed',category:'CONFIGURATION_FAILED'};
 try{
  const environment={...process.env},selection=validateRuntimeRunEnvironment(environment),runId=randomUUID();
  const tls=await provisionDocumentTls(root,runId);
  const built=await buildModeRuntime({identity:{abiVersion:1,profileVersion:'local-runtime-v1',rendererOrigin:'https://renderer.mode.test:'+environment.MODE_DOCUMENT_RENDERER_PORT,apiOrigin:'https://api.mode.test:'+environment.MODE_DOCUMENT_API_PORT,portalOrigin:'https://portal.mode.test:'+environment.MODE_DOCUMENT_PORTAL_PORT}});
  const child=await runBoundedChild(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),'tests/mode-runtime/runtime.integration.ts'],{cwd:root,env:{...environment,MODE_DOCUMENT_TLS_DIR:tls.directory,MODE_RUNTIME_ASSET_DIR:built.directory},timeoutMs:300000,outputLimit:65536});
  receipt={schemaVersion:1,...child,cryptoLayout:selection.layout,tlsTrust:'local-scoped-ca',certificateSha256:tls.certificateSha256,untrustedCertificateSha256:tls.untrustedCertificateSha256};
 }catch{/* Never serialize fixture material or startup exceptions. */}
 process.stdout.write(JSON.stringify(receipt)+'\n');if(receipt.status!=='passed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

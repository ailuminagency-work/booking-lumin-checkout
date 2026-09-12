import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOwnerBrowser } from './install-mode-owner-browser.mjs';
import { scopedRuntimeBrowserCache } from './mode-runtime-browser-cache.mjs';
import { runBoundedChild } from './run-mode-owner-browser.mjs';
/** Reuse accepted mirror validation and process bounds, selecting the full pinned browser. */
export async function installRuntimeBrowser({root,env=process.env,platform=process.platform,run=runBoundedChild,cacheFor=scopedRuntimeBrowserCache}){
  return installOwnerBrowser({root,env,platform,cacheFor,run:(command,args,options)=>run(command,args.filter(a=>a!=='--only-shell'),options)});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await installRuntimeBrowser({root:resolve(dirname(fileURLToPath(import.meta.url)),'..')});
 process.stdout.write(JSON.stringify({schemaVersion:1,...result})+'\n');if(result.status!=='passed')process.exitCode=1;
}

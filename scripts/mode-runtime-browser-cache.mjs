import { mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function scopedRuntimeBrowserCache(root) {
  root=resolve(root);const actual=await realpath(root);
  for(const parts of [['.cache'],['.cache','mode-runtime-playwright']]){
    const dir=resolve(root,...parts);await mkdir(dir,{recursive:true});
    if((await lstat(dir)).isSymbolicLink()||await realpath(dir)!==resolve(actual,...parts))throw Error('RUNTIME_BROWSER_CACHE_UNSAFE');
  }
  return resolve(root,'.cache','mode-runtime-playwright');
}

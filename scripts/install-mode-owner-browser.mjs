import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopedOwnerBrowserCache, runBoundedChild } from './run-mode-owner-browser.mjs';

export async function installOwnerBrowser({root, env = process.env, platform = process.platform, cacheFor = scopedOwnerBrowserCache, run = runBoundedChild}) {
  let result = { category: 'INSTALL_PREFLIGHT_FAILED', status: 'failed' };
  try {
    const captured = {...env};
    // Playwright accepts direct and npm configuration aliases for download mirrors.
    // Validate before touching the cache or starting any installer process.
    for (const [key,value] of Object.entries(captured)) {
      const normalized = key.toLowerCase().replace(/^npm_(?:package_)?config_/, '');
      if (/^playwright_(?:[a-z0-9]+_)*download_host$/.test(normalized) && value) return result;
    }
    const cache = await cacheFor(root);
    const args = [resolve(root,'node_modules/@playwright/test/cli.js'),'install'];
    if (platform === 'linux' && captured.CI === 'true') args.push('--with-deps');
    args.push('--only-shell','chromium');
    result = await run(process.execPath,args,{cwd:root,env:{...captured,PLAYWRIGHT_BROWSERS_PATH:cache},timeoutMs:300000});
  } catch { /* Never expose inherited settings or raw startup exceptions. */ }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await installOwnerBrowser({root});
  process.stdout.write(JSON.stringify({schemaVersion:1,...result})+'\n');
  if(result.status !== 'passed')process.exitCode=1;
}

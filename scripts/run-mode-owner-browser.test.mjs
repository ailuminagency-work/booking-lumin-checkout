import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedChild } from './run-mode-owner-browser.mjs';

test('startup and worker-style errors cannot enter the bounded receipt', async () => {
  const sentinel = 'private-synthetic-owner-sentinel';
  const result = await runBoundedChild(process.execPath, ['-e', `process.stdout.write('${sentinel}');process.stderr.write('${sentinel}');process.exit(1)`], { timeoutMs: 10000 });
  assert.deepEqual(result, { category: 'BROWSER_TEST_FAILED', status: 'failed' });
  assert.ok(!JSON.stringify(result).includes(sentinel));
});
test('excess output stops and reaps the owned child without retaining its bytes', async () => {
  const result = await runBoundedChild(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("x".repeat(4096)),1)'], { timeoutMs: 10000, outputLimit: 8192 });
  assert.deepEqual(result, { category: 'OUTPUT_LIMIT', status: 'failed' });
});
test('a stalled child is terminated at its deadline', async () => {
  const result = await runBoundedChild(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
  assert.deepEqual(result, { category: 'RUN_TIMEOUT', status: 'failed' });
});
test('successful fixed child yields only the passing category', async () => {
  assert.deepEqual(await runBoundedChild(process.execPath, ['-e', 'process.stdout.write("discard me")'], { timeoutMs: 10000 }), { category: 'COMPLETE', status: 'passed' });
});

test('installer and runner share a preflight that rejects redirected caches', async()=>{
 const {mkdtemp,symlink,mkdir}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {scopedOwnerBrowserCache}=await import('./run-mode-owner-browser.mjs');
 const root=await mkdtemp(join(tmpdir(),'lumin-browser-cache-')),target=await mkdtemp(join(tmpdir(),'lumin-browser-redirect-'));
 await symlink(target,join(root,'.cache'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(scopedOwnerBrowserCache(root),/BROWSER_CACHE_UNSAFE/);
 const good=await mkdtemp(join(tmpdir(),'lumin-browser-cache-good-'));
 assert.equal(await scopedOwnerBrowserCache(good),join(good,'.cache','mode-owner-playwright'));
});

test('download mirror overrides and npm aliases reject before cache or process creation',async()=>{
 const {installOwnerBrowser}=await import('./install-mode-owner-browser.mjs');
 for(const prefix of ['', 'npm_config_', 'npm_package_config_'])for(const suffix of ['PLAYWRIGHT_DOWNLOAD_HOST','PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST','PLAYWRIGHT_FFMPEG_DOWNLOAD_HOST']){
  let touched=false;const key=prefix?prefix+suffix.toLowerCase():suffix;
  const result=await installOwnerBrowser({root:process.cwd(),env:{[key]:'https://synthetic-mirror.invalid'},cacheFor:async()=>{touched=true;throw Error();},run:async()=>{touched=true;throw Error();}});
  assert.deepEqual(result,{category:'INSTALL_PREFLIGHT_FAILED',status:'failed'});assert.equal(touched,false);
 }
});
test('default installer uses captured environment and fixed pinned CLI',async()=>{
 const {installOwnerBrowser}=await import('./install-mode-owner-browser.mjs');
 const env={CI:'true',PLAYWRIGHT_DOWNLOAD_HOST:''};let invocation;
 const result=await installOwnerBrowser({root:process.cwd(),env,platform:'linux',cacheFor:async()=>{env.PLAYWRIGHT_DOWNLOAD_HOST='https://late.invalid';return '/scoped-cache';},run:async(command,args,options)=>{invocation={command,args,options};return {category:'COMPLETE',status:'passed'};}});
 assert.equal(result.status,'passed');assert.equal(invocation.command,process.execPath);
 assert.deepEqual(invocation.args.slice(1),['install','--with-deps','--only-shell','chromium']);
 assert.equal(invocation.options.env.PLAYWRIGHT_DOWNLOAD_HOST,'');assert.equal(invocation.options.env.PLAYWRIGHT_BROWSERS_PATH,'/scoped-cache');
 assert.equal(invocation.options.timeoutMs,300000);
});

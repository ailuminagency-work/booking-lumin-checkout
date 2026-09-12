import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { test as base, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTls, observer, seed, snapshot, startWorld, closeWithin, assertNativeNoReferrer, assertNativePrivacy, assertPolicyQueries, HOSTS, BROWSER_HOSTS, type TlsFixture, type World } from './fixtures';
import { artifactDirectory } from './safe-reporter';
import type { Pool } from 'pg';
type Journey = { db: Pool; w: World; tls: TlsFixture; local: Awaited<ReturnType<typeof startWorld>>; page: Page; context: BrowserContext; capture(name: string, width: number): Promise<void>; unchanged(): Promise<void>; downloadDenied(): boolean; };
const pngs = new Set(['runtime-01-1440.png', 'runtime-02-768.png', 'runtime-05-1440.png', 'runtime-16-320.png', 'runtime-16-768.png', 'runtime-16-1440.png']);
/** Cases10/13 use an owned default context: public noDefaults permits real visibility. */
async function ownedVisibleBrowser(t: TlsFixture) {
  const root=path.resolve(process.cwd()), canonical=await fs.realpath(root);let directory=root;
  for(const part of ['.cache','mode-runtime-browser-profiles',randomUUID()]) {
    directory=path.join(directory,part);
    try{await fs.lstat(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('PROFILE_PATH_FAILED');await fs.mkdir(directory);}
    const stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory()||await fs.realpath(directory)!==path.join(canonical,directory.slice(root.length+1)))throw Error('PROFILE_PATH_DENIED');
  }
  const cache=path.resolve('.cache/mode-runtime-playwright');
  const cacheStat=await fs.lstat(cache);if(cacheStat.isSymbolicLink()||!cacheStat.isDirectory()||await fs.realpath(cache)!==path.join(canonical,'.cache','mode-runtime-playwright'))throw Error('BROWSER_CACHE_DENIED');
  const executable=chromium.executablePath();const actualExecutable=await fs.realpath(executable);
  if(!actualExecutable.startsWith(await fs.realpath(cache)+path.sep))throw Error('BROWSER_EXECUTABLE_DENIED');
  let childProcess:ChildProcess|undefined,browser:Browser|undefined,ended=false,output=0,failed=false;
  let exitResolve!:()=>void;const exited=new Promise<void>(r=>{exitResolve=r;});
  let killing:Promise<void>|undefined;
  const kill=():Promise<void>=>{
    if(killing)return killing;
    if(!childProcess||ended||!childProcess.pid)return Promise.resolve();
    const owned=childProcess,pid=owned.pid!;
    killing=(async()=>{
      if(ended)return;
      if(process.platform==='win32')await new Promise<void>(resolve=>execFile('taskkill',['/pid',String(pid),'/T','/F'],{windowsHide:true,timeout:5000},()=>resolve()));
      else{try{process.kill(-pid,'SIGKILL');}catch{if(!ended)owned.kill('SIGKILL');}}
    })();
    return killing;
  };
  let lifecycleGuard:ReturnType<typeof setTimeout>|undefined;
  const close=async()=>{
    clearTimeout(lifecycleGuard);let guard:ReturnType<typeof setTimeout>|undefined;
    try{
      await Promise.race([
        (async()=>{try{if(browser){const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close');}}catch{}finally{await kill();}await exited;if(browser)await browser.close();})(),
        new Promise<never>((_,reject)=>{guard=setTimeout(()=>{void kill();reject(Error('VISIBLE_BROWSER_CLEANUP_TIMEOUT'));},10000);}),
      ]);
      if(!ended)throw Error('VISIBLE_BROWSER_EXIT_NOT_OBSERVED');
    }finally{clearTimeout(guard);}
  };
  try{
    const args=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+directory,
      '--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--disable-extensions','--disable-client-side-phishing-detection','--disable-back-forward-cache',
      '--ignore-certificate-errors-spki-list='+t.spki,'--host-resolver-rules='+BROWSER_HOSTS.map(h=>'MAP '+h+' 127.0.0.1').join(', '),'--no-proxy-server','about:blank'];
    childProcess=spawn(executable,args,{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    childProcess.once('exit',()=>{ended=true;exitResolve();});childProcess.once('error',()=>{failed=true;ended=true;exitResolve();});
    for(const stream of [childProcess.stdout,childProcess.stderr])stream!.on('data',(data:Buffer)=>{output+=data.length;if(output>131072){failed=true;void kill();}});
    lifecycleGuard=setTimeout(()=>{failed=true;void kill();},100000);
    const until=Date.now()+10000;let port:number|undefined;
    while(Date.now()<until&&!port){
      if(ended||failed)throw Error('VISIBLE_BROWSER_START_FAILED');const file=path.join(directory,'DevToolsActivePort');
      try{
        const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)throw Error('CDP_ENDPOINT_DENIED');
        const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let text='';try{const opened=await handle.stat();if(opened.ino!==stat.ino||opened.dev!==stat.dev||!opened.isFile())throw Error('CDP_ENDPOINT_DENIED');const bytes=Buffer.alloc(1025);const read=await handle.read(bytes,0,1025,0);if(read.bytesRead>1024)throw Error('CDP_ENDPOINT_DENIED');text=bytes.subarray(0,read.bytesRead).toString('utf8');}finally{await handle.close();}
        const lines=text.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n');if(lines.length!==2||!/^[1-9][0-9]{3,4}$/.test(lines[0]!)||Number(lines[0])>65535||!/^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lines[1]!))throw Error('CDP_ENDPOINT_DENIED');port=Number(lines[0]);
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await new Promise(r=>setTimeout(r,50));}
    }
    if(!port||ended||failed)throw Error('VISIBLE_BROWSER_START_FAILED');
    browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{noDefaults:true,timeout:5000});
    if(browser.version()!=='153.0.8010.12'||browser.contexts().length!==1)throw Error('VISIBLE_BROWSER_PIN_FAILED');
    const context=browser.contexts()[0]!;const session=await browser.newBrowserCDPSession();let downloadCancelled=false;let downloadEvents=0;session.on('Browser.downloadProgress',event=>{if(++downloadEvents>16)failed=true;if(event.state==='canceled')downloadCancelled=true;});await session.send('Browser.setDownloadBehavior',{behavior:'deny',eventsEnabled:true});
    return{browser,context,close,downloadDenied:()=>downloadCancelled,healthy:()=>!failed&&!ended};
  }catch{await close();throw Error('VISIBLE_BROWSER_SETUP_FAILED');}
}
export const test = base.extend<{ journey: Journey }>({
  journey: async ({}, use, info) => {
    let finalChecks:(()=>void)|undefined;let phase='tls'; let visible: Awaited<ReturnType<typeof ownedVisibleBrowser>> | undefined; let browser: Browser | undefined, context: BrowserContext | undefined, db: Pool | undefined, local: Awaited<ReturnType<typeof startWorld>> | undefined;
    try {
      const t = await loadTls(); phase='database'; db = await observer(); phase='seed'; const w = await seed(db, info.title.startsWith('runtime-16'));
      phase='servers'; local = await startWorld(t); const before = await snapshot(db, w.f);
      phase='browser'; if(info.title.startsWith('runtime-13')||info.title.startsWith('runtime-10')){visible=await ownedVisibleBrowser(t);browser=visible.browser;context=visible.context;}else{
      browser = await chromium.launch({ headless: false, args: ['--ignore-certificate-errors-spki-list=' + t.spki, '--host-resolver-rules=' + BROWSER_HOSTS.map(h => 'MAP ' + h + ' 127.0.0.1').join(', '), '--no-proxy-server'] });
      expect(browser.version()).toBe('153.0.8010.12'); context = await browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } }); }
      let forbidden = false, requests = 0; let referrerRole='none',referrerResource='none'; const violations={host:false,route:false,auth:false,cookie:false,referrer:false,bound:false};
      context.on('request', req => { requests++; if(requests>1000)violations.bound=true; const u=new URL(req.url()); if(!local!.observedOrigins.includes(u.origin))violations.host=true; if(/session|submit|api\/local|token|credential/.test(u.pathname))violations.route=true; const headers=req.headers(); if(headers.authorization!==undefined)violations.auth=true; if(headers.cookie!==undefined)violations.cookie=true; if(headers.referer!==undefined){violations.referrer=true;if(referrerRole==='none'){referrerResource=['document','script','fetch','other'].includes(req.resourceType())?req.resourceType():'unclassified';referrerRole=u.pathname.startsWith('/api/public/')?'policy':u.hostname===HOSTS[0]?(u.pathname.startsWith('/assets/')?'asset':'document'):u.pathname==='/download-fixture'?'download':u.pathname.startsWith('/fixture/')?'merchant':'other';}} forbidden=violations.host||violations.route||violations.auth||violations.cookie||violations.bound; });
      await context.route('**/*',async route=>{const u=new URL(route.request().url());if(!local!.observedOrigins.includes(u.origin)){violations.host=true;forbidden=true;await route.abort('blockedbyclient');return;}await route.continue();});
      phase='page'; const page = await context.newPage();
      phase='test'; await use({ db, w, tls: t, local, page, context, downloadDenied:()=>visible?.downloadDenied()??false, unchanged: async () => { expect(await snapshot(db!, w.f)).toEqual(before); }, capture: async (name, width) => {
        expect(pngs.has(name)).toBe(true); await page.setViewportSize({ width, height: width === 320 ? 740 : width === 768 ? 1024 : 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const png = await page.screenshot({ animations: 'disabled', fullPage: false }); expect(png.length).toBeLessThanOrEqual(5 * 1024 * 1024); await fs.writeFile(path.join(artifactDirectory(), name), png, { flag: 'wx' });
      } });
      phase='health';if(visible)expect(visible.healthy()).toBe(true);finalChecks=()=>{
      phase='wire_bound';expect(local!.wireHealthy()).toBe(true);for(const [role,value] of Object.entries(local!.wirePrivacy)){phase='wire_referrer_'+role;expect(value.referrer).toBe(0);}assertNativeNoReferrer(local!.wirePrivacy);assertNativePrivacy(local!.wirePrivacy);assertPolicyQueries(local!.queries);for(const key of ['host','route','auth','cookie','bound'] as const){phase='privacy_'+key;expect(violations[key]).toBe(false);}phase='privacy';expect(forbidden).toBe(false);phase='issuance';expect(local!.attempted.issuance).toBe(0);
      };
    } catch(error) { if(error instanceof Error && /^SAFE_RUNTIME_ASSERTION_FAILED(?:_[A-Z_]+)?$/.test(error.message))throw error; throw Error('SAFE_RUNTIME_FIXTURE_FAILED_'+phase.toUpperCase()); }
    finally { await closeWithin([async()=>{try{if(visible)await visible.close();else{try{if(context)await context.close();}finally{if(browser)await browser.close();}}finalChecks?.();}finally{await Promise.all([...(local?[local.close()]:[]),...(db?[db.end()]:[])]);}}]).catch(()=>{throw Error('SAFE_RUNTIME_CLEANUP_FAILED_'+phase.toUpperCase());}); }
  },
});
export { expect };











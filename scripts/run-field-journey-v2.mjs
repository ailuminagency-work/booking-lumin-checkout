import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createFieldJourneyV2Environment } from '../packages/action-api/server/field-journey-v2-environment.ts';
import { runFieldJourneyV2BrowserCases } from '../tests/field-journey-v2/browser-cases.ts';
import { fieldJourneyV2Browser } from './run-field-journey-v2-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const receipt = { schemaVersion: 1, kind: 'FIELD_V2_SQL_BROWSER', status: 'failed', category: 'CONFIGURATION_FAILED', cases: 0, browserClosed: false, serversClosed: false, connectionsClosed: false };
async function bounded(task, milliseconds) {
  let timer;
  try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('TIME_BOUND')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const watchdog=setTimeout(()=>{receipt.status='failed';receipt.category='TIME_BOUND';process.stdout.write(JSON.stringify(receipt)+'\n');process.exit(1);},230000);
let environment, fixture, browser, disconnected = false, environmentStarted = false, browserStarted = false;
const sockets = new Set();
let fixtureFault=false;
try {
  const executablePath = await fieldJourneyV2Browser({root});
  const html = await readFile(resolve(root, 'tests/field-journey-v2/fixture.html'));
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/field-journey-v2/fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', sourcemap: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } });
  if (bundle.outputFiles.length !== 1) throw Error('CONFIGURATION_FAILED');
  receipt.category = 'ENVIRONMENT_FAILED';
  environmentStarted = true;
  environment = await createFieldJourneyV2Environment(process.env);
  fixture = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:4192') { response.writeHead(404).end(); return; }
    if(typeof request.url!=='string'||!/^\/(?:edit|other|fixture\.js)?(?:\?[^\s#\\]*)?$/.test(request.url)){response.writeHead(404).end();return;}
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1:4192'); } catch { response.writeHead(400).end(); return; }
    if (url.origin !== 'http://127.0.0.1:4192') { response.writeHead(404).end(); return; }
    if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
    else if (['/', '/edit', '/other'].includes(url.pathname)) { response.setHeader('Content-Type', 'text/html'); response.end(html); }
    else response.writeHead(404).end();
  });
  fixture.on('error',()=>{fixtureFault=true;});
  fixture.requestTimeout = 5000; fixture.headersTimeout = 5000; fixture.keepAliveTimeout = 1000;
  fixture.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await bounded(new Promise((accept, reject) => { fixture.once('error', reject); fixture.listen(4192, '127.0.0.1', accept); }), 5000);
  receipt.category = 'BROWSER_FAILED';
  browserStarted = true;
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
  browser.once('disconnected', () => { disconnected = true; });
  receipt.category = 'CASE_FAILED';
  const outcome = await bounded(runFieldJourneyV2BrowserCases(browser, { ...environment.config, fixtureOrigin: 'http://127.0.0.1:4192' }, environment), 120000);
  if (outcome.cases !== 6) throw Error('CASE_FAILED');
  receipt.cases = outcome.cases; receipt.status = 'passed'; receipt.category = 'COMPLETE';
} catch (error) { receipt.status = 'failed'; if (/^JOURNEY_BROWSER_CASE_(?:[1-6]|1_(?:PAGE|LOAD|EDIT|SAVE|SQL|PREVIEW|PREVIEW_SQL|RELOAD))$/.test(error?.message)) receipt.category = error.message; }
finally {
  let fixtureClosed=false, environmentServersClosed=false, otherFailure=false, browserFailure=null;
  try {
    if(browser){
      let timer;
      const timeout=Symbol('browser close timeout');
      try {
        await Promise.race([browser.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout),10000);})]);
      } catch(error) { browserFailure=error===timeout?'CLEANUP_BROWSER_TIMEOUT':'CLEANUP_BROWSER_REJECTED'; }
      finally {clearTimeout(timer);}
      if(!browserFailure && (!disconnected || browser.isConnected())) browserFailure='CLEANUP_BROWSER_OBSERVATION';
    } else if(browserStarted) browserFailure='CLEANUP_BROWSER_OBSERVATION';
    receipt.browserClosed=browserFailure===null;
  } catch {browserFailure='CLEANUP_BROWSER_OBSERVATION';}
  try {
    if(fixture){
      await bounded(new Promise((accept,reject)=>{fixture.close(error=>error?reject(error):accept());for(const socket of sockets)socket.destroy();}),5000);
      await bounded((async()=>{while(sockets.size)await new Promise(resolve=>setTimeout(resolve,10));})(),3000);
      if(fixture.listening || sockets.size!==0)throw Error('CLEANUP');
    }
    fixtureClosed=!fixtureFault;
    if(!fixtureClosed)otherFailure=true;
  } catch {otherFailure=true;}
  try {
    if(environment){
      const closed=await bounded(environment.close(),15000);
      environmentServersClosed=closed.serversClosed===true;
      receipt.connectionsClosed=closed.connectionsClosed===true;
      if(!environmentServersClosed || !receipt.connectionsClosed)throw Error('CLEANUP');
    } else if(environmentStarted)throw Error('CLEANUP');
    else {environmentServersClosed=true;receipt.connectionsClosed=true;}
  } catch {otherFailure=true;}
  receipt.serversClosed=fixtureClosed && environmentServersClosed;
  if(browserFailure || otherFailure){receipt.status='failed';receipt.category=otherFailure?'CLEANUP_UNOBSERVED':browserFailure;}
}

clearTimeout(watchdog);
process.stdout.write(JSON.stringify(receipt) + '\n');
process.exitCode = receipt.status === 'passed' ? 0 : 1;

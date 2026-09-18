import { createServer } from 'node:http';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createTextJourneyEnvironment } from '../packages/action-api/server/text-journey-environment.ts';
import { runTextJourneyBrowserCases } from '../tests/text-journey/browser-cases.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const receipt = { schemaVersion: 1, kind: 'TEXT_SQL_BROWSER', status: 'failed', category: 'CONFIGURATION_FAILED', cases: 0, browserClosed: false, serversClosed: false, connectionsClosed: false };
async function bounded(task, milliseconds) {
  let timer;
  try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('TIME_BOUND')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
let environment, fixture, browser, disconnected = false, environmentStarted = false, browserStarted = false;
const sockets = new Set();
try {
  if (process.platform !== 'win32' || process.env.TEXT_JOURNEY_APPROVED !== '1') throw Error('CONFIGURATION_FAILED');
  const manifest = JSON.parse(await readFile(resolve(root, 'node_modules/playwright-core/browsers.json'), 'utf8'));
  if (!manifest.browsers.some(entry => entry.name === 'chromium' && entry.revision === '1243')) throw Error('CONFIGURATION_FAILED');
  const executablePath = resolve(root, '../mode-session-http/.cache/mode-runtime-playwright/chromium-1243/chrome-win64/chrome.exe');
  if (!(await lstat(executablePath)).isFile() || (await realpath(executablePath)).toLowerCase() !== executablePath.toLowerCase()) throw Error('CONFIGURATION_FAILED');
  const html = await readFile(resolve(root, 'tests/text-journey/fixture.html'));
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/text-journey/fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', sourcemap: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } });
  if (bundle.outputFiles.length !== 1) throw Error('CONFIGURATION_FAILED');
  receipt.category = 'ENVIRONMENT_FAILED';
  environmentStarted = true;
  environment = await createTextJourneyEnvironment(process.env);
  fixture = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:4191') { response.writeHead(404).end(); return; }
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1:4191'); } catch { response.writeHead(400).end(); return; }
    if (url.origin !== 'http://127.0.0.1:4191') { response.writeHead(404).end(); return; }
    if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
    else if (['/', '/edit', '/other'].includes(url.pathname)) { response.setHeader('Content-Type', 'text/html'); response.end(html); }
    else response.writeHead(404).end();
  });
  fixture.requestTimeout = 5000; fixture.headersTimeout = 5000; fixture.keepAliveTimeout = 1000;
  fixture.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await bounded(new Promise((accept, reject) => { fixture.once('error', reject); fixture.listen(4191, '127.0.0.1', accept); }), 5000);
  receipt.category = 'BROWSER_FAILED';
  browserStarted = true;
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
  browser.once('disconnected', () => { disconnected = true; });
  receipt.category = 'CASE_FAILED';
  const outcome = await bounded(runTextJourneyBrowserCases(browser, { ...environment.config, fixtureOrigin: 'http://127.0.0.1:4191' }, environment), 120000);
  if (outcome.cases !== 6) throw Error('CASE_FAILED');
  receipt.cases = outcome.cases; receipt.status = 'passed'; receipt.category = 'COMPLETE';
} catch (error) { receipt.status = 'failed'; if (/^JOURNEY_BROWSER_CASE_[1-6]$/.test(error?.message)) receipt.category = error.message; }
finally {
  let failed = false;
  try { if (browser) { await bounded(browser.close(), 10000); if (!disconnected || browser.isConnected()) throw Error('CLEANUP'); } else if (browserStarted) throw Error('CLEANUP'); receipt.browserClosed = true; } catch { failed = true; }
  try { if (fixture) { await bounded(new Promise((accept, reject) => { fixture.close(error => error ? reject(error) : accept()); for (const socket of sockets) socket.destroy(); }), 5000); if (fixture.listening || sockets.size !== 0) throw Error('CLEANUP'); } } catch { failed = true; }
  try { if (environment) { const closed = await bounded(environment.close(), 15000); if (closed.serversClosed !== true || closed.connectionsClosed !== true) throw Error('CLEANUP'); } else if (environmentStarted) throw Error('CLEANUP'); receipt.connectionsClosed = true; if (!failed) receipt.serversClosed = true; } catch { failed = true; }
  if (failed) { receipt.status = 'failed'; receipt.category = 'CLEANUP_UNOBSERVED'; }
}
process.stdout.write(JSON.stringify(receipt) + '\n');
process.exitCode = receipt.status === 'passed' ? 0 : 1;

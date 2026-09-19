import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

async function main() {
// Synthetic browser fixture only. No filesystem request handler or external API.
if (process.env.FIELD_BROWSER_V2_APPROVED !== '1') throw Error('FIXTURE_NOT_APPROVED');
const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(resolve(root, 'tests/field-browser-v2/fixture.html'));
const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/field-browser-v2/fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', sourcemap: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } });
if (bundle.outputFiles.length !== 1) throw Error('FIXTURE_BUNDLE_INVALID');
const script = bundle.outputFiles[0].contents;
const sockets = new Set();
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:4190') { response.writeHead(404).end(); return; }
  if(typeof request.url !== 'string' || !/^\/(?:edit|other|fixture\.js)?(?:\?[^\s#\\]*)?$/.test(request.url)) { response.writeHead(404).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:4190');
  if (url.origin !== 'http://127.0.0.1:4190') { response.writeHead(404).end(); return; }
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }
  else if (['/', '/edit', '/other'].includes(url.pathname)) { response.setHeader('Content-Type', 'text/html'); response.end(html); }
  else response.writeHead(404).end();
});
server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
let stopping = false, serverClosed = false, cleanup;
function observedClose() { if(serverClosed && sockets.size===0 && cleanup) clearTimeout(cleanup); }
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); observedClose(); }); });
function stop() {
  if(stopping)return;
  stopping=true;clearTimeout(deadline);
  cleanup=setTimeout(()=>{process.stderr.write('FIXTURE_CLEANUP_FAILED\n');process.exit(1);},3000);
  server.close(()=>{serverClosed=true;observedClose();});
  for(const socket of sockets)socket.destroy();
}
const deadline = setTimeout(stop, 270000);
process.once('SIGTERM', stop); process.once('SIGINT', stop);
server.once('error', () => { process.exitCode = 1; stop(); });
server.listen(4190, '127.0.0.1');

}
main().catch(()=>{process.stderr.write('FIXTURE_FAILED\n');process.exitCode=1;});

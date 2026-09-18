import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Synthetic browser fixture only. No filesystem request handler or external API.
if (process.env.TEXT_BROWSER_APPROVED !== '1') throw Error('FIXTURE_NOT_APPROVED');
const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(resolve(root, 'tests/text-browser/fixture.html'));
const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/text-browser/fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', sourcemap: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } });
if (bundle.outputFiles.length !== 1) throw Error('FIXTURE_BUNDLE_INVALID');
const script = bundle.outputFiles[0].contents;
const sockets = new Set();
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:4189') { response.writeHead(404).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:4189');
  if (url.origin !== 'http://127.0.0.1:4189') { response.writeHead(404).end(); return; }
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }
  else if (['/', '/edit', '/other'].includes(url.pathname)) { response.setHeader('Content-Type', 'text/html'); response.end(html); }
  else response.writeHead(404).end();
});
server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
let stopping = false;
function stop() { if (stopping) return; stopping = true; clearTimeout(deadline); server.close(); for (const socket of sockets) socket.destroy(); }
const deadline = setTimeout(stop, 270000);
process.once('SIGTERM', stop); process.once('SIGINT', stop);
server.once('error', () => { clearTimeout(deadline); process.exitCode = 1; });
server.listen(4189, '127.0.0.1');

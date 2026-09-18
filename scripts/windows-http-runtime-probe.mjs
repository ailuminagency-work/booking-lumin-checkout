/** Bounded synthetic Node HTTP diagnostic; inert on import. No application dependencies. */
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function runWindowsHttpRuntimeProbe() {
  const result = { schemaVersion: 1, kind: 'WINDOWS_HTTP_RUNTIME_PROBE', status: 'failed', category: 'CONFIGURATION_FAILED', runtime: process.version, platform: process.platform, architecture: process.arch, admitted: 0, completed: 0, errors: 0, serverClosed: false, socketsClosed: false };
  if (process.env.WINDOWS_HTTP_RUNTIME_PROBE_APPROVED !== '1' || process.platform !== 'win32') return result;
  const serverSockets = new Set(), clientSockets = new Set(), requests = new Set();
  const agent = new http.Agent({ keepAlive: false, maxSockets: 32 });
  let stopping = false, listening = false, serverCloseObserved = false, emitted = false;
  const server = http.createServer((request, response) => {
    request.on('error', () => { result.errors++; stopping = true; });
    response.on('error', () => { result.errors++; stopping = true; });
    request.resume(); response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '2', Connection: 'close' }); response.end('ok');
  });
  server.on('connection', socket => { serverSockets.add(socket); socket.on('error', () => { result.errors++; stopping = true; }); socket.once('close', () => serverSockets.delete(socket)); });
  server.on('error', () => { result.errors++; stopping = true; });
  server.once('close', () => { serverCloseObserved = true; });
  const watchdog = setTimeout(() => {
    if (emitted) return;
    emitted = true; stopping = true;
    for (const request of requests) request.destroy();
    agent.destroy(); for (const socket of serverSockets) socket.destroy();
    writeSync(1, JSON.stringify({ ...result, status: 'failed', category: 'WATCHDOG_EXPIRED' }) + '\n'); process.exit(1);
  }, 25000);
  async function one(port) {
    result.admitted++;
    await new Promise((resolve, reject) => {
      let settled = false, bytes = 0, valid = true;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(Error('REQUEST_FAILED')) : resolve(); };
      const request = http.get({ host: '127.0.0.1', port, path: '/', agent }, response => {
        valid = response.statusCode === 200;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 2) { valid = false; request.destroy(); finish(true); } });
        response.once('error', () => finish(true)); response.once('aborted', () => finish(true));
        response.once('end', () => finish(!valid || bytes !== 2));
      });
      requests.add(request); request.once('close', () => requests.delete(request));
      request.on('socket', socket => { clientSockets.add(socket); socket.once('close', () => clientSockets.delete(socket)); });
      request.once('error', () => finish(true));
      const timer = setTimeout(() => { request.destroy(); finish(true); }, 2000);
    });
    result.completed++;
  }
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); listening = true; resolve(); }); });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('ADDRESS');
    const until = performance.now() + 15000;
    await Promise.all(Array.from({ length: 32 }, async () => {
      while (!stopping && result.admitted < 20000 && performance.now() < until) {
        try { await one(address.port); } catch { result.errors++; stopping = true; }
      }
    }));
    result.category = result.errors ? 'REQUEST_FAILED' : result.completed < 1000 ? 'INSUFFICIENT_COMPLETION' : 'COMPLETE';
  } catch { result.category = 'RUNTIME_FAILED'; result.errors++; }
  finally {
    stopping = true;
    for (const request of requests) request.destroy(); agent.destroy();
    for (const socket of serverSockets) socket.destroy();
    try {
      if (listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      const end = performance.now() + 4000;
      while ((serverSockets.size || clientSockets.size || requests.size) && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
      result.serverClosed = serverCloseObserved && !server.listening;
      result.socketsClosed = serverSockets.size === 0 && clientSockets.size === 0 && requests.size === 0;
      if (!result.serverClosed || !result.socketsClosed) result.category = 'CLEANUP_UNOBSERVED';
    } catch { result.category = 'CLEANUP_UNOBSERVED'; }
    clearTimeout(watchdog);
  }
  if (result.category === 'COMPLETE' && result.errors === 0 && result.completed >= 1000 && result.admitted === result.completed && result.serverClosed && result.socketsClosed) result.status = 'passed';
  emitted = true; return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWindowsHttpRuntimeProbe().then(result => { writeSync(1, JSON.stringify(result) + '\n'); process.exitCode = result.status === 'passed' ? 0 : 1; }, () => { writeSync(1, '{"schemaVersion":1,"kind":"WINDOWS_HTTP_RUNTIME_PROBE","status":"failed","category":"INTERNAL_FAILED"}\n'); process.exitCode = 1; });
}

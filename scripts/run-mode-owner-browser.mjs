import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateOwnerArtifacts } from './mode-owner-artifacts.mjs';

/** Child output is deliberately discarded, including configuration/worker failures. */
export function runBoundedChild(command, args, { cwd, env, timeoutMs = 600000, outputLimit = 131072 } = {}) {
  return new Promise(resolveRun => {
    let child, bytes = 0, category = 'COMPLETE', done = false, reap;
    const timer = setTimeout(() => stop('RUN_TIMEOUT'), timeoutMs);
    const finish = (status) => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(reap);
      resolveRun(Object.freeze({ category, status }));
    };
    function killOwned() {
      if (!child?.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { try { child.kill('SIGKILL'); } catch {} });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
      }
    }
    function stop(reason) {
      if (done || category !== 'COMPLETE') return;
      category = reason; killOwned();
      reap = setTimeout(() => {
        child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
        category = 'CHILD_REAP_UNCONFIRMED'; finish('failed');
      }, 10000);
    }
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      const consume = chunk => { bytes += chunk.length; if (bytes > outputLimit) stop('OUTPUT_LIMIT'); };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.on('error', () => { category = 'STARTUP_FAILED'; finish('failed'); });
      child.on('close', code => {
        if (category === 'COMPLETE' && code !== 0) category = 'BROWSER_TEST_FAILED';
        finish(category === 'COMPLETE' && code === 0 ? 'passed' : 'failed');
      });
    } catch { category = 'STARTUP_FAILED'; finish('failed'); }
  });
}

export async function scopedOwnerBrowserCache(root) {
  root = resolve(root);
  const actualRoot = await realpath(root);
  const cache = resolve(root, '.cache');
  await mkdir(cache, { recursive: true });
  if (await realpath(cache) !== resolve(actualRoot, '.cache')) throw Error('BROWSER_CACHE_UNSAFE');
  const browserCache = resolve(cache, 'mode-owner-playwright');
  await mkdir(browserCache, { recursive: true });
  if (await realpath(browserCache) !== resolve(actualRoot, '.cache', 'mode-owner-playwright') || relative(root, browserCache).startsWith('..' + sep)) throw Error('BROWSER_CACHE_UNSAFE');
  return browserCache;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let receipt = { category: 'CONFIGURATION_FAILED', status: 'failed' };
  try {
    const browserCache = await scopedOwnerBrowserCache(root);
    const artifactRunId = randomUUID();
    receipt = await runBoundedChild(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.mode-owner.config.ts'], {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache, MODE_OWNER_ARTIFACT_RUN_ID: artifactRunId, PLAYWRIGHT_NO_COPY_PROMPT: "1" },
    });
    receipt = { ...receipt, artifactRunId };
    try {
      const artifacts = await validateOwnerArtifacts(root, artifactRunId);
      if (receipt.status === 'passed' && artifacts.status !== 'passed') receipt = { ...receipt, category: 'ARTIFACT_STATUS_FAILED', status: 'failed' };
      receipt = { ...receipt, artifacts: artifacts.files };
    } catch {
      if (receipt.status === 'passed') receipt = { ...receipt, category: 'ARTIFACT_VALIDATION_FAILED', status: 'failed' };
      receipt = { ...receipt, artifacts: [] };
    }
  } catch { receipt = { category: "CONFIGURATION_FAILED", status: "failed" }; /* Never serialize startup exceptions. */ }
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ...receipt }) + '\n');
  if (receipt.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unavailableDatabase = 'postgres://postgres:a26-host-runtime-secret@127.0.0.1:1/lumin_host_runtime_a26';
const secretSentinel = 'a26-host-runtime-secret';
type HostChild = ChildProcessByStdio<null, Readable, Readable>;
const children: HostChild[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'close').catch(() => undefined);
  }
});

async function freeLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveProbe, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolveProbe());
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()));
  return port;
}

async function startHostRuntime(): Promise<{ child: HostChild; base: string; output: () => string }> {
  const port = await freeLoopbackPort();
  const lines: string[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      ComSpec: process.env.ComSpec ?? '',
      TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '',
      BOOKING_LUMIN_ENV: 'staging',
      DATABASE_URL: unavailableDatabase,
      SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
      SUPABASE_ANON_KEY: 'sb_publishable_a26_synthetic_host_runtime_key',
      OWNER_ORIGINS: 'https://portal.example.test',
      CUSTOMER_ORIGINS: 'https://booking.example.test',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => lines.push(String(chunk)));
  child.stderr.on('data', chunk => lines.push(String(chunk)));
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`host runtime did not start: ${lines.join('')}`)), 10000);
    const onData = (chunk: string) => {
      if (chunk.includes('listening on')) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolveReady();
      }
    };
    child.stdout.on('data', onData);
    child.once('error', error => {
      clearTimeout(timer);
      rejectReady(error);
    });
    child.once('exit', (code, signal) => {
      if (code !== null || signal !== null) {
        clearTimeout(timer);
        rejectReady(new Error(`host runtime exited before listening (${code ?? 'null'}/${signal ?? 'null'}): ${lines.join('')}`));
      }
    });
  });
  return { child, base: `http://127.0.0.1:${port}`, output: () => lines.join('') };
}

describe('production host runtime', () => {
  it('serves health, fails readiness closed, and shuts down without exposing secrets', async () => {
    const runtime = await startHostRuntime();
    const health = await fetch(`${runtime.base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');

    const readiness = await fetch(`${runtime.base}/ready`);
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toEqual({ status: 'unready' });
    expect(readiness.headers.get('cache-control')).toBe('no-store');
    expect(readiness.headers.get('x-content-type-options')).toBe('nosniff');

    runtime.child.kill('SIGINT');
    const [code, signal] = await once(runtime.child, 'close') as [number | null, NodeJS.Signals | null];
    if (process.platform === 'win32') {
      // Windows terminates child processes for SIGINT before Node can run its handler.
      expect(code).toBeNull();
      expect(signal).toBe('SIGINT');
    } else {
      expect(code).toBe(0);
      expect(signal).toBeNull();
    }
    expect(runtime.output()).toContain('(STAGING; real Supabase-JWT auth)');
    expect(runtime.output()).not.toContain(secretSentinel);
  }, 20000);
});

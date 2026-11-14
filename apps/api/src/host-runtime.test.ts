import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const unavailableDatabase = 'postgres://postgres:a26-host-runtime-secret@127.0.0.1:1/lumin_host_runtime_a26';
const secretSentinel = 'a26-host-runtime-secret';
type HostChild = ChildProcessByStdio<null, Readable, Readable>;
const children: HostChild[] = [];
/** Variables merged over the fixed environment. A value of undefined removes the variable. */
type HostEnvOverrides = Readonly<Record<string, string | undefined>>;

/** A host that exited before it listened. `output` is its complete stdout and stderr. */
class HostRuntimeExit extends Error {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;

  constructor(code: number | null, signal: NodeJS.Signals | null, output: string) {
    super(`host runtime exited before listening (${code ?? 'null'}/${signal ?? 'null'}): ${output}`);
    this.name = 'HostRuntimeExit';
    this.code = code;
    this.signal = signal;
    this.output = output;
  }
}

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

async function startHostRuntime(overrides: HostEnvOverrides = {}): Promise<{ child: HostChild; base: string; output: () => string }> {
  const port = await freeLoopbackPort();
  const lines: string[] = [];
  const env: Record<string, string> = {
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
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_ROOT,
    env,
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
    // 'close', not 'exit': 'exit' can arrive before the last stdout and stderr chunks, and a refusal
    // names its variable on stderr. 'close' arrives after both streams have ended.
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      rejectReady(new HostRuntimeExit(code, signal, lines.join('')));
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

  it('boots with the payment connection write flag unset, even when the provider names stripe_connect with no key', async () => {
    // The flag gates the boot: with it unset, a provider that would be refused (no platform key) does not stop
    // the process. That the selector is not CALLED is pinned by the call-site test below, because a selector
    // call whose result is discarded would boot just the same.
    const runtime = await startHostRuntime({
      BOOKING_LUMIN_PAYMENT_CONNECTION_PROVIDER: 'stripe_connect',
      BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE: undefined,
      STRIPE_PLATFORM_SECRET_KEY: undefined,
      STRIPE_PLATFORM_ACCOUNT_ID: undefined,
    });
    expect(runtime.output()).toContain('listening on');
    const health = await fetch(`${runtime.base}/health`);
    expect(health.status).toBe(200);
    expect(runtime.output().includes(secretSentinel)).toBe(false);
  }, 20000);

  it('refuses to boot when the write flag is on and no platform key is set, naming the variable and echoing no secret', async () => {
    // A refusal is a process exit, so startHostRuntime rejects with the exit and the complete output.
    const refusal = await startHostRuntime({
      BOOKING_LUMIN_PAYMENT_CONNECTION_PROVIDER: 'stripe_connect',
      BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE: '1',
      STRIPE_PLATFORM_SECRET_KEY: undefined,
      STRIPE_PLATFORM_ACCOUNT_ID: undefined,
    }).then(() => null, (error: unknown) => error);
    expect(refusal, 'the host must refuse to start').toBeInstanceOf(HostRuntimeExit);
    const exit = refusal as HostRuntimeExit;
    expect(exit.code, 'exit code').not.toBe(0);
    expect(exit.signal, 'exit signal').toBeNull();
    // Booleans, not matchers: a failing matcher would print the output it is checking.
    expect(exit.output.includes('STRIPE_PLATFORM_SECRET_KEY'), 'refusal names the platform key variable').toBe(true);
    expect(exit.output.includes(secretSentinel), 'refusal echoes the database password').toBe(false);
  }, 20000);

  it('refuses a live-mode platform key, naming the variable and echoing neither the key nor a piece of it', async () => {
    // The key is present in the child's environment, so a refusal that echoed it would print it, and the checks
    // below can fail. The fixture is synthetic and built at runtime, so no key-shaped literal sits in this file.
    const liveFixture = ['sk', 'live', 'a26hostruntimeprobe00000'].join('_');
    const refusal = await startHostRuntime({
      BOOKING_LUMIN_PAYMENT_CONNECTION_PROVIDER: 'stripe_connect',
      BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE: '1',
      STRIPE_PLATFORM_SECRET_KEY: liveFixture,
      STRIPE_PLATFORM_ACCOUNT_ID: 'acct_a26hostruntime01',
    }).then(() => null, (error: unknown) => error);
    expect(refusal, 'the host must refuse to start').toBeInstanceOf(HostRuntimeExit);
    const exit = refusal as HostRuntimeExit;
    expect(exit.code, 'exit code').not.toBe(0);
    // Booleans, not matchers: a failing matcher would print the output it is checking.
    expect(exit.output.includes('STRIPE_PLATFORM_SECRET_KEY'), 'refusal names the platform key variable').toBe(true);
    expect(exit.output.includes('live-mode'), 'refusal says the key is live').toBe(true);
    expect(exit.output.includes(liveFixture), 'refusal echoes the live key').toBe(false);
    expect(exit.output.includes(liveFixture.slice(8, 12)), 'refusal echoes a piece of the live key').toBe(false);
  }, 20000);

  it('calls the provider selector only where the write flag is on', () => {
    // The boot test above shows that a flag-off process boots. It cannot show that the selector is not called: a
    // call whose result is discarded boots the same way. So the one call site is read, and it must sit behind the flag.
    const sites = readFileSync(resolve(API_ROOT, 'src/main.ts'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('selectPaymentConnectionProvider('));
    expect(sites.length, 'one call site').toBe(1);
    expect(sites[0]!.includes('paymentConnectionWriteEnabled(process.env)?'), 'the call sits behind the write flag').toBe(true);
  });

  it('names the environment in the provenance log by a fixed word, never by the raw variable', () => {
    // A value pasted into BOOKING_LUMIN_ENV by mistake must not reach a deployment log. The startup line maps it to
    // a fixed word; the provenance line must do the same, and this reads the source to hold it to that.
    const source = readFileSync(resolve(API_ROOT, 'src/main.ts'), 'utf8');
    const line = source.split('\n').find((text) => text.includes("'payment_provenance_mismatch'")) ?? '';
    expect(line.length, 'the provenance log line exists').toBeGreaterThan(0);
    expect(line.includes('BOOKING_LUMIN_ENV ?? null'), 'the raw value is not logged').toBe(false);
    expect(line.includes("'OTHER'"), 'an unrecognised value is logged as a fixed word').toBe(true);
  });
});

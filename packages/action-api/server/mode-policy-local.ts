/** Guarded disposable A-only HTTPS composition. No hosted credentials or registration. */
import { Pool, type PoolConfig } from 'pg';
import { createServer, type Server } from 'node:https';
import type { Duplex } from 'node:stream';
import { createSecureContext } from 'node:tls';
import { modeRecord, type ReadOutcome } from './mode-installation-contracts';
import { __createModeInstallationRepositoryForTests, type ModePool, type ModeClient, type ModeClock, type ModeOptions } from './mode-installation-repository';
import { createModePolicyHttpHandler, modePolicyProfiles, type ModePolicyReader } from './mode-policy-http';
import type { InstallationPolicy, InstallationProfile } from '@lumin/contracts';

export interface ModePolicyComposition { readonly reader: ModePolicyReader; readonly profile: InstallationProfile | null; close(): Promise<void> }
export interface ModePolicyTestDependencies { env: NodeJS.ProcessEnv; poolFactory(config: PoolConfig): ModePool; clock?: ModeClock }
const SELECT = 'SELECT public.mode_public_installation_policy($1::uuid) AS result';
const ALLOWED = new Set(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role', SELECT, 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nativeSet = setTimeout, nativeClear = clearTimeout;
function bounded(work: () => Promise<unknown>): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const complete = () => { if (!done) { done = true; nativeClear(timer); resolve(); } };
    const timer = nativeSet(complete, 10000);
    try { Promise.resolve(work()).then(complete, complete); } catch { complete(); }
  });
}
/** Trusted server-only negative-query test seam; never exposed by the composition facade. */
export function __restrictModePolicyPoolForTests(pool: ModePool): ModePool {
  const wrapper: ModePool = {
    async connect() {
      const client = await pool.connect();
      const result: ModeClient = {
        async query(text, values) {
          if (!ALLOWED.has(text) || (text === SELECT ? !Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' || !UUID.test(values[0]) : values !== undefined && (!Array.isArray(values) || values.length !== 0))) throw Error('MODE_POLICY_QUERY_DENIED');
          return client.query(text, values);
        },
        release: error => client.release(error),
        on(event, listener) { client.on(event, listener); return result; },
        removeListener(event, listener) { client.removeListener(event, listener); return result; },
      };
      return result;
    },
    end: () => pool.end(),
    on(event, listener) { pool.on(event, listener); return wrapper; },
    removeListener(event, listener) { pool.removeListener(event, listener); return wrapper; },
  };
  return wrapper;
}
/** Trusted controlled seam still validates the same disposable environment; never request configuration. */
export function __createLocalModePolicyCompositionForTests(config: unknown, dependencies: ModePolicyTestDependencies): ModePolicyComposition {
  const input = modeRecord(config, ['profiles']);
  const profiles = modePolicyProfiles(input.profiles);
  const env = dependencies.env, host = env.PGHOST, port = env.PGPORT, database = env.PGDATABASE, password = env.PGPASSWORD ?? '';
  if (env.LOCAL_HARNESS !== '1' || env.FLOW_TEST_DISPOSABLE !== '1' || env.MODE_INSTALLATIONS_TEST_DISPOSABLE !== '1' || env.MODE_DOCUMENT_TEST_DISPOSABLE !== '1' ||
    !['127.0.0.1', 'localhost'].includes(host ?? '') || !port || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535 || env.PGUSER !== 'postgres' ||
    !database || database.length > 63 || !/^lumin_mode_document_[a-z0-9_]+$/.test(database) || !['', 'postgres'].includes(password) ||
    ['DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'].some(key => Boolean(env[key]))) throw Error('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');
  let closed = false, closing: Promise<void> | undefined;
  if (!profiles.length) {
    const reader: ModePolicyReader = Object.freeze({ publicPolicy: async (): Promise<ReadOutcome<InstallationPolicy>> => ({ kind: 'failed', code: 'CLOSED', transaction: 'not_started', backendMayStillRun: false }), close: async () => {} });
    return Object.freeze({ reader, profile: null, close: reader.close });
  }
  let pool: ModePool | undefined;
  try {
    pool = dependencies.poolFactory({ host, port: Number(port), user: 'postgres', database, password: () => password, ssl: false, pipeline: false, max: 2,
      connectionTimeoutMillis: 3000, idleTimeoutMillis: 5000, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, query_timeout: 0, application_name: 'mode-policy-local' });
    const suppliedClock = dependencies.clock;
    const capturedClock = suppliedClock ? { monotonic: suppliedClock.monotonic.bind(suppliedClock), setTimer: suppliedClock.setTimer.bind(suppliedClock), clearTimer: suppliedClock.clearTimer.bind(suppliedClock) } : undefined;
    const repository = __createModeInstallationRepositoryForTests({ pool: __restrictModePolicyPoolForTests(pool), profiles, clock: capturedClock });
    const close = () => { if (closing) return closing; closed = true; closing = bounded(() => repository.close()); return closing; };
    const reader: ModePolicyReader = Object.freeze({ publicPolicy(request: unknown, options?: ModeOptions) {
      if (closed) return Promise.resolve({ kind: 'failed', code: 'CLOSED', transaction: 'not_started', backendMayStillRun: false } as const);
      return repository.publicPolicy(request, options);
    }, close });
    return Object.freeze({ reader, profile: profiles[0]!, close });
  } catch {
    if (pool) void bounded(() => pool!.end());
    throw Error('MODE_POLICY_STARTUP_FAILED');
  }
}
export function createLocalModePolicyComposition(config: unknown): ModePolicyComposition {
  return __createLocalModePolicyCompositionForTests(config, { env: process.env, poolFactory: value => new Pool(value) });
}
export async function startLocalModePolicyServer(config: unknown): Promise<Readonly<{ origin: string; close(): Promise<void> }>> {
  const input = modeRecord(config, ['profiles', 'tls']);
  const profiles = modePolicyProfiles(input.profiles);
  if (profiles.length !== 1) throw Error('MODE_POLICY_PROFILE_REQUIRED');
  const origin = profiles[0]!.apiOrigin, url = new URL(origin), port = Number(url.port);
  if (!url.port || port < 1024 || port > 65535) throw Error('MODE_POLICY_FIXTURE_PORT_REQUIRED');
  const tls = modeRecord(input.tls, ['key', 'cert']);
  if (typeof tls.key !== 'string' || typeof tls.cert !== 'string' || Buffer.byteLength(tls.key) > 16384 || Buffer.byteLength(tls.cert) > 16384 || !tls.key || !tls.cert) throw Error('MODE_POLICY_TLS_REQUIRED');
  const composition = createLocalModePolicyComposition({ profiles });
  let handler: ReturnType<typeof createModePolicyHttpHandler> | undefined;
  const sockets = new Set<Duplex>();
  let server: Server | undefined, closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closing = bounded(async () => {
      const handlerEnd = handler?.close(), compositionEnd = composition.close();
      for (const socket of sockets) socket.destroy();
      const listenerEnd = new Promise<void>(resolve => { if (!server) resolve(); else try { server.close(() => resolve()); } catch { resolve(); } });
      await Promise.all([handlerEnd, compositionEnd, listenerEnd]);
    });
    return closing;
  };
  try {
    handler = createModePolicyHttpHandler({ reader: composition.reader, profiles });
    const context = createSecureContext({ key: tls.key, cert: tls.cert });
    server = createServer({ key: tls.key, cert: tls.cert, maxHeaderSize: 8192, connectionsCheckingInterval: 100, SNICallback(name, callback) {
      if (name !== url.hostname) callback(Error('MODE_POLICY_TLS_NAME')); else callback(null, context);
    } }, handler.handle);
    server.on('secureConnection', socket => { if (socket.servername !== url.hostname) socket.destroy(); });
    server.headersTimeout = 2000; server.requestTimeout = 2000; server.keepAliveTimeout = 1000; server.setTimeout(2000, socket => socket.destroy());
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('clientError', (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      const failed = () => { server!.removeListener('listening', ready); reject(Error('MODE_POLICY_LISTEN_FAILED')); };
      const ready = () => { server!.removeListener('error', failed); resolve(); };
      server!.once('error', failed); server!.once('listening', ready); server!.listen(port, '127.0.0.1');
    });
    server.on('error', () => { void close(); });
    return Object.freeze({ origin, close });
  } catch { await close(); throw Error('MODE_POLICY_STARTUP_FAILED'); }
}

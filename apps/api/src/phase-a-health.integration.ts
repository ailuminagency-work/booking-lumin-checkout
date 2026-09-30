import assert from 'node:assert/strict';
import { createFlowHttpServer } from './http';
import { createFlowRepository } from './repository';
import { localPool, LOCAL_FIXTURE as F } from './fixtures';

function requireExplicitLoopback(): void {
  const e = process.env;
  if (e.LOCAL_HARNESS !== '1' || e.FLOW_TEST_DISPOSABLE !== '1') {
    throw new Error('explicit disposable local harness mode is required');
  }
  if (e.PGHOST !== '127.0.0.1' || !/^\d{1,5}$/.test(e.PGPORT ?? '') || Number(e.PGPORT) < 1 || Number(e.PGPORT) > 65535) {
    throw new Error('explicit IPv4 loopback PostgreSQL host and port are required');
  }
  if (e.PGUSER !== 'postgres' || !/^lumin_[a-z0-9_]+$/.test(e.PGDATABASE ?? '') || (e.PGDATABASE ?? '').length > 63) {
    throw new Error('explicit disposable postgres role and database are required');
  }
  if (e.PGPASSWORD !== undefined && !['', 'postgres'].includes(e.PGPASSWORD)) {
    throw new Error('PGPASSWORD must be empty or the disposable postgres password');
  }
  const ambient = ['DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'];
  if (ambient.some((name) => e[name] !== undefined)) {
    throw new Error('ambient PostgreSQL routing or credential overrides are forbidden');
  }
}

requireExplicitLoopback();
const pool = localPool();
const server = createFlowHttpServer({
  repository: createFlowRepository(pool),
  ownerOrigins: [F.ownerOrigin],
  customerOrigins: [F.customerOrigin],
});
let base = '';

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(base + path, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    ...init,
  });
}

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(address.address, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;

  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await health.json(), {
    ok: true,
    data: { mode: 'LOCAL_HARNESS', providerConnections: false },
  });

  const nonGetHealth = await request('/health', {
    method: 'POST',
    headers: {
      origin: F.ownerOrigin,
      authorization: `Bearer ${F.ownerToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(nonGetHealth.status, 400);

  const readiness = await request('/ready', { headers: { origin: F.ownerOrigin } });
  assert.equal(readiness.status, 401);
  const unauthorisedReadiness = await request('/ready');
  assert.equal(unauthorisedReadiness.status, 403);

  console.log('PASS local factory health contract: exact health schema, non-GET rejection, /ready denied, loopback binding, and disposable cleanup');
} finally {
  server.closeAllConnections();
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await pool.end();
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

type ReservationResult = {
  result: 'GRANTED' | 'NO_CAPACITY';
  reservation_id: string | null;
  reservation_status: 'held' | 'consumed' | null;
  expires_at: string | null;
};

function requireDisposableLoopback(): void {
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

requireDisposableLoopback();
const pool = new Pool({
  host: '127.0.0.1',
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: 'postgres',
  password: process.env.PGPASSWORD ?? '',
  max: 4,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
  statement_timeout: 10_000,
});

const tenant = randomUUID();
const foreignTenant = randomUUID();
const resource = randomUUID();
const bookingA = randomUUID();
const bookingB = randomUUID();
const foreignBooking = randomUUID();
const run = randomUUID();
const slotStart = new Date(Date.now() + 86_400_000);
slotStart.setUTCMinutes(0, 0, 0);
const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1_000);

async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await work(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function reserve(tenantId: string, resourceId: string, bookingId: string): Promise<ReservationResult> {
  return transaction(async (client) => {
    await client.query('set local role service_role');
    const result = await client.query<ReservationResult>(
      `select result,reservation_id,reservation_status,expires_at
         from public.reserve_resource($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5::uuid,interval '5 minutes')`,
      [tenantId, resourceId, slotStart.toISOString(), slotEnd.toISOString(), bookingId],
    );
    assert.equal(result.rows.length, 1);
    return result.rows[0]!;
  });
}

async function release(bookingId: string): Promise<number> {
  return transaction(async (client) => {
    await client.query('set local role service_role');
    const result = await client.query<{ released: number }>(
      'select public.release_resource_holds($1::uuid) as released',
      [bookingId],
    );
    return Number(result.rows[0]?.released ?? 0);
  });
}

try {
  await transaction(async (client) => {
    await client.query('set local role service_role');
    await client.query(
      `insert into public.tenants(id,name,slug,timezone,currency)
       values($1,'Rental concurrency tenant',$3,'UTC','USD'),
             ($2,'Foreign rental tenant',$4,'UTC','USD')`,
      [tenant, foreignTenant, `rental-${run}`, `foreign-rental-${run}`],
    );
    await client.query(
      `insert into public.resources(id,tenant_id,name,kind,capacity,active)
       values($1,$2,'Synthetic rental vehicle','vehicle',1,true)`,
      [resource, tenant],
    );
    await client.query(
      `insert into public.bookings
        (id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,idempotency_key)
       values
        ($1,$3,'RNT-A','draft',jsonb_build_object('vertical','vehicle_rental'), '{}'::jsonb,$5,$6,$7),
        ($2,$3,'RNT-B','draft',jsonb_build_object('vertical','vehicle_rental'), '{}'::jsonb,$5,$6,$8),
        ($4,$9,'RNT-F','draft',jsonb_build_object('vertical','vehicle_rental'), '{}'::jsonb,$5,$6,$10)`,
      [bookingA, bookingB, tenant, foreignBooking, slotStart.toISOString(), slotEnd.toISOString(), `rental-${run}-a`, `rental-${run}-b`, foreignTenant, `rental-${run}-foreign`],
    );
  });

  const attempts = await Promise.all([
    reserve(tenant, resource, bookingA),
    reserve(tenant, resource, bookingB),
  ]);
  const statuses = attempts.map((attempt) => attempt.result).sort();
  assert.deepEqual(statuses, ['GRANTED', 'NO_CAPACITY']);
  const winner = attempts.find((attempt) => attempt.result === 'GRANTED')!;
  const loser = attempts.find((attempt) => attempt.result === 'NO_CAPACITY')!;
  assert.equal(winner.reservation_status, 'held');
  assert.ok(winner.reservation_id);
  assert.deepEqual(loser, {
    result: 'NO_CAPACITY',
    reservation_id: null,
    reservation_status: null,
    expires_at: null,
  });

  const held = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.resource_reservations
      where tenant_id=$1 and resource_id=$2 and status='held'`,
    [tenant, resource],
  );
  assert.equal(held.rows[0]?.n, 1);

  // A foreign tenant cannot use this tenant's resource, even with a valid booking id.
  const foreign = await reserve(foreignTenant, resource, foreignBooking);
  assert.deepEqual(foreign, {
    result: 'NO_CAPACITY',
    reservation_id: null,
    reservation_status: null,
    expires_at: null,
  });

  const winnerBooking = attempts[0]?.result === 'GRANTED' ? bookingA : bookingB;
  const replay = await reserve(tenant, resource, winnerBooking);
  assert.equal(replay.result, 'GRANTED');
  assert.equal(replay.reservation_status, 'held');
  assert.equal(replay.reservation_id, winner.reservation_id);
  assert.equal(replay.expires_at, winner.expires_at);

  const persisted = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.resource_reservations
      where tenant_id=$1 and resource_id=$2 and status in ('held','consumed')`,
    [tenant, resource],
  );
  assert.equal(persisted.rows[0]?.n, 1);
  const payments = await pool.query<{ n: number }>(
    'select count(*)::int as n from public.payments where booking_id in ($1,$2,$3)',
    [bookingA, bookingB, foreignBooking],
  );
  assert.equal(payments.rows[0]?.n, 0);
  const confirmed = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.bookings
      where id in ($1,$2,$3) and state='confirmed'`,
    [bookingA, bookingB, foreignBooking],
  );
  assert.equal(confirmed.rows[0]?.n, 0);

  assert.equal(await release(winnerBooking), 1);
  const activeAfterRelease = await pool.query<{ n: number }>(
    `select count(*)::int as n from public.resource_reservations
      where tenant_id=$1 and resource_id=$2 and status in ('held','consumed')`,
    [tenant, resource],
  );
  assert.equal(activeAfterRelease.rows[0]?.n, 0);
  console.log('PASS disposable rental resource concurrency: one GRANTED/one NO_CAPACITY, foreign-resource denial, idempotent replay, single held reservation, and no payment/confirmation side effects');
} finally {
  await transaction(async (client) => {
    await client.query('set local role service_role');
    await client.query('delete from public.tenants where id in ($1,$2)', [tenant, foreignTenant]);
  }).catch(() => undefined);
  await pool.end();
}

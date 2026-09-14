/**
 * R2b confirm-authority pg-backed acceptance (NOT part of `npm test`).
 *
 * Standalone tsx script (top-level await + node:assert), run by
 * scripts/run-integration.sh against a throwaway loopback Postgres with the
 * migrations applied. Proves the SINGLE booking-confirm authority end-to-end:
 *
 *   1. Through-API overbooking/concurrency (RELEASE BLOCKER): two concurrent
 *      confirms racing ONE capacity-1 service slot → exactly ONE 'confirmed',
 *      the other 409; the DB never holds two confirmed bookings on the slot.
 *      Same for a capacity-1 EXCLUSIVE resource.
 *   2. Payment authority (R2): a declined payment never confirms.
 *   3. Server amount (R3): the captured amount equals the server reprice.
 *   4. Idempotency (R4): a retried confirm yields one booking + one payment.
 *   5. Refund-on-oversell (F1): payment-succeeds-but-hold-lost → booking failed
 *      + one refund, never confirmed.
 *   6. Auth/tenant isolation: unauthenticated → 401; a tenant-B token cannot
 *      confirm a tenant-A booking.
 *
 * Each scenario books a DISTINCT weekly slot (the weekly availability rule
 * covers every occurrence) so reservations never collide across scenarios.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { localPool, seedLocalFixtures, LOCAL_FIXTURE as F, localIdentity } from "./fixtures";
import { createFlowRepository } from "./repository";
import { createFlowHttpServer } from "./http";
import { createConfirmHandler, type ConfirmBooking } from "./confirm";
import { createMockPaymentGateway, PaymentDeclined, type PaymentGateway } from "./payment-gateway";

const pool = localPool();

const SVC_CAP = "a3100000-0000-4000-8000-0000000000c1"; // capacity-1 service slot
const SVC_RES = "a3100000-0000-4000-8000-0000000000c2"; // resource-backed service (slot capacity 2)
const RESOURCE = "a3100000-0000-4000-8000-0000000000c3"; // exclusive resource (capacity 1)
const PRICE = 5000; // base_price, tax 0 → server charge 5000 USD

// A base date 3 days out at 10:00Z; each scenario uses a distinct week offset.
const anchor = new Date(Date.now() + 3 * 86_400_000);
anchor.setUTCHours(10, 0, 0, 0);
const WEEKDAY = anchor.getUTCDay();
function slotAt(weekOffset: number): { start: string; end: string } {
  const s = new Date(anchor.getTime() + weekOffset * 7 * 86_400_000);
  return { start: s.toISOString(), end: new Date(s.getTime() + 60 * 60_000).toISOString() };
}

async function seedConfirmFixtures(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const [svc, cap] of [
      [SVC_CAP, 1],
      [SVC_RES, 2],
    ] as const) {
      await c.query(
        "insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes,tax_rate_bp) values($1,$2,'simple',$3,'USD',$4,60,0) on conflict(id) do nothing",
        [svc, F.tenantA, `Confirm service ${svc.slice(-2)}`, PRICE],
      );
      await c.query(
        "insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) values($1,$2,$3,600,660,$4)",
        [F.tenantA, svc, WEEKDAY, cap],
      );
      await c.query(
        "insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,400,60)",
        [F.tenantA, svc],
      );
    }
    await c.query(
      "insert into public.resources(id,tenant_id,name,kind,capacity,active) values($1,$2,'The one van','vehicle',1,true) on conflict(id) do nothing",
      [RESOURCE, F.tenantA],
    );
    await c.query(
      "insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values($1,$2,$3,1) on conflict do nothing",
      [F.tenantA, SVC_RES, RESOURCE],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

async function createDraft(serviceId: string, key: string, week: number, name = "Confirm customer"): Promise<string> {
  const slot = slotAt(week);
  const r = await pool.query(
    "select booking_id from public.create_booking_draft($1,$2,$3::jsonb,$4::timestamptz,$5::timestamptz,$6::jsonb)",
    [F.tenantA, key, JSON.stringify({ serviceId }), slot.start, slot.end, JSON.stringify({ name, email: `${key.slice(0, 10)}@test.invalid` })],
  );
  return r.rows[0].booking_id;
}
const stateOf = async (id: string): Promise<string> =>
  (await pool.query("select state from public.bookings where id=$1", [id])).rows[0]?.state;
const payments = async (id: string): Promise<number> =>
  (await pool.query("select count(*)::int n from public.payments where booking_id=$1", [id])).rows[0].n;
const refunds = async (id: string): Promise<number> =>
  (await pool.query("select count(*)::int n from public.refunds where booking_id=$1", [id])).rows[0].n;

function serverFor(confirmBooking: ConfirmBooking): Promise<{ server: Server; url: string }> {
  const server = createFlowHttpServer({
    repository: createFlowRepository(pool),
    authenticateOwner: localIdentity,
    confirmBooking,
    ownerOrigins: [F.ownerOrigin],
    customerOrigins: [F.customerOrigin],
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }),
    ),
  );
}
const stop = (server: Server): Promise<void> => {
  server.closeAllConnections();
  return new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
};

async function confirmHTTP(
  url: string,
  bookingId: string,
  tenant: string,
  idempotencyKey: string,
  // `null` = send NO Authorization header (the unauthenticated case). Omitting
  // the arg defaults to the owner-A token. NB: an explicit `undefined` would
  // trigger the JS default (owner-A token), so the no-auth case passes `null`.
  token: string | null = F.ownerToken,
): Promise<{ status: number; data?: { state: string; amount: number; compensated?: boolean }; code?: string }> {
  const r = await fetch(`${url}/api/bookings/${bookingId}/confirm?tenantId=${tenant}`, {
    method: "POST",
    headers: {
      Origin: F.ownerOrigin,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ idempotencyKey }),
  });
  return { status: r.status, ...((await r.json()) as object) } as never;
}

const okGateway: PaymentGateway = createMockPaymentGateway();
const declineGateway: PaymentGateway = {
  providerName: "decline",
  async charge() {
    throw new PaymentDeclined("card declined");
  },
  async refund() {
    return { refundId: "n/a" };
  },
};

let proof = "";

try {
  await seedLocalFixtures(pool);
  await seedConfirmFixtures();
  const { server: okServer, url } = await serverFor(createConfirmHandler(pool, okGateway));

  // ---- Happy path (week 0): one booking confirms through the API -------------
  {
    const key = `happy-${randomUUID()}`;
    const id = await createDraft(SVC_CAP, key, 0);
    const res = await confirmHTTP(url, id, F.tenantA, key);
    assert.equal(res.status, 200);
    assert.equal(res.data!.state, "confirmed");
    assert.equal(res.data!.amount, PRICE);
    assert.equal(await stateOf(id), "confirmed");
    assert.equal(await payments(id), 1);
  }

  // ---- 1a. Concurrency on a capacity-1 SERVICE slot (week 1) ------------------
  {
    const kx = `capx-${randomUUID()}`;
    const ky = `capy-${randomUUID()}`;
    const bx = await createDraft(SVC_CAP, kx, 1, "X");
    const by = await createDraft(SVC_CAP, ky, 1, "Y");
    const [rx, ry] = await Promise.all([confirmHTTP(url, bx, F.tenantA, kx), confirmHTTP(url, by, F.tenantA, ky)]);
    const granted = [rx, ry].filter((r) => r.status === 200 && r.data!.state === "confirmed").length;
    const blocked = [rx, ry].filter((r) => r.status === 409).length;
    assert.equal(granted, 1, "exactly one confirm may win the capacity-1 slot");
    assert.equal(blocked, 1, "the loser must be 409 (NO_CAPACITY)");
    const dbConfirmed = (
      await pool.query(
        "select count(*)::int n from public.bookings where slot_start=$1 and (selection->>'serviceId')::uuid=$2 and state='confirmed'",
        [slotAt(1).start, SVC_CAP],
      )
    ).rows[0].n;
    assert.equal(dbConfirmed, 1, "the DB must never hold two confirmed bookings on the slot");
    proof = `capacity-slot GRANTED=${granted} BLOCKED=${blocked}`;
  }

  // ---- 1b. Concurrency on a capacity-1 EXCLUSIVE resource (week 2) ------------
  {
    const kx = `resx-${randomUUID()}`;
    const ky = `resy-${randomUUID()}`;
    const bx = await createDraft(SVC_RES, kx, 2, "X");
    const by = await createDraft(SVC_RES, ky, 2, "Y");
    const [rx, ry] = await Promise.all([confirmHTTP(url, bx, F.tenantA, kx), confirmHTTP(url, by, F.tenantA, ky)]);
    const granted = [rx, ry].filter((r) => r.status === 200 && r.data!.state === "confirmed").length;
    const blocked = [rx, ry].filter((r) => r.status === 409).length;
    assert.equal(granted, 1, "exactly one confirm may win the capacity-1 resource");
    assert.equal(blocked, 1, "the loser must be 409 (NO_CAPACITY)");
    const consumed = (
      await pool.query(
        "select count(*)::int n from public.resource_reservations r join public.bookings b on b.id=r.booking_id where r.resource_id=$1 and r.slot_start=$2 and r.status='consumed'",
        [RESOURCE, slotAt(2).start],
      )
    ).rows[0].n;
    assert.equal(consumed, 1, "exactly one consumed reservation on the exclusive resource");
    proof += ` | resource GRANTED=${granted} BLOCKED=${blocked}`;
  }

  // ---- 2. Payment authority (R2): a decline never confirms (week 3) ----------
  {
    const { server, url: dUrl } = await serverFor(createConfirmHandler(pool, declineGateway));
    try {
      const key = `decline-${randomUUID()}`;
      const id = await createDraft(SVC_RES, key, 3);
      const res = await confirmHTTP(dUrl, id, F.tenantA, key);
      assert.equal(res.status, 200);
      assert.equal(res.data!.state, "failed");
      assert.equal(await stateOf(id), "failed", "a declined payment must never confirm");
      assert.equal(await payments(id), 0);
    } finally {
      await stop(server);
    }
  }

  // ---- 3. Server amount (R3): captured == server reprice (week 4) -------------
  {
    const key = `amount-${randomUUID()}`;
    const id = await createDraft(SVC_RES, key, 4);
    const res = await confirmHTTP(url, id, F.tenantA, key);
    assert.equal(res.status, 200);
    assert.equal(res.data!.state, "confirmed");
    const amt = (await pool.query("select amount, currency from public.payments where booking_id=$1", [id])).rows[0];
    assert.equal(Number(amt.amount), PRICE, "the captured amount must equal the server reprice");
    assert.equal(amt.currency, "USD");
  }

  // ---- 4. Idempotency (R4): retry → one booking + one payment (week 5) --------
  {
    const key = `idem-${randomUUID()}`;
    const id = await createDraft(SVC_CAP, key, 5);
    const first = await confirmHTTP(url, id, F.tenantA, key);
    const second = await confirmHTTP(url, id, F.tenantA, key);
    assert.equal(first.data!.state, "confirmed");
    assert.equal(second.data!.state, "confirmed", "a retry returns the same confirmed result");
    assert.equal(await payments(id), 1, "a retry must not create a second payment");
    assert.equal((await pool.query("select count(*)::int n from public.bookings where idempotency_key=$1", [key])).rows[0].n, 1);
  }

  // ---- 5. Refund-on-oversell (F1): hold lost after capture (week 6) -----------
  {
    const key = `oversell-${randomUUID()}`;
    const id = await createDraft(SVC_CAP, key, 6);
    const oversell = createConfirmHandler(pool, okGateway, {
      afterCharge: async (req) => {
        await pool.query("select public.release_hold($1)", [req.bookingId]);
      },
    });
    const result = await oversell({ actor: F.ownerA, tenant: F.tenantA, bookingId: id, idempotencyKey: key });
    assert.equal(result.state, "failed", "a lost hold must never confirm");
    assert.equal(result.compensated, true);
    assert.equal(await stateOf(id), "failed");
    assert.equal(await refunds(id), 1, "exactly one compensation refund");
    await oversell({ actor: F.ownerA, tenant: F.tenantA, bookingId: id, idempotencyKey: key }).catch(() => {});
    assert.equal(await refunds(id), 1, "the refund must be idempotent");
  }

  // ---- 6. Auth / tenant isolation (week 7) -----------------------------------
  {
    const key = `iso-${randomUUID()}`;
    const id = await createDraft(SVC_CAP, key, 7);
    assert.equal((await confirmHTTP(url, id, F.tenantA, key, null)).status, 401, "unauthenticated → 401");
    assert.equal((await confirmHTTP(url, id, F.tenantA, key, F.otherOwnerToken)).status, 403, "non-member of tenant A → 403");
    assert.equal((await confirmHTTP(url, id, F.tenantB, key, F.otherOwnerToken)).status, 404, "tenant-A booking not in tenant B → 404");
    assert.equal(await stateOf(id), "draft", "a rejected confirm must never advance the booking");
    assert.equal((await confirmHTTP(url, id, F.tenantA, key)).data!.state, "confirmed", "a legitimate confirm still succeeds");
  }

  await stop(okServer);
  console.log(`PASS: R2b confirm authority — single writer; ${proof}`);
} finally {
  await pool.end();
}

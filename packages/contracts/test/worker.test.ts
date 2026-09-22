import { describe, expect, it } from "vitest";
import {
  TenantRole, WORKER_JOB_TRANSITIONS, WorkerJobState,
  authorizeWorkerJob, decideWorkerJobTransition, projectWorkerJob,
  type WorkerAuthorizationInput,
} from "../src/index";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const assignmentId = "55555555-5555-4555-8555-555555555555";
const foreignId = "99999999-9999-4999-8999-999999999999";
const key = "synthetic-worker-action-1";
const denied = { allowed: false, code: "FORBIDDEN" };
function fixture(): WorkerAuthorizationInput {
  return {
    actor: { tenantId, userId, workerId, sessionActive: true },
    access: { tenantId, userId, workerId, active: true, workerActive: true, revokedAt: null, permissionVersion: 3 },
    assignment: {
      id: assignmentId, tenantId, jobId, userId, workerId, active: true, revokedAt: null, version: 7,
      accessStartsAt: "2030-01-01T09:00:00Z", accessEndsAt: "2030-01-01T12:00:00Z",
    },
    job: {
      id: jobId, tenantId, state: "ASSIGNED", active: true, version: 4,
      reference: "JOB-FIXTURE", serviceLabel: "Synthetic service",
      slotStart: "2030-01-01T10:00:00Z", slotEnd: "2030-01-01T11:00:00Z", timeZone: "Europe/Paris",
    },
    request: { jobId, assignmentId, expectedPermissionVersion: 3, expectedAssignmentVersion: 7, expectedJobVersion: 4 },
    now: "2030-01-01T09:30:00Z",
  };
}
function allDeny(input: unknown) {
  expect(authorizeWorkerJob(input)).toEqual(denied);
  expect(projectWorkerJob(input)).toEqual(denied);
  expect(decideWorkerJobTransition(input, { to: "EN_ROUTE", idempotencyKey: key })).toEqual(denied);
}

describe("separate worker assignment authorization", () => {
  it("allows a trusted active principal's current assignment inside its exact access window", () => {
    expect(authorizeWorkerJob(fixture())).toEqual({ allowed: true });
    const input = fixture(); input.now = input.assignment.accessStartsAt;
    expect(authorizeWorkerJob(input)).toEqual({ allowed: true });
  });

  it.each([
    ["access", "tenantId"], ["assignment", "tenantId"], ["job", "tenantId"],
    ["access", "userId"], ["assignment", "userId"],
    ["access", "workerId"], ["assignment", "workerId"],
    ["assignment", "jobId"], ["request", "jobId"], ["request", "assignmentId"],
    ["actor", "tenantId"], ["actor", "userId"], ["actor", "workerId"],
  ])("denies mismatched %s.%s without a different enumeration response", (record, field) => {
    const input = fixture();
    (input[record as keyof WorkerAuthorizationInput] as unknown as Record<string, unknown>)[field!] = foreignId;
    allDeny(input);
  });

  it.each([
    ["actor", "sessionActive"], ["access", "active"], ["access", "workerActive"],
    ["assignment", "active"], ["job", "active"],
  ])("denies inactive %s.%s", (record, field) => {
    const input = fixture();
    (input[record as keyof WorkerAuthorizationInput] as unknown as Record<string, unknown>)[field!] = false;
    allDeny(input);
  });

  it.each(["access", "assignment"] as const)("denies revoked %s including future-dated revocation", record => {
    for (const at of ["2030-01-01T09:00:00Z", "2030-01-02T09:00:00Z"]) {
      const input = fixture(); input[record].revokedAt = at; allDeny(input);
    }
  });

  it.each(["expectedPermissionVersion", "expectedAssignmentVersion", "expectedJobVersion"] as const)(
    "denies stale or future %s", field => {
      for (const delta of [-1, 1]) { const input = fixture(); input.request[field] += delta; allDeny(input); }
    },
  );

  it.each(["2030-01-01T08:59:59Z", "2030-01-01T12:00:00Z", "2030-01-02T09:30:00Z"])(
    "denies access outside [start,end): %s", now => { const input = fixture(); input.now = now; allDeny(input); },
  );

  it("compares instants rather than local display offsets", () => {
    const input = fixture(); input.now = "2030-01-01T10:30:00+01:00";
    expect(authorizeWorkerJob(input)).toEqual({ allowed: true });
  });

  it("fails closed on malformed records, windows, versions and unknown request fields", () => {
    const inputs: unknown[] = [null, undefined, {}, { ...fixture(), request: { ...fixture().request, tenantId: foreignId } }];
    for (const patch of [
      { now: "invalid" },
      { assignment: { ...fixture().assignment, accessEndsAt: "2030-01-01T09:00:00Z" } },
      { job: { ...fixture().job, slotEnd: "2030-01-01T09:00:00Z" } },
      { job: { ...fixture().job, timeZone: "Invalid/Zone" } },
      { access: { ...fixture().access, permissionVersion: Number.MAX_SAFE_INTEGER + 1 } },
      { access: { ...fixture().access, active: "true" } },
      { request: { ...fixture().request, expectedJobVersion: 4.5 } },
      { request: { ...fixture().request, jobId: "private@example.test" } },
    ]) inputs.push({ ...fixture(), ...patch });
    for (const input of inputs) allDeny(input);
  });

  it("rechecks current access after a previous allow; the earlier decision cannot authorize revocation", () => {
    const input = fixture(); expect(authorizeWorkerJob(input).allowed).toBe(true);
    input.assignment.revokedAt = input.now; allDeny(input);
  });

  it("does not add worker or manager to the broad business TenantRole", () => {
    expect(TenantRole.options).toEqual(["BUSINESS_OWNER", "BUSINESS_STAFF"]);
    expect(TenantRole.safeParse("WORKER").success).toBe(false);
  });
});

describe("job execution proposals cannot become payment or assignment authority", () => {
  it.each([
    ["ASSIGNED", "EN_ROUTE"], ["EN_ROUTE", "ARRIVED"],
    ["ARRIVED", "IN_PROGRESS"], ["IN_PROGRESS", "COMPLETED"],
  ] as const)("permits only the next job edge %s -> %s without mutating input", (from, to) => {
    const input = fixture(); input.job.state = from; const before = structuredClone(input);
    expect(decideWorkerJobTransition(input, { to, idempotencyKey: key })).toEqual({
      allowed: true, transition: { jobId, assignmentId, from, to, expectedPermissionVersion: 3,
        expectedAssignmentVersion: 7, expectedJobVersion: 4, idempotencyKey: key },
    });
    expect(input).toEqual(before);
  });

  it("denies every skipped, reversed, self-assignment and repeated edge", () => {
    for (const from of WorkerJobState.options) for (const to of WorkerJobState.options) {
      if (WORKER_JOB_TRANSITIONS[from].includes(to)) continue;
      const input = fixture(); input.job.state = from;
      expect(decideWorkerJobTransition(input, { to, idempotencyKey: key })).toEqual(denied);
    }
  });

  it.each(["confirmed", "CONFIRMED", "pending_payment", "refunded", "CANCELLED", "ASSIGN_WORKER"])(
    "rejects booking/payment/assignment target %s", to => {
      expect(decideWorkerJobTransition(fixture(), { to, idempotencyKey: key })).toEqual(denied);
    },
  );

  it("rejects self-assignment payloads and missing/invalid idempotency keys", () => {
    for (const command of [
      { to: "EN_ROUTE", idempotencyKey: key, workerId: foreignId },
      { to: "EN_ROUTE", idempotencyKey: key, paymentId: foreignId },
      { to: "EN_ROUTE", idempotencyKey: key, action: "assignWorker" },
      { to: "EN_ROUTE" }, { to: "EN_ROUTE", idempotencyKey: "short" },
      { to: "EN_ROUTE", idempotencyKey: "x".repeat(129) }, null,
    ]) expect(decideWorkerJobTransition(fixture(), command)).toEqual(denied);
  });
});

describe("minimal worker projection", () => {
  it("uses a detached immutable allowlist and drops sensitive source columns without evaluating them", () => {
    const input = fixture(); let privateRead = false;
    Object.assign(input.job, { pricing: { total: 123 }, paymentId: foreignId, customer: { email: "private@example.test" },
      gateCode: "private gate", notes: "private note", credentials: "private token", uploadUrl: "private URL", tenantSettings: {} });
    Object.defineProperty(input.job, "privateComputed", { enumerable: true, get() { privateRead = true; throw Error("private error"); } });
    const result = projectWorkerJob(input);
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw Error("expected projection");
    expect(Object.keys(result.job).sort()).toEqual([
      "jobId", "assignmentId", "reference", "serviceLabel", "state", "slotStart", "slotEnd", "timeZone",
      "permissionVersion", "assignmentVersion", "jobVersion", "allowedTransitions",
    ].sort());
    expect(JSON.stringify(result)).not.toContain("private"); expect(privateRead).toBe(false);
    expect(Object.isFrozen(result.job)).toBe(true); expect(Object.isFrozen(result.job.allowedTransitions)).toBe(true);
    expect(() => (result.job.allowedTransitions as string[]).push("CONFIRMED")).toThrow();
    input.job.serviceLabel = "changed"; expect(result.job.serviceLabel).toBe("Synthetic service");
  });

  it("keeps completed job summary nonfinancial and without further worker transitions", () => {
    const input = fixture(); input.job.state = "COMPLETED"; const result = projectWorkerJob(input);
    expect(result.allowed).toBe(true); if (result.allowed) expect(result.job.allowedTransitions).toEqual([]);
  });

  it("keeps the shared transition graph immutable", () => {
    expect(Object.isFrozen(WORKER_JOB_TRANSITIONS)).toBe(true);
    expect(() => Object.assign(WORKER_JOB_TRANSITIONS, { ASSIGNED: ["COMPLETED"] })).toThrow();
  });
});

describe("freshness after reassignment", () => {
  it("rejects the old assignment request and requires current identity plus all new versions", () => {
    const input = fixture();
    input.assignment.id = foreignId;
    input.assignment.version++;
    input.job.version++;
    allDeny(input);
    input.request.assignmentId = foreignId;
    input.request.expectedAssignmentVersion = input.assignment.version;
    input.request.expectedJobVersion = input.job.version;
    expect(authorizeWorkerJob(input)).toEqual({ allowed: true });
    // Assigning the same job to someone else immediately excludes the old actor.
    input.assignment.workerId = foreignId;
    input.assignment.userId = foreignId;
    allDeny(input);
  });

  it("does not accept a payment state as a current job or a zero-length job interval", () => {
    allDeny({ ...fixture(), job: { ...fixture().job, state: "confirmed" } });
    allDeny({ ...fixture(), job: { ...fixture().job, slotEnd: fixture().job.slotStart } });
  });
});

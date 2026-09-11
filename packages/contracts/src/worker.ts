import { z } from "zod";

/**
 * WorkerJobContract v1 — pure, server-input policy fixtures, NOT authentication
 * or RLS. The trusted caller must fetch the current actor, worker access, job
 * and assignment from authorized storage for EVERY call. Never accept those
 * records, their active flags, versions or `now` from a browser/AI request.
 *
 * These contracts grant no TenantRole. Workers must not be added to the broad
 * BUSINESS_STAFF role. Job execution is independent of booking/payment states.
 */
export const WorkerJobState = z.enum([
  "ASSIGNED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED",
]);
export type WorkerJobState = z.infer<typeof WorkerJobState>;

export const WORKER_JOB_TRANSITIONS: Readonly<Record<WorkerJobState, readonly WorkerJobState[]>> = Object.freeze({
  ASSIGNED: Object.freeze(["EN_ROUTE"] as const),
  EN_ROUTE: Object.freeze(["ARRIVED"] as const),
  ARRIVED: Object.freeze(["IN_PROGRESS"] as const),
  IN_PROGRESS: Object.freeze(["COMPLETED"] as const),
  COMPLETED: Object.freeze([] as const),
});

const Id = z.string().uuid();
const Version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const Instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const Zone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
});

/** Verified principal supplied by the server, not a client-selectable context. */
export const TrustedWorkerActor = z.object({
  tenantId: Id,
  userId: Id,
  workerId: Id,
  sessionActive: z.boolean(),
}).strict();
export type TrustedWorkerActor = z.infer<typeof TrustedWorkerActor>;

/** Separate worker-access bridge; no implicit business-membership privileges. */
export const WorkerAccessRecord = z.object({
  tenantId: Id,
  userId: Id,
  workerId: Id,
  active: z.boolean(),
  workerActive: z.boolean(),
  revokedAt: Instant.nullable(),
  permissionVersion: Version,
}).strict();
export type WorkerAccessRecord = z.infer<typeof WorkerAccessRecord>;

/** One current individual assignment. Crew expansion belongs to server allocation. */
export const WorkerAssignmentRecord = z.object({
  id: Id,
  tenantId: Id,
  jobId: Id,
  userId: Id,
  workerId: Id,
  active: z.boolean(),
  revokedAt: Instant.nullable(),
  version: Version,
  accessStartsAt: Instant,
  accessEndsAt: Instant,
}).strict().refine(value => Date.parse(value.accessEndsAt) > Date.parse(value.accessStartsAt));
export type WorkerAssignmentRecord = z.infer<typeof WorkerAssignmentRecord>;

/**
 * Minimal server-selected job fields. Unknown columns are stripped, not copied
 * into the projection. Labels must already be approved for worker display;
 * this is a field whitelist, not a semantic PII/secret scrubber for free text.
 */
export const WorkerJobRecord = z.object({
  id: Id,
  tenantId: Id,
  state: WorkerJobState,
  active: z.boolean(),
  version: Version,
  reference: z.string().min(1).max(64),
  serviceLabel: z.string().min(1).max(160),
  slotStart: Instant,
  slotEnd: Instant,
  timeZone: Zone,
}).strip().refine(value => Date.parse(value.slotEnd) > Date.parse(value.slotStart));
export type WorkerJobRecord = z.infer<typeof WorkerJobRecord>;

/** Client may request only these IDs/preconditions; none grants access by itself. */
export const WorkerJobRequest = z.object({
  jobId: Id,
  assignmentId: Id,
  expectedPermissionVersion: Version,
  expectedAssignmentVersion: Version,
  expectedJobVersion: Version,
}).strict();
export type WorkerJobRequest = z.infer<typeof WorkerJobRequest>;

export const WorkerAuthorizationInput = z.object({
  actor: TrustedWorkerActor,
  access: WorkerAccessRecord,
  assignment: WorkerAssignmentRecord,
  job: WorkerJobRecord,
  request: WorkerJobRequest,
  now: Instant,
}).strict();
export type WorkerAuthorizationInput = z.infer<typeof WorkerAuthorizationInput>;

export type WorkerAuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: "FORBIDDEN" };
const forbidden = () => ({ allowed: false, code: "FORBIDDEN" } as const);

/** Internal diagnostic details must not become job-enumeration error responses. */
function authorizedInput(input: unknown): WorkerAuthorizationInput | null {
  try {
    const parsed = WorkerAuthorizationInput.safeParse(input);
    if (!parsed.success) return null;
    const context = parsed.data;
    const { actor, access, assignment, job, request, now } = context;
    if (!actor.sessionActive || !access.active || !access.workerActive || access.revokedAt !== null
      || !assignment.active || assignment.revokedAt !== null || !job.active) return null;
    if (access.tenantId !== actor.tenantId || assignment.tenantId !== actor.tenantId
      || job.tenantId !== actor.tenantId) return null;
    if (access.userId !== actor.userId || assignment.userId !== actor.userId
      || access.workerId !== actor.workerId || assignment.workerId !== actor.workerId) return null;
    if (assignment.jobId !== job.id || request.jobId !== job.id || request.assignmentId !== assignment.id) return null;
    if (request.expectedPermissionVersion !== access.permissionVersion
      || request.expectedAssignmentVersion !== assignment.version
      || request.expectedJobVersion !== job.version) return null;
    const instant = Date.parse(now);
    if (instant < Date.parse(assignment.accessStartsAt) || instant >= Date.parse(assignment.accessEndsAt)) return null;
    return context;
  } catch {
    // Malformed in-process values are denied without exposing input/error strings.
    return null;
  }
}

export function authorizeWorkerJob(input: unknown): WorkerAuthorizationDecision {
  return authorizedInput(input) ? { allowed: true } : forbidden();
}

/** Includes no assignment management, reschedule, cancel or financial operations. */
export const WorkerJobTransitionCommand = z.object({
  to: WorkerJobState,
  idempotencyKey: z.string().min(16).max(128),
}).strict();
export type WorkerJobTransitionCommand = z.infer<typeof WorkerJobTransitionCommand>;

export interface WorkerJobTransitionProposal {
  readonly jobId: string;
  readonly assignmentId: string;
  readonly from: WorkerJobState;
  readonly to: WorkerJobState;
  readonly expectedPermissionVersion: number;
  readonly expectedAssignmentVersion: number;
  readonly expectedJobVersion: number;
  readonly idempotencyKey: string;
}
export type WorkerJobTransitionDecision =
  | { readonly allowed: true; readonly transition: WorkerJobTransitionProposal }
  | { readonly allowed: false; readonly code: "FORBIDDEN" };

/**
 * Returns a proposal only. Does not mutate job/booking/payment or implement
 * durable idempotency. The future server transaction must recheck current
 * versions/authorization and persist its state+audit atomically; repeated keys
 * require a durable same-payload receipt, not a second execution of this helper.
 */
export function decideWorkerJobTransition(input: unknown, command: unknown): WorkerJobTransitionDecision {
  const context = authorizedInput(input);
  if (!context) return forbidden();
  try {
    const parsed = WorkerJobTransitionCommand.safeParse(command);
    if (!parsed.success || !WORKER_JOB_TRANSITIONS[context.job.state].includes(parsed.data.to)) return forbidden();
    return {
      allowed: true,
      transition: {
        jobId: context.job.id,
        assignmentId: context.assignment.id,
        from: context.job.state,
        to: parsed.data.to,
        expectedPermissionVersion: context.access.permissionVersion,
        expectedAssignmentVersion: context.assignment.version,
        expectedJobVersion: context.job.version,
        idempotencyKey: parsed.data.idempotencyKey,
      },
    };
  } catch { return forbidden(); }
}

/** No prices, customer contact/history, private notes, gate codes or upload URLs. */
export interface WorkerJobProjection {
  readonly jobId: string;
  readonly assignmentId: string;
  readonly reference: string;
  readonly serviceLabel: string;
  readonly state: WorkerJobState;
  readonly slotStart: string;
  readonly slotEnd: string;
  readonly timeZone: string;
  readonly permissionVersion: number;
  readonly assignmentVersion: number;
  readonly jobVersion: number;
  readonly allowedTransitions: readonly WorkerJobState[];
}
export type WorkerJobProjectionDecision =
  | { readonly allowed: true; readonly job: WorkerJobProjection }
  | { readonly allowed: false; readonly code: "FORBIDDEN" };

/** Each projection reauthorizes; a prior allowed decision is not reusable authority. */
export function projectWorkerJob(input: unknown): WorkerJobProjectionDecision {
  const context = authorizedInput(input);
  if (!context) return forbidden();
  const { job, assignment, access } = context;
  return {
    allowed: true,
    job: Object.freeze({
      jobId: job.id,
      assignmentId: assignment.id,
      reference: job.reference,
      serviceLabel: job.serviceLabel,
      state: job.state,
      slotStart: job.slotStart,
      slotEnd: job.slotEnd,
      timeZone: job.timeZone,
      permissionVersion: access.permissionVersion,
      assignmentVersion: assignment.version,
      jobVersion: job.version,
      allowedTransitions: WORKER_JOB_TRANSITIONS[job.state],
    }),
  };
}

import { z } from "zod";
import { TenantRole, BookingState } from "@lumin/contracts";

const Id = z.string().uuid();
const Version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Instant = z.string().datetime({ offset: true }).refine(s => Number.isFinite(Date.parse(s)));
const interval = { startsAt: Instant, endsAt: Instant };
const validInterval = (v: { startsAt: string; endsAt: string }) => Date.parse(v.endsAt) > Date.parse(v.startsAt);
const common = { schemaVersion: z.literal(1), requestId: Id, tenantId: Id };
const mutation = { expectedVersion: Version, idempotencyKey: z.string().min(16).max(128) };
export const ActionRequest = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("getBooking"), body: z.object({ bookingId: Id }).strict() }).strict(),
  z.object({ ...common, action: z.literal("findAvailability"), body: z.object({ serviceId: Id, ...interval }).strict().refine(v => validInterval(v) && Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 31 * 86400000) }).strict(),
  z.object({ ...common, ...mutation, action: z.literal("assignWorker"), body: z.object({ bookingId: Id, workerId: Id }).strict() }).strict(),
  z.object({ ...common, ...mutation, action: z.literal("rescheduleBooking"), body: z.object({ bookingId: Id, ...interval }).strict().refine(validInterval) }).strict(),
  z.object({ ...common, ...mutation, action: z.literal("cancelBooking"), body: z.object({ bookingId: Id }).strict() }).strict(),
]);
export type ActionRequest = z.infer<typeof ActionRequest>;
export type ActionName = ActionRequest["action"];

/** Verified fresh server context only. A matching schema is not authentication. */
export const VerifiedActor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), userId: Id, tenantId: Id, role: TenantRole, permissionVersion: Version, expiresAt: Instant }).strict(),
  z.object({ kind: z.literal("worker"), userId: Id, tenantId: Id, workerId: Id, permissionVersion: Version, expiresAt: Instant }).strict(),
]);
export type VerifiedActor = z.infer<typeof VerifiedActor>;
type MemberActor = Extract<VerifiedActor, { kind: "member" }>;
export const ERROR_CODES = ["UNAUTHENTICATED", "INVALID_REQUEST", "FORBIDDEN", "CONFLICT", "NOT_AVAILABLE", "NOT_IMPLEMENTED", "INTERNAL_ERROR"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export class ActionHandlerError extends Error {
  constructor(readonly code: "FORBIDDEN" | "CONFLICT" | "NOT_AVAILABLE") { super(code); }
}
const BookingResult = z.object({ bookingId: Id, version: Version, state: BookingState }).strict();
const AvailabilityResult = z.object({ offers: z.array(z.object(interval).strict().refine(validInterval)).max(200), expiresAt: Instant }).strict();
const MutationResult = z.object({ bookingId: Id, version: Version }).strict();
export type ActionResult = z.infer<typeof BookingResult> | z.infer<typeof AvailabilityResult> | z.infer<typeof MutationResult>;
export type ActionResponse = { ok: true; requestId: string; result: ActionResult } | { ok: false; code: ErrorCode };
export type Handler<K extends ActionName> = (context: { readonly actor: Readonly<MemberActor>; readonly request: Extract<ActionRequest, { action: K }> }) => Promise<unknown>;
export type ActionHandlers = { [K in ActionName]?: Handler<K> };
export interface ActionApiDependencies {
  /** Must verify session signature/expiry/revocation and current tenant membership.
   * Never derive role/tenant by decoding an unverified browser payload. */
  authenticate?: (credential: string) => Promise<unknown>;
  handlers?: ActionHandlers;
  /** Trusted server clock, injected only for deterministic tests. */
  now?: () => number;
}
const fail = (code: ErrorCode): ActionResponse => ({ ok: false, code });

/** Framework-neutral boundary. Accepts bounded JSON text, not client actor objects.
 * Domain handlers remain authoritative and must use caller-scoped RLS/transactions.
 */
export function createActionApi(dependencies: ActionApiDependencies = {}) {
  const authenticate = dependencies.authenticate;
  const handlers = { ...dependencies.handlers };
  const now = dependencies.now ?? Date.now;
  return {
    async dispatch(credential: unknown, json: unknown): Promise<ActionResponse> {
      if (!authenticate || typeof credential !== "string" || !credential.length || credential.length > 8192) return fail("UNAUTHENTICATED");
      if (typeof json !== "string" || json.length > 16384 || new TextEncoder().encode(json).byteLength > 16384) return fail("INVALID_REQUEST");
      let request: ActionRequest;
      try { request = ActionRequest.parse(JSON.parse(json)); } catch { return fail("INVALID_REQUEST"); }
      let actor: VerifiedActor;
      try {
        actor = VerifiedActor.parse(await authenticate(credential));
        if (!Number.isFinite(now()) || Date.parse(actor.expiresAt) <= now()) return fail("UNAUTHENTICATED");
      } catch { return fail("UNAUTHENTICATED"); }
      if (actor.tenantId !== request.tenantId || actor.kind !== "member") return fail("FORBIDDEN");
      // Conservative initial policy: staff may read, only owner may request mutations.
      if (actor.role !== "BUSINESS_OWNER" && request.action !== "getBooking" && request.action !== "findAvailability") return fail("FORBIDDEN");
      const handler = handlers[request.action];
      if (!handler) return fail("NOT_IMPLEMENTED");
      try {
        // Freeze the detached parsed request so injected handlers cannot rewrite authority.
        Object.freeze(request.body); Object.freeze(request); Object.freeze(actor);
        const result = await (handler as (c: { actor: MemberActor; request: ActionRequest }) => Promise<unknown>)({ actor, request });
        const parsed = request.action === "getBooking" ? BookingResult.parse(result)
          : request.action === "findAvailability" ? AvailabilityResult.parse(result) : MutationResult.parse(result);
        if ("bookingId" in parsed && "bookingId" in request.body && parsed.bookingId !== request.body.bookingId) return fail("INTERNAL_ERROR");
        // Suppress a response that completes after session expiry. Handlers must
        // recheck revocation and state in the committing transaction themselves.
        if (!Number.isFinite(now()) || Date.parse(actor.expiresAt) <= now()) return fail("UNAUTHENTICATED");
        return { ok: true, requestId: request.requestId, result: parsed };
      } catch (error) {
        return fail(error instanceof ActionHandlerError && ["FORBIDDEN", "CONFLICT", "NOT_AVAILABLE"].includes(error.code) ? error.code : "INTERNAL_ERROR");
      }
    },
  };
}

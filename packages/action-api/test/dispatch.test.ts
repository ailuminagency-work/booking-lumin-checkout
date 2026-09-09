import { describe, expect, it, vi } from "vitest";
import { ActionHandlerError, createActionApi, type ActionName } from "../src/index";
const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const bookingId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const otherId = "55555555-5555-4555-8555-555555555555";
const now = () => Date.parse("2030-01-01T12:00:00Z");
const member = () => ({ kind: "member", userId, tenantId, role: "BUSINESS_OWNER", permissionVersion: 3, expiresAt: "2030-01-01T13:00:00Z" });
function request(action: ActionName = "getBooking"): any {
  const base = { schemaVersion: 1, requestId, tenantId, action };
  if (action === "getBooking") return { ...base, body: { bookingId } };
  if (action === "findAvailability") return { ...base, body: { serviceId: bookingId, startsAt: "2030-01-02T09:00:00Z", endsAt: "2030-01-02T12:00:00Z" } };
  return { ...base, expectedVersion: 7, idempotencyKey: "synthetic-action-key", body: { bookingId, ...(action === "assignWorker" ? {workerId: otherId} : action === "rescheduleBooking" ? { startsAt: "2030-01-02T09:00:00Z", endsAt: "2030-01-02T10:00:00Z" } : {}) } };
}
const result = { bookingId, version: 7, state: "draft" };
const json = (r: unknown) => JSON.stringify(r);
const no = (code: string) => ({ ok: false, code });
function harness(actor: unknown = member()) {
  const handler = vi.fn(async () => result);
  const authenticate = vi.fn(async (credential: string) => credential === "test-session" ? actor : null);
  return { handler, authenticate, api: createActionApi({ authenticate, now, handlers: {getBooking: handler} }) };
}
describe("controlled dispatch", () => {
  it("requires a configured verifier and does not treat a credential as identity", async () => {
    expect(await createActionApi().dispatch("anything", json(request()))).toEqual(no("UNAUTHENTICATED"));
    const h = harness();
    for (const credential of [null, "", {actor: member()}, "forged-token", "x".repeat(8193)]) expect(await h.api.dispatch(credential, json(request()))).toEqual(no("UNAUTHENTICATED"));
    expect(h.handler).not.toHaveBeenCalled();
  });
  it("dispatches only detached verified identity and strict request", async () => {
    const h = harness(); expect(await h.api.dispatch("test-session", json(request()))).toEqual({ok:true,requestId,result});
    const context = h.handler.mock.calls[0]; expect(context).toBeDefined();
    expect(h.authenticate).toHaveBeenCalledWith("test-session");
  });
  it.each(["actor","role","userId","workerId","sql","table"])("rejects client authority property %s", async field => {
    const h = harness(); expect(await h.api.dispatch("test-session", json({...request(),[field]:member()}))).toEqual(no("INVALID_REQUEST"));expect(h.handler).not.toHaveBeenCalled();
  });
  it("rejects cross-tenant actions even from a valid authenticated owner", async () => {
    const h = harness(); expect(await h.api.dispatch("test-session",json({...request(),tenantId:otherId}))).toEqual(no("FORBIDDEN"));expect(h.handler).not.toHaveBeenCalled();
  });
  it("fails closed on expired, malformed, inactive or platform-only verifier output", async () => {
    for (const actor of [null, {...member(),expiresAt:"2030-01-01T12:00:00Z"}, {...member(),active:false}, {...member(),role:"PLATFORM_ADMIN"}, {...member(),permissionVersion:0}]) {
      const h=harness(actor);expect(await h.api.dispatch("test-session",json(request()))).toEqual(no("UNAUTHENTICATED"));expect(h.handler).not.toHaveBeenCalled();
    }
  });
  it.each(["getBooking","findAvailability","assignWorker","rescheduleBooking","cancelBooking"] as const)("keeps workers outside broad %s authority", async action => {
    const h=harness({kind:"worker",tenantId,userId,workerId:otherId,permissionVersion:1,expiresAt:member().expiresAt});expect(await h.api.dispatch("test-session",json(request(action)))).toEqual(no("FORBIDDEN"));expect(h.handler).not.toHaveBeenCalled();
  });
  it("allows staff reads but denies all owner mutations", async () => {
    const h=harness({...member(),role:"BUSINESS_STAFF"});expect((await h.api.dispatch("test-session",json(request()))).ok).toBe(true);
    for (const action of ["assignWorker","rescheduleBooking","cancelBooking"] as const) expect(await h.api.dispatch("test-session",json(request(action)))).toEqual(no("FORBIDDEN"));
  });
  it("fails unimplemented actions without pretending domain work happened", async () => {
    const h=harness();expect(await h.api.dispatch("test-session",json(request("cancelBooking")))).toEqual(no("NOT_IMPLEMENTED"));
  });
  it("bounds JSON bytes, versions, body fields and allowed actions", async () => {
    const h=harness(); const req=request("assignWorker");
    for(const body of ["bad JSON", json({...request(),action:"updateRows"}),json({...request(),schemaVersion:2}),json({...request(),body:{bookingId,paid:true}}),json({...req,expectedVersion:Number.MAX_SAFE_INTEGER+1}),json({...req,idempotencyKey:"short"}),json({...request(),unused:"é".repeat(8500)})]) expect(await h.api.dispatch("test-session",body)).toEqual(no("INVALID_REQUEST"));
    expect(h.handler).not.toHaveBeenCalled();
  });
  it("passes exact mutation preconditions and leaves stale/idempotent decisions to authority", async () => {
    const handler=vi.fn(async ({request: r}: any) => { if(r.expectedVersion!==7)throw new ActionHandlerError("CONFLICT");return {bookingId,version:8}; });
    const api=createActionApi({authenticate:async()=>member(),now,handlers:{cancelBooking:handler}});
    const r=request("cancelBooking");expect((await api.dispatch("test-session",json(r))).ok).toBe(true);
    expect(handler.mock.calls[0]![0].request).toEqual(r);expect(Object.isFrozen(handler.mock.calls[0]![0].request)).toBe(true);
    expect(await api.dispatch("test-session",json({...r,expectedVersion:6}))).toEqual(no("CONFLICT"));
    await api.dispatch("test-session",json(r)); expect(handler.mock.calls[2]![0].request.idempotencyKey).toBe(r.idempotencyKey);
  });
  it("redacts thrown errors and rejects handler PII/foreign record output", async () => {
    for(const handler of [async()=>{throw Error("secret-token")},async()=>({...result,email:"secret@email"}),async()=>({...result,bookingId:otherId}),async()=>{const error=new ActionHandlerError("CONFLICT");(error as any).code="secret-token";throw error;}]) {
      const api=createActionApi({authenticate:async()=>member(),now,handlers:{getBooking:handler}});expect(await api.dispatch("test-session",json(request()))).toEqual(no("INTERNAL_ERROR"));
    }
  });
  it("suppresses response after session expiry without claiming rollback", async () => {
    let clock=now();const api=createActionApi({authenticate:async()=>member(),now:()=>clock,handlers:{getBooking:async()=>{clock+=3600000;return result;}}});
    expect(await api.dispatch("test-session",json(request()))).toEqual(no("UNAUTHENTICATED"));
  });
  it("dispatches availability and each mutation to the named handler only", async () => {
    const handlers={findAvailability:vi.fn(async()=>({offers:[],expiresAt:member().expiresAt})),assignWorker:vi.fn(async()=>({bookingId,version:8})),rescheduleBooking:vi.fn(async()=>({bookingId,version:8})),cancelBooking:vi.fn(async()=>({bookingId,version:8}))};
    const api=createActionApi({authenticate:async()=>member(),now,handlers});for(const action of Object.keys(handlers) as (keyof typeof handlers)[]){expect((await api.dispatch("test-session",json(request(action)))).ok).toBe(true);expect(handlers[action]).toHaveBeenCalledTimes(1);}
  });
  it("rejects inverted and excessive availability windows", async () => {
    const h=harness(); const r=request("findAvailability");for(const endsAt of [r.body.startsAt,"2031-01-02T12:00:00Z"]){expect(await h.api.dispatch("test-session",json({...r,body:{...r.body,endsAt}}))).toEqual(no("INVALID_REQUEST"));}
  });
});

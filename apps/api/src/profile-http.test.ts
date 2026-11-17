import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createFlowHttpServer } from "./http.js";
import type { FlowRepository } from "./repository.js";

const owner = "https://portal.staging.example.test";
const actorA = "a3100000-0000-4000-8000-000000000001";
const tenantA = "a3100000-0000-4000-8000-000000000002";
const tenantB = "b3100000-0000-4000-8000-000000000002";

describe("authenticated tenant profile endpoint", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  async function start() {
    const repository: FlowRepository = { call: async () => { throw new Error("unexpected RPC"); } };
    const http = createFlowHttpServer({
      repository,
      ownerOrigins: [owner],
      customerOrigins: [],
      authenticateOwner: async (credential) => credential === "owner-token-123456" ? actorA : null,
      tenantProfile: async (actor, tenant) => actor === actorA && tenant === tenantA ? {
        id: tenantA, name: "Housekeeping Staging", slug: "housekeeping-staging", timezone: "UTC", currency: "USD", status: "active",
      } : null,
    });
    server = createServer((request, response) => http.emit("request", request, response));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  it("returns only the authenticated tenant profile", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/profile?tenantId=${tenantA}`, {
      headers: { authorization: "Bearer owner-token-123456", origin: owner },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { schemaVersion: 1, profile: {
      id: tenantA, name: "Housekeeping Staging", slug: "housekeeping-staging", timezone: "UTC", currency: "USD", status: "active",
    } } });
  });

  it("denies a tenant spoof without disclosing the other profile", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/profile?tenantId=${tenantB}`, {
      headers: { authorization: "Bearer owner-token-123456", origin: owner },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, code: "NOT_AVAILABLE" });
  });
});

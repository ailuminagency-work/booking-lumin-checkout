import { describe, expect, it } from "vitest";
import {
  createMockTokenVault,
  redactConnectionForClient,
  type ServerConnection,
  type TokenSet,
} from "../src/oauth";
import { TENANT_A, uuid } from "./fixtures";

const TOKENS: TokenSet = {
  accessToken: "ya29.SUPER-SECRET-ACCESS",
  refreshToken: "1//REFRESH-SECRET",
  expiresAt: 9_999_999_999_000,
  scope: "calendar.events",
};

function serverConnection(): ServerConnection {
  return {
    id: uuid(1),
    tenantId: TENANT_A,
    kind: "calendar",
    provider: "google",
    status: "connected",
    lastCheckAt: "2026-09-07T12:00:00.000Z",
    lastError: null,
    tokens: TOKENS,
  };
}

describe("redactConnectionForClient", () => {
  it("exposes only status/health/provider metadata — no token material survives", () => {
    const client = redactConnectionForClient(serverConnection());

    // What a business user MAY see.
    expect(client.provider).toBe("google");
    expect(client.status).toBe("connected");
    expect(client.health).toBe("healthy");
    expect(client.lastCheckAt).toBe("2026-09-07T12:00:00.000Z");

    // Allowlist: no token-bearing keys at all.
    expect(Object.prototype.hasOwnProperty.call(client, "tokens")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(client, "accessToken")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(client, "refreshToken")).toBe(false);

    // Deep proof: no secret value appears ANYWHERE in the serialized output.
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain("SUPER-SECRET-ACCESS");
    expect(serialized).not.toContain("REFRESH-SECRET");
    expect(serialized.toLowerCase()).not.toContain("accesstoken");
    expect(serialized.toLowerCase()).not.toContain("refreshtoken");
  });

  it("maps status → coarse health for the client view", () => {
    const base = serverConnection();
    expect(redactConnectionForClient({ ...base, status: "connected" }).health).toBe("healthy");
    expect(redactConnectionForClient({ ...base, status: "error" }).health).toBe("degraded");
    expect(redactConnectionForClient({ ...base, status: "not_connected" }).health).toBe("disconnected");
    expect(redactConnectionForClient({ ...base, status: "revoked" }).health).toBe("disconnected");
  });
});

describe("TokenVault (server-only)", () => {
  it("stores and returns tokens only through the server-side vault", async () => {
    const vault = createMockTokenVault();
    const connId = uuid(1);
    expect(await vault.has(connId)).toBe(false);
    await vault.save(connId, TOKENS);
    expect(await vault.has(connId)).toBe(true);
    expect((await vault.load(connId))?.accessToken).toBe("ya29.SUPER-SECRET-ACCESS");
    await vault.delete(connId);
    expect(await vault.load(connId)).toBeUndefined();
  });
});

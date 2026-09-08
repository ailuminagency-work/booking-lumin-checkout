import { describe, expect, it } from "vitest";
import {
  canTransitionStatus,
  checkHealth,
  connectConnection,
  disconnectConnection,
  markConnectionError,
  newCalendarConnection,
  reconnectConnection,
  revokeConnection,
} from "../src/connection";
import { TENANT_A, uuid } from "./fixtures";

const AT = "2026-09-07T12:00:00.000Z";

describe("connection lifecycle", () => {
  it("a new calendar connection starts NOT CONNECTED (SI-12)", () => {
    const conn = newCalendarConnection(uuid(1), TENANT_A, "google");
    expect(conn.status).toBe("not_connected");
    expect(conn.kind).toBe("calendar");
    expect(conn.lastCheckAt).toBeNull();
  });

  it("connect → connected clears the error and stamps the check time", () => {
    const conn = newCalendarConnection(uuid(1), TENANT_A, "google");
    const connected = connectConnection(conn, AT);
    expect(connected.status).toBe("connected");
    expect(connected.lastCheckAt).toBe(AT);
    expect(connected.lastError).toBeNull();
  });

  it("disconnect → not_connected, revoke → revoked, error records the message", () => {
    const conn = connectConnection(newCalendarConnection(uuid(1), TENANT_A, "google"), AT);
    expect(disconnectConnection(conn).status).toBe("not_connected");
    expect(revokeConnection(conn).status).toBe("revoked");
    const errored = markConnectionError(conn, "token expired", AT);
    expect(errored.status).toBe("error");
    expect(errored.lastError).toBe("token expired");
  });

  it("reconnect brings a revoked/errored connection back to connected", () => {
    const conn = revokeConnection(connectConnection(newCalendarConnection(uuid(1), TENANT_A, "google"), AT));
    const back = reconnectConnection(conn, AT);
    expect(back.status).toBe("connected");
    expect(back.lastError).toBeNull();
  });

  it("transitions are guarded", () => {
    expect(canTransitionStatus("not_connected", "connected")).toBe(true);
    expect(canTransitionStatus("connected", "revoked")).toBe(true);
    expect(canTransitionStatus("revoked", "connected")).toBe(true);
    expect(canTransitionStatus("not_connected", "revoked")).toBe(false);
  });
});

describe("checkHealth", () => {
  it("derives health from the connection status", () => {
    const conn = connectConnection(newCalendarConnection(uuid(1), TENANT_A, "google"), AT);
    const h = checkHealth(conn);
    expect(h.healthy).toBe(true);
    expect(h.status).toBe("connected");
    expect(h.provider).toBe("google");
  });

  it("honors an override (e.g. a live ping that found an error)", () => {
    const conn = connectConnection(newCalendarConnection(uuid(1), TENANT_A, "microsoft"), AT);
    const h = checkHealth(conn, { status: "error", lastError: "429 rate limited" });
    expect(h.healthy).toBe(false);
    expect(h.status).toBe("error");
    expect(h.lastError).toBe("429 rate limited");
  });
});

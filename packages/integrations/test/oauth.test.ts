import { describe, expect, it } from "vitest";
import {
  beginOAuth,
  canTransitionOAuth,
  createMockNonceStore,
  deriveCodeChallenge,
  generatePkce,
  OAuthError,
  verifyCallback,
} from "../src/oauth";
import { NOW, SERVER_KEY, TENANT_A, TENANT_B } from "./fixtures";

const REDIRECT = "https://portal.mock.local/oauth/callback";

function begin(overrides: Partial<Parameters<typeof beginOAuth>[0]> = {}) {
  return beginOAuth({
    tenantId: TENANT_A,
    provider: "google",
    redirectUri: REDIRECT,
    serverKey: SERVER_KEY,
    now: NOW,
    nonce: "fixed-nonce-1",
    codeVerifier: "fixed-verifier-abcdefghijklmnopqrstuvwxyz0123456789",
    ttlSeconds: 600,
    ...overrides,
  });
}

describe("beginOAuth", () => {
  it("issues a signed state token and PKCE, and moves to authorizing", () => {
    const r = begin();
    expect(r.state).toBe("authorizing");
    expect(r.stateToken).toBe(r.authorizationRequest.state);
    expect(r.stateToken.includes(".")).toBe(true);
    expect(r.authorizationRequest.responseType).toBe("code");
    expect(r.authorizationRequest.redirectUri).toBe(REDIRECT);
    expect(r.authorizationRequest.codeChallengeMethod).toBe("S256");
    // The verifier is server-only; only the challenge is in the request.
    expect(JSON.stringify(r.authorizationRequest)).not.toContain(r.codeVerifier);
  });
});

describe("PKCE S256 derivation", () => {
  it("code_challenge is the base64url SHA-256 of the verifier", () => {
    const pkce = generatePkce("fixed-verifier-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(pkce.codeChallenge).toBe(deriveCodeChallenge(pkce.codeVerifier));
    // base64url alphabet only (no +, /, =).
    expect(/^[A-Za-z0-9_-]+$/.test(pkce.codeChallenge)).toBe(true);
  });

  it("beginOAuth's challenge matches its returned verifier", () => {
    const r = begin();
    expect(r.authorizationRequest.codeChallenge).toBe(deriveCodeChallenge(r.codeVerifier));
  });
});

describe("verifyCallback — the happy path", () => {
  it("accepts a correct callback exactly once and returns the bound tenant + code", () => {
    const nonceStore = createMockNonceStore();
    const r = begin();
    const result = verifyCallback({
      stateToken: r.stateToken,
      returnedState: r.stateToken,
      code: "auth-code-xyz",
      expectedTenantId: TENANT_A,
      serverKey: SERVER_KEY,
      nonceStore,
      now: NOW + 1000,
    });
    expect(result.tenantId).toBe(TENANT_A);
    expect(result.provider).toBe("google");
    expect(result.code).toBe("auth-code-xyz");
    expect(result.state).toBe("callback_received");
    expect(nonceStore.isConsumed("fixed-nonce-1")).toBe(true);
  });
});

describe("verifyCallback — rejections", () => {
  it("rejects a FORGED state (tampered signature)", () => {
    const nonceStore = createMockNonceStore();
    const r = begin();
    // Flip a character in the signature segment.
    const dot = r.stateToken.indexOf(".");
    const payload = r.stateToken.slice(0, dot);
    const sig = r.stateToken.slice(dot + 1);
    const forged = `${payload}.${sig.slice(0, -1)}${sig.slice(-1) === "A" ? "B" : "A"}`;
    let err: unknown;
    try {
      verifyCallback({
        stateToken: forged,
        returnedState: forged,
        code: "c",
        expectedTenantId: TENANT_A,
        serverKey: SERVER_KEY,
        nonceStore,
        now: NOW + 1000,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("invalid_signature");
    // A forged attempt never burns the real nonce.
    expect(nonceStore.isConsumed("fixed-nonce-1")).toBe(false);
  });

  it("rejects a state MISMATCH (returnedState ≠ persisted stateToken) — anti-CSRF", () => {
    const nonceStore = createMockNonceStore();
    const r = begin();
    // Attacker supplies a validly-signed but DIFFERENT token as returnedState.
    const other = begin({ nonce: "attacker-nonce" });
    let err: unknown;
    try {
      verifyCallback({
        stateToken: r.stateToken,
        returnedState: other.stateToken,
        code: "c",
        expectedTenantId: TENANT_A,
        serverKey: SERVER_KEY,
        nonceStore,
        now: NOW + 1000,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("state_mismatch");
  });

  it("rejects a WRONG expectedTenantId — cross-tenant callback attach attempt", () => {
    const nonceStore = createMockNonceStore();
    // State was issued for TENANT_A; tenant B tries to complete it.
    const r = begin({ tenantId: TENANT_A });
    let err: unknown;
    try {
      verifyCallback({
        stateToken: r.stateToken,
        returnedState: r.stateToken,
        code: "c",
        expectedTenantId: TENANT_B,
        serverKey: SERVER_KEY,
        nonceStore,
        now: NOW + 1000,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("tenant_mismatch");
    // The cross-tenant attempt did not consume the nonce.
    expect(nonceStore.isConsumed("fixed-nonce-1")).toBe(false);
  });

  it("rejects an EXPIRED state", () => {
    const nonceStore = createMockNonceStore();
    const r = begin({ ttlSeconds: 600 });
    let err: unknown;
    try {
      verifyCallback({
        stateToken: r.stateToken,
        returnedState: r.stateToken,
        code: "c",
        expectedTenantId: TENANT_A,
        serverKey: SERVER_KEY,
        nonceStore,
        now: NOW + 601_000, // one second past the 600s TTL
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("expired");
  });

  it("rejects a REPLAYED (already-consumed) nonce; the first use succeeds", () => {
    const nonceStore = createMockNonceStore();
    const r = begin();
    const args = {
      stateToken: r.stateToken,
      returnedState: r.stateToken,
      code: "c",
      expectedTenantId: TENANT_A,
      serverKey: SERVER_KEY,
      nonceStore,
      now: NOW + 1000,
    };
    // First use: OK.
    expect(verifyCallback(args).state).toBe("callback_received");
    // Second use (replay): rejected.
    let err: unknown;
    try {
      verifyCallback(args);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("replayed");
  });

  it("rejects a state signed with a DIFFERENT server key", () => {
    const nonceStore = createMockNonceStore();
    const r = begin();
    let err: unknown;
    try {
      verifyCallback({
        stateToken: r.stateToken,
        returnedState: r.stateToken,
        code: "c",
        expectedTenantId: TENANT_A,
        serverKey: "a-different-server-key",
        nonceStore,
        now: NOW + 1000,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).code).toBe("invalid_signature");
  });
});

describe("OAuth state machine", () => {
  it("permits the connect happy path and forbids skipping", () => {
    expect(canTransitionOAuth("not_connected", "authorizing")).toBe(true);
    expect(canTransitionOAuth("authorizing", "callback_received")).toBe(true);
    expect(canTransitionOAuth("callback_received", "connected")).toBe(true);
    expect(canTransitionOAuth("connected", "revoked")).toBe(true);
    // Cannot jump straight from not_connected to connected.
    expect(canTransitionOAuth("not_connected", "connected")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { createSupabaseIdentityVerifier } from "./supabase-auth";

// Deterministic, dependency-free unit coverage for the REAL Supabase identity
// verifier that the production entrypoint wires (createSupabaseIdentityVerifier).
// No Postgres, no live network — `fetch` and `now` are injected.

const PROJECT_URL = "https://abcdefghij0123456789.supabase.co"; // 20-char host
const PUBLIC_KEY = "sb_publishable_unittestkey0123456789";
const NOW = 1_700_000_000_000;
const SUB = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-9222-222222222222";

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const SIGNATURE = Buffer.from("unit-test-signature-material").toString("base64url");

function makeToken(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
  return `${b64url(header)}.${b64url(claims)}.${SIGNATURE}`;
}

const validClaims = (): Record<string, unknown> => ({
  iss: `${PROJECT_URL}/auth/v1`,
  aud: "authenticated",
  is_anonymous: false,
  sub: SUB,
  session_id: SESSION,
  exp: Math.floor(NOW / 1000) + 3600,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createSupabaseIdentityVerifier — configuration", () => {
  it("rejects a malformed project URL at construction", () => {
    expect(() => createSupabaseIdentityVerifier({ projectUrl: "http://not-supabase", publicKey: PUBLIC_KEY })).toThrow(
      "INVALID_AUTH_CONFIGURATION",
    );
  });

  it("rejects a non-publishable, non-anon public key", () => {
    expect(() => createSupabaseIdentityVerifier({ projectUrl: PROJECT_URL, publicKey: "totally-bogus" })).toThrow(
      "INVALID_AUTH_CONFIGURATION",
    );
  });

  it("accepts a well-formed publishable-key configuration", () => {
    expect(() => createSupabaseIdentityVerifier({ projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY })).not.toThrow();
  });
});

describe("createSupabaseIdentityVerifier — verification", () => {
  it("resolves verified identity evidence when Supabase confirms the user", async () => {
    let calledUrl = "";
    const verify = createSupabaseIdentityVerifier(
      { projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY },
      {
        now: () => NOW,
        fetch: (async (input: RequestInfo | URL) => {
          calledUrl = String(input);
          return jsonResponse({ id: SUB, is_anonymous: false });
        }) as typeof fetch,
      },
    );
    const evidence = await verify(makeToken(validClaims()));
    expect(evidence.userId).toBe(SUB);
    expect(evidence.sessionId).toBe(SESSION);
    expect(new Date(evidence.expiresAt).getTime()).toBeGreaterThan(NOW);
    expect(calledUrl).toBe(`${PROJECT_URL}/auth/v1/user`);
  });

  it("rejects a structurally invalid bearer token without calling the network", async () => {
    let called = false;
    const verify = createSupabaseIdentityVerifier(
      { projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY },
      {
        now: () => NOW,
        fetch: (async () => {
          called = true;
          return jsonResponse({ id: SUB, is_anonymous: false });
        }) as typeof fetch,
      },
    );
    await expect(verify("not-a-jwt")).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("rejects an expired token before contacting Supabase", async () => {
    let called = false;
    const verify = createSupabaseIdentityVerifier(
      { projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY },
      {
        now: () => NOW,
        fetch: (async () => {
          called = true;
          return jsonResponse({ id: SUB, is_anonymous: false });
        }) as typeof fetch,
      },
    );
    const expired = { ...validClaims(), exp: Math.floor(NOW / 1000) - 10 };
    await expect(verify(makeToken(expired))).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("rejects an anonymous session (is_anonymous !== false)", async () => {
    const verify = createSupabaseIdentityVerifier(
      { projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY },
      { now: () => NOW, fetch: (async () => jsonResponse({ id: SUB, is_anonymous: false })) as typeof fetch },
    );
    const anon = { ...validClaims(), is_anonymous: true };
    await expect(verify(makeToken(anon))).rejects.toThrow();
  });

  it("rejects when Supabase does not confirm the user (non-200)", async () => {
    const verify = createSupabaseIdentityVerifier(
      { projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY },
      { now: () => NOW, fetch: (async () => jsonResponse({ error: "unauthorized" }, 401)) as typeof fetch },
    );
    await expect(verify(makeToken(validClaims()))).rejects.toThrow();
  });

  it("rejects when the confirmed user id does not match the token subject", async () => {
    const verify = createSupabaseIdentityVerifier(
      { projectUrl: PROJECT_URL, publicKey: PUBLIC_KEY },
      {
        now: () => NOW,
        fetch: (async () => jsonResponse({ id: "33333333-3333-4333-8333-333333333333", is_anonymous: false })) as typeof fetch,
      },
    );
    await expect(verify(makeToken(validClaims()))).rejects.toThrow();
  });
});

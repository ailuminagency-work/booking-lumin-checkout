import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ConnectionStatus, IntegrationConnection, TenantId } from "@lumin/contracts";

/**
 * Provider-neutral OAuth CONNECT flow (mock-first).
 *
 * The model here is the SAME whether the real provider is Google or Microsoft:
 * a business user clicks `[ Connect Google ]`, we send them to the provider,
 * the provider redirects back with an authorization `code`, and the SERVER
 * exchanges it for tokens. Tokens live server-side ONLY — they are never part
 * of any browser-facing return (see `redactConnectionForClient`).
 *
 * SECURITY PROPERTIES modeled here:
 *  - Anti-CSRF: the `state` param is an unforgeable, HMAC-signed token. A
 *    callback whose `returnedState` does not match the server-persisted
 *    `stateToken`, or whose signature does not verify, is rejected.
 *  - Anti-cross-tenant-attach: the tenant id is BOUND inside the signed state.
 *    `verifyCallback` rejects unless the bound tenant equals `expectedTenantId`,
 *    so tenant B can never complete a callback against tenant A's pending
 *    connection.
 *  - Single-use / anti-replay: each state carries a random nonce; the nonce is
 *    consumed on first successful callback via an injectable `NonceStore`. A
 *    replayed callback is rejected. A real impl persists nonces in a table
 *    (e.g. `oauth_pending_states`); here we model it with a store + mock.
 *  - Expiry: the state carries an `exp`; an expired callback is rejected.
 *  - PKCE (S256): a `code_verifier` is generated server-side and only its
 *    `code_challenge` leaves in the authorization request.
 */

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

/**
 * OAuth connect lifecycle:
 *   not_connected → authorizing (state + PKCE issued)
 *                 → callback_received (provider redirected back with a code)
 *                 → connected | error | revoked
 */
export type OAuthConnectionState =
  | "not_connected"
  | "authorizing"
  | "callback_received"
  | "connected"
  | "error"
  | "revoked";

const OAUTH_TRANSITIONS: Record<OAuthConnectionState, readonly OAuthConnectionState[]> = {
  not_connected: ["authorizing"],
  authorizing: ["callback_received", "error", "not_connected"],
  callback_received: ["connected", "error"],
  connected: ["revoked", "error", "authorizing"],
  error: ["authorizing", "not_connected"],
  revoked: ["authorizing", "not_connected"],
};

/** True when `to` is a legal next OAuth state after `from`. */
export function canTransitionOAuth(from: OAuthConnectionState, to: OAuthConnectionState): boolean {
  return OAUTH_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export type OAuthErrorCode =
  | "invalid_signature"
  | "state_mismatch"
  | "expired"
  | "tenant_mismatch"
  | "replayed"
  | "malformed_state";

/** Every rejection from `verifyCallback` is a typed `OAuthError`. */
export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  /** SERVER-ONLY secret. Persisted with the pending connection; never sent to the browser. */
  codeVerifier: string;
  /** Sent in the authorization request. */
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

/** Generate a PKCE verifier + S256 challenge. `verifier` overridable for deterministic tests. */
export function generatePkce(verifier?: string): PkcePair {
  const codeVerifier = verifier ?? base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

/** Recompute the S256 challenge for a verifier — used to prove derivation in tests/verification. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}

// ---------------------------------------------------------------------------
// Signed, single-use state token
// ---------------------------------------------------------------------------

interface StatePayload {
  /** Tenant the pending connection belongs to. */
  tid: string;
  /** Provider being connected. */
  provider: string;
  /** Random single-use nonce. */
  nonce: string;
  /** Expiry — epoch milliseconds. */
  exp: number;
}

function signPayload(payloadB64: string, serverKey: string): string {
  return base64url(createHmac("sha256", serverKey).update(payloadB64).digest());
}

/** Encode + HMAC-sign a state payload into an opaque `payload.signature` token. */
function encodeState(payload: StatePayload, serverKey: string): string {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = signPayload(payloadB64, serverKey);
  return `${payloadB64}.${sig}`;
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a state token's signature and decode its payload. Throws `OAuthError`
 * ("malformed_state" | "invalid_signature") — an attacker cannot forge or tamper
 * a token without `serverKey`.
 */
function decodeAndVerifyState(stateToken: string, serverKey: string): StatePayload {
  const dot = stateToken.indexOf(".");
  if (dot <= 0 || dot === stateToken.length - 1) {
    throw new OAuthError("malformed_state", "state token is not in payload.signature form");
  }
  const payloadB64 = stateToken.slice(0, dot);
  const sig = stateToken.slice(dot + 1);
  const expected = signPayload(payloadB64, serverKey);
  if (!safeEqual(sig, expected)) {
    throw new OAuthError("invalid_signature", "state token signature does not verify");
  }
  let parsed: unknown;
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new OAuthError("malformed_state", "state token payload is not valid JSON");
  }
  const p = parsed as Partial<StatePayload>;
  if (
    typeof p.tid !== "string" ||
    typeof p.provider !== "string" ||
    typeof p.nonce !== "string" ||
    typeof p.exp !== "number"
  ) {
    throw new OAuthError("malformed_state", "state token payload is missing required fields");
  }
  return { tid: p.tid, provider: p.provider, nonce: p.nonce, exp: p.exp };
}

// ---------------------------------------------------------------------------
// Nonce store (single-use enforcement)
// ---------------------------------------------------------------------------

/**
 * Persists consumed nonces so a state token can be redeemed AT MOST ONCE.
 * A real impl is a table with the nonce as PK (insert-or-conflict = replay).
 * `consume` MUST be atomic: return true only the FIRST time a nonce is seen.
 */
export interface NonceStore {
  /** Atomically mark `nonce` consumed. Returns true on first consume, false if already consumed. */
  consume(nonce: string): boolean;
  /** Inspection: has this nonce already been consumed? */
  isConsumed(nonce: string): boolean;
}

/** In-memory single-use nonce store. Deterministic; suitable for the mock-first stack. */
export function createMockNonceStore(): NonceStore & { size(): number; clear(): void } {
  const seen = new Set<string>();
  return {
    consume(nonce: string): boolean {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
    isConsumed(nonce: string): boolean {
      return seen.has(nonce);
    },
    size() {
      return seen.size;
    },
    clear() {
      seen.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// beginOAuth
// ---------------------------------------------------------------------------

/** Parameters a real provider authorization URL would take. */
export interface AuthorizationRequest {
  provider: string;
  /** Mock endpoint — a real adapter substitutes Google/Microsoft's authorize URL. */
  authorizationEndpoint: string;
  /** Placeholder client id — real client ids are server config, never hardcoded here. */
  clientId: string;
  redirectUri: string;
  responseType: "code";
  scope: string;
  /** Anti-CSRF token echoed back by the provider as `returnedState`. */
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface BeginOAuthInput {
  tenantId: TenantId;
  provider: string;
  redirectUri: string;
  serverKey: string;
  scopes?: string[];
  /** Override the authorization endpoint (mock default otherwise). */
  authorizationEndpoint?: string;
  /** Override the placeholder client id. */
  clientId?: string;
  /** State lifetime in seconds (default 600 = 10 min). */
  ttlSeconds?: number;
  /** Injectable clock (epoch ms) for deterministic tests. */
  now?: number;
  /** Injectable nonce (deterministic tests only). */
  nonce?: string;
  /** Injectable PKCE verifier (deterministic tests only). */
  codeVerifier?: string;
}

export interface BeginOAuthResult {
  /** What the browser is redirected with. Contains NO secrets (only the challenge). */
  authorizationRequest: AuthorizationRequest;
  /**
   * SERVER-persisted, opaque, single-use, signed token. Store it against the
   * pending connection/session. The provider echoes an identical value as
   * `returnedState`; `verifyCallback` requires the two to match.
   */
  stateToken: string;
  /** SERVER-ONLY PKCE secret — persist alongside `stateToken`, never send to the browser. */
  codeVerifier: string;
  /** Convenience: the connect flow's current state. */
  state: OAuthConnectionState;
}

const DEFAULT_TTL_SECONDS = 600;

/**
 * Begin an OAuth connect. Issues a signed single-use state token (binding
 * tenant + provider + nonce + expiry) and a PKCE pair, and returns the
 * authorization request the browser is redirected with. Moves the connect flow
 * to `authorizing`.
 */
export function beginOAuth(input: BeginOAuthInput): BeginOAuthResult {
  const now = input.now ?? Date.now();
  const ttl = (input.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
  const nonce = input.nonce ?? base64url(randomBytes(16));
  const pkce = generatePkce(input.codeVerifier);

  const payload: StatePayload = {
    tid: input.tenantId,
    provider: input.provider,
    nonce,
    exp: now + ttl,
  };
  const stateToken = encodeState(payload, input.serverKey);

  const scope = (input.scopes ?? ["calendar.readonly", "calendar.events"]).join(" ");

  const authorizationRequest: AuthorizationRequest = {
    provider: input.provider,
    authorizationEndpoint: input.authorizationEndpoint ?? `https://oauth.mock.local/${input.provider}/authorize`,
    clientId: input.clientId ?? `mock-client-${input.provider}`,
    redirectUri: input.redirectUri,
    responseType: "code",
    scope,
    state: stateToken,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: "S256",
  };

  return {
    authorizationRequest,
    stateToken,
    codeVerifier: pkce.codeVerifier,
    state: "authorizing",
  };
}

// ---------------------------------------------------------------------------
// verifyCallback
// ---------------------------------------------------------------------------

export interface VerifyCallbackInput {
  /** The token the SERVER persisted when it began the flow. */
  stateToken: string;
  /** The `state` value the provider redirect actually returned. */
  returnedState: string;
  /** The authorization code from the redirect. */
  code: string;
  /** The tenant the CURRENT request context belongs to. */
  expectedTenantId: TenantId;
  serverKey: string;
  nonceStore: NonceStore;
  /** Injectable clock (epoch ms) for deterministic tests. */
  now?: number;
}

export interface VerifiedCallback {
  tenantId: TenantId;
  provider: string;
  code: string;
  nonce: string;
  /** Connect flow advances to `callback_received`; token exchange yields `connected`. */
  state: OAuthConnectionState;
}

/**
 * Validate an OAuth callback. Rejects (typed `OAuthError`) on ANY of:
 *  - signature does not verify / token malformed → forged state
 *  - returnedState ≠ persisted stateToken       → CSRF
 *  - now ≥ exp                                    → expired
 *  - bound tenant ≠ expectedTenantId              → cross-tenant callback attach
 *  - nonce already consumed                       → replay
 * A single correct callback succeeds exactly once (the nonce is then consumed).
 *
 * Order matters: cryptographic validity and CSRF match are checked BEFORE the
 * nonce is consumed, so a forged/mismatched attempt never burns a real nonce.
 */
export function verifyCallback(input: VerifyCallbackInput): VerifiedCallback {
  const now = input.now ?? Date.now();

  // 1. Signature + structure (unforgeable without serverKey).
  const payload = decodeAndVerifyState(input.stateToken, input.serverKey);

  // 2. Anti-CSRF: the value the provider returned must equal the persisted token.
  if (!safeEqual(input.returnedState, input.stateToken)) {
    throw new OAuthError("state_mismatch", "returned state does not match the persisted state token");
  }

  // 3. Expiry.
  if (now >= payload.exp) {
    throw new OAuthError("expired", "state token has expired");
  }

  // 4. Anti-cross-tenant-attach: bound tenant must equal the request's tenant.
  if (!safeEqual(payload.tid, input.expectedTenantId)) {
    throw new OAuthError(
      "tenant_mismatch",
      "state token belongs to a different tenant than the callback context",
    );
  }

  // 5. Single-use: consume the nonce LAST, atomically. Replay ⇒ already consumed.
  if (!input.nonceStore.consume(payload.nonce)) {
    throw new OAuthError("replayed", "state token nonce has already been consumed");
  }

  return {
    tenantId: payload.tid,
    provider: payload.provider,
    code: input.code,
    nonce: payload.nonce,
    state: "callback_received",
  };
}

// ---------------------------------------------------------------------------
// Tokens — SERVER-ONLY
// ---------------------------------------------------------------------------

/**
 * OAuth tokens. This shape NEVER crosses a browser-facing boundary. It is
 * exchanged from a code on the server and handed straight to a `TokenVault`.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Access-token expiry — epoch ms. */
  expiresAt: number;
  scope: string;
}

/**
 * Server-side token storage port. A real impl writes ciphertext to
 * `calendar_connection_secrets` (service_role only). The vault is the ONLY
 * place tokens live — nothing above it returns a `TokenSet` to a client.
 */
export interface TokenVault {
  save(connectionId: string, tokens: TokenSet): Promise<void>;
  load(connectionId: string): Promise<TokenSet | undefined>;
  delete(connectionId: string): Promise<void>;
  has(connectionId: string): Promise<boolean>;
}

/** In-memory token vault. Deterministic; mirrors the service_role-only secrets table. */
export function createMockTokenVault(): TokenVault & { size(): number; clear(): void } {
  const store = new Map<string, TokenSet>();
  return {
    async save(connectionId, tokens) {
      store.set(connectionId, { ...tokens });
    },
    async load(connectionId) {
      const t = store.get(connectionId);
      return t ? { ...t } : undefined;
    },
    async delete(connectionId) {
      store.delete(connectionId);
    },
    async has(connectionId) {
      return store.has(connectionId);
    },
    size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Client-facing redaction
// ---------------------------------------------------------------------------

/**
 * The ONLY connection shape a business user's browser may receive. It is built
 * from an allowlist of non-secret fields — there is no token-bearing field to
 * leak, by construction.
 */
export interface ClientSafeConnection {
  id: string;
  tenantId: string;
  kind: IntegrationConnection["kind"];
  provider: string;
  status: ConnectionStatus;
  /** Coarse health signal derived from status/last check. */
  health: "healthy" | "degraded" | "disconnected";
  lastCheckAt: string | null;
  lastError: string | null;
}

/**
 * A server-held connection MAY carry token material (or a vault handle). This
 * is what stays server-side.
 */
export interface ServerConnection extends IntegrationConnection {
  /** Present only server-side — stripped by `redactConnectionForClient`. */
  tokens?: TokenSet;
}

function healthFromStatus(status: ConnectionStatus): ClientSafeConnection["health"] {
  switch (status) {
    case "connected":
      return "healthy";
    case "error":
      return "degraded";
    default:
      return "disconnected";
  }
}

/**
 * Strip ALL token material from a connection, returning only what a business
 * user may see (status / health / provider / last check). Uses an explicit
 * allowlist so no token field can survive — a test asserts the output contains
 * no `accessToken` / `refreshToken` / `tokens` anywhere.
 */
export function redactConnectionForClient(connection: ServerConnection): ClientSafeConnection {
  return {
    id: connection.id,
    tenantId: connection.tenantId,
    kind: connection.kind,
    provider: connection.provider,
    status: connection.status,
    health: healthFromStatus(connection.status),
    lastCheckAt: connection.lastCheckAt,
    lastError: connection.lastError,
  };
}

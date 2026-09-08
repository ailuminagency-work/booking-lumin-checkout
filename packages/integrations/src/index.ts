/**
 * @lumin/integrations — provider-neutral OAuth CONNECT flow + richer calendar
 * adapters for Booking Lumin Checkout. Mock-first (SI-12): every connection
 * begins NOT CONNECTED and the whole layer runs with zero real credentials.
 *
 * The preferred connect UX is a `[ Connect Google ]` / `[ Connect Microsoft ]`
 * button that runs OAuth — NOT pasting API tokens into a form. Tokens are
 * SERVER-ONLY: they are exchanged on the server, stored in a `TokenVault`
 * (backed by the service_role-only `calendar_connection_secrets` table), and
 * never appear in any browser-facing return. `redactConnectionForClient` is the
 * only connection shape a business user's browser receives.
 *
 * OAuth state is HMAC-signed and binds tenant + provider + nonce + expiry, so a
 * callback cannot be forged, replayed, or attached across tenants. Real Google
 * / Microsoft adapters and real OAuth are a later, gated activation
 * (READY — NOT CONNECTED); this package is additive and touches no core,
 * adapter, contract, or app code.
 */

export {
  // state machine
  canTransitionOAuth,
  // errors
  OAuthError,
  // PKCE
  generatePkce,
  deriveCodeChallenge,
  // nonce store
  createMockNonceStore,
  // flow
  beginOAuth,
  verifyCallback,
  // tokens (server-only)
  createMockTokenVault,
  // redaction
  redactConnectionForClient,
} from "./oauth";
export type {
  OAuthConnectionState,
  OAuthErrorCode,
  PkcePair,
  NonceStore,
  AuthorizationRequest,
  BeginOAuthInput,
  BeginOAuthResult,
  VerifyCallbackInput,
  VerifiedCallback,
  TokenSet,
  TokenVault,
  ClientSafeConnection,
  ServerConnection,
} from "./oauth";

export {
  mergeBusy,
  createMockGoogleCalendarAdapter,
  createMockMicrosoftCalendarAdapter,
} from "./calendar";
export type {
  BusyWindow,
  TimeRange,
  CalendarCapabilities,
  SyncResult,
  RichCalendarAdapter,
  MockCalendarAdapter,
} from "./calendar";

export {
  mockHealth,
  checkHealth,
  canTransitionStatus,
  connectConnection,
  disconnectConnection,
  reconnectConnection,
  revokeConnection,
  markConnectionError,
  newCalendarConnection,
} from "./connection";
export type { ConnectionHealth } from "./connection";

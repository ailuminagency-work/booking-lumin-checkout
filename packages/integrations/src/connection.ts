import type { ConnectionStatus, IntegrationConnection, TenantId } from "@lumin/contracts";

/**
 * Connection lifecycle + health, mapped onto the contracts' `IntegrationConnection`
 * / `ConnectionStatus`. Every connection begins `not_connected` (SI-12) and only
 * reaches `connected` after a successful OAuth callback + token exchange. These
 * transitions are pure functions over the contract shape — no I/O, no secrets.
 */

/** Coarse health of a connection's last sync/delivery attempt. */
export interface ConnectionHealth {
  provider: string;
  status: ConnectionStatus;
  healthy: boolean;
  checkedAt: string; // UTC ISO
  lastError: string | null;
}

/** Build a deterministic health snapshot for a provider + status. */
export function mockHealth(
  provider: string,
  status: ConnectionStatus,
  opts: { checkedAt?: string; lastError?: string | null } = {},
): ConnectionHealth {
  return {
    provider,
    status,
    healthy: status === "connected",
    checkedAt: opts.checkedAt ?? "1970-01-01T00:00:00.000Z",
    lastError: opts.lastError ?? (status === "error" ? "unknown error" : null),
  };
}

/**
 * A source of health for a connection. A real impl pings the provider; the mock
 * derives it from the connection's current status, or a forced override.
 */
export function checkHealth(
  connection: Pick<IntegrationConnection, "provider" | "status" | "lastError">,
  override?: Partial<Pick<ConnectionHealth, "status" | "healthy" | "lastError" | "checkedAt">>,
): ConnectionHealth {
  const status = override?.status ?? connection.status;
  return {
    provider: connection.provider,
    status,
    healthy: override?.healthy ?? status === "connected",
    checkedAt: override?.checkedAt ?? "1970-01-01T00:00:00.000Z",
    lastError: override?.lastError ?? connection.lastError ?? (status === "error" ? "unknown error" : null),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle transitions (pure)
// ---------------------------------------------------------------------------

const STATUS_TRANSITIONS: Record<ConnectionStatus, readonly ConnectionStatus[]> = {
  not_connected: ["connected", "error"],
  connected: ["revoked", "error", "not_connected"],
  error: ["connected", "not_connected", "revoked"],
  revoked: ["connected", "not_connected"],
};

/** True when `to` is a legal next `ConnectionStatus` after `from`. */
export function canTransitionStatus(from: ConnectionStatus, to: ConnectionStatus): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from].includes(to);
}

function withStatus(
  connection: IntegrationConnection,
  status: ConnectionStatus,
  patch: Partial<Pick<IntegrationConnection, "lastCheckAt" | "lastError">> = {},
): IntegrationConnection {
  return {
    ...connection,
    status,
    lastCheckAt: patch.lastCheckAt ?? connection.lastCheckAt,
    lastError: "lastError" in patch ? (patch.lastError ?? null) : connection.lastError,
  };
}

/** not_connected/error/revoked → connected (after a successful OAuth exchange). */
export function connectConnection(connection: IntegrationConnection, checkedAt: string): IntegrationConnection {
  return withStatus(connection, "connected", { lastCheckAt: checkedAt, lastError: null });
}

/** connected → not_connected (owner disconnected; tokens should be deleted from the vault). */
export function disconnectConnection(connection: IntegrationConnection): IntegrationConnection {
  return withStatus(connection, "not_connected", { lastError: null });
}

/** error/revoked/not_connected → connected via a fresh OAuth flow. */
export function reconnectConnection(connection: IntegrationConnection, checkedAt: string): IntegrationConnection {
  return withStatus(connection, "connected", { lastCheckAt: checkedAt, lastError: null });
}

/** any → revoked (provider or owner revoked access; tokens are now invalid). */
export function revokeConnection(connection: IntegrationConnection): IntegrationConnection {
  return withStatus(connection, "revoked");
}

/** any → error (a sync/delivery failed). Records the message for the client-safe view. */
export function markConnectionError(
  connection: IntegrationConnection,
  error: string,
  checkedAt: string,
): IntegrationConnection {
  return withStatus(connection, "error", { lastCheckAt: checkedAt, lastError: error });
}

/** Build a fresh NOT-CONNECTED calendar connection row for a tenant/provider. */
export function newCalendarConnection(
  id: string,
  tenantId: TenantId,
  provider: string,
): IntegrationConnection {
  return {
    id,
    tenantId,
    kind: "calendar",
    provider,
    status: "not_connected",
    lastCheckAt: null,
    lastError: null,
  };
}

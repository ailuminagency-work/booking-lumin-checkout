import { z } from "zod";

/**
 * TenantContextContract v1
 *
 * Every domain record belongs to exactly one tenant. Every read or write in
 * the platform executes inside a TenantContext, and the database enforces
 * isolation with RLS — application code is a convenience layer, never the
 * security boundary.
 *
 * Platform roles and tenant roles are DISTINCT trust levels:
 *  - PlatformRole governs the Lumin Command Center (aggregate, cross-tenant).
 *  - TenantRole governs one business's portal and data.
 * A PLATFORM_ADMIN does not implicitly hold any TenantRole.
 */

export const TenantId = z.string().uuid();
export type TenantId = z.infer<typeof TenantId>;

export const PlatformRole = z.enum(["PLATFORM_ADMIN"]);
export type PlatformRole = z.infer<typeof PlatformRole>;

export const TenantRole = z.enum(["BUSINESS_OWNER", "BUSINESS_STAFF"]);
export type TenantRole = z.infer<typeof TenantRole>;

export const TenantContext = z.object({
  tenantId: TenantId,
  role: TenantRole,
  userId: z.string().uuid(),
});
export type TenantContext = z.infer<typeof TenantContext>;

/** Anonymous customer context for the public checkout: tenant-scoped, no user. */
export const CheckoutContext = z.object({
  tenantId: TenantId,
  /** Opaque per-session key used for idempotency and draft ownership. */
  sessionKey: z.string().min(16),
});
export type CheckoutContext = z.infer<typeof CheckoutContext>;

export const Tenant = z.object({
  id: TenantId,
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  /** IANA timezone, e.g. "America/Chicago". Always explicit. */
  timezone: z.string().min(1),
  /** Default currency for new services; each service stores its own. */
  currency: z.string().length(3),
  status: z.enum(["active", "inactive", "suspended"]),
  createdAt: z.string().datetime(),
});
export type Tenant = z.infer<typeof Tenant>;

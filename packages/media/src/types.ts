import { z } from "zod";
import { TenantId } from "@lumin/contracts";

/**
 * MediaModelContract (package-local) — a GENERIC media model.
 *
 * Nothing here knows about cars, tents, rooms, equipment or any other vertical.
 * A media asset is owned by a TENANT and *attached* to some owner by
 * `ownerType` + `ownerId`. The engine models media by role and owner shape, not
 * by domain: the exact same MediaAsset / MediaVariant / MediaAttachment records
 * describe a detailing-package photo, a rental-tent gallery, a room hero shot or
 * a service example — the model never learns which.
 *
 * All dimensions are INTEGER pixels. All monetary concerns live in
 * `@lumin/contracts` Money; media carries none.
 */

/** What kind of thing the asset is. Responsive raster variants apply to images. */
export const MediaKind = z.enum(["image", "video", "document"]);
export type MediaKind = z.infer<typeof MediaKind>;

/** Responsive slot a variant is produced for (mobile-first breakpoints). */
export const MediaPurpose = z.enum(["thumbnail", "card", "gallery", "hero", "mobile"]);
export type MediaPurpose = z.infer<typeof MediaPurpose>;

/** Encoding of a produced variant. `webp` is the modern default. */
export const MediaFormat = z.enum(["webp", "jpeg", "avif"]);
export type MediaFormat = z.infer<typeof MediaFormat>;

/** How an asset is used against its owner. */
export const MediaRole = z.enum(["cover", "gallery"]);
export type MediaRole = z.infer<typeof MediaRole>;

/**
 * Any record can own media without media coupling to its domain. `service` and
 * `resource` cover the two shapes the platform already has (a Service config and
 * a bookable resource); `checkout` lets a checkout draft carry customer uploads;
 * `other` is the escape hatch so a new vertical never needs a new ownerType.
 */
export const MediaOwnerType = z.enum(["service", "resource", "checkout", "other"]);
export type MediaOwnerType = z.infer<typeof MediaOwnerType>;

const PixelDimension = z.number().int().positive();
const ByteCount = z.number().int().nonnegative();

/**
 * A tenant-owned source asset. `storageKey` is the canonical, tenant-scoped
 * pointer into a MediaStorageProvider; `originalUrl` is an optional already-public
 * URL. `width`/`height` are the intrinsic pixel dimensions of the original and
 * are what `planVariants` scales down from (never up).
 */
export const MediaAsset = z.object({
  id: z.string().min(1),
  tenantId: TenantId,
  kind: MediaKind,
  /** Canonical tenant-scoped storage pointer (embeds tenantId at the real layer). */
  storageKey: z.string().min(1),
  /** Optional already-public URL for the original (CDN, signed, etc.). */
  originalUrl: z.string().url().optional(),
  /** Intrinsic original width in pixels (images/videos). */
  width: PixelDimension.optional(),
  /** Intrinsic original height in pixels (images/videos). */
  height: PixelDimension.optional(),
  /** Original size in bytes. */
  bytes: ByteCount.optional(),
  mimeType: z.string().min(1),
  /** Accessibility text; generic across verticals. */
  altText: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type MediaAsset = z.infer<typeof MediaAsset>;

/**
 * A responsive derivative of a MediaAsset. Produced by `planVariants` as a SPEC
 * (a storage/transform layer executes it — this package does no pixel work).
 * Dimensions are integers and never exceed the source (no upscaling).
 */
export const MediaVariant = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  tenantId: TenantId,
  purpose: MediaPurpose,
  width: PixelDimension,
  height: PixelDimension,
  /** Tenant-scoped storage pointer for the derivative. */
  storageKey: z.string().min(1),
  format: MediaFormat,
});
export type MediaVariant = z.infer<typeof MediaVariant>;

/**
 * Attaches an asset to ANY owner. This is the join that keeps media generic:
 * the owner is addressed by (ownerType, ownerId), never by a domain field, so
 * one attachment schema serves every service/resource/checkout type equally.
 */
export const MediaAttachment = z.object({
  id: z.string().min(1),
  tenantId: TenantId,
  assetId: z.string().min(1),
  ownerType: MediaOwnerType,
  ownerId: z.string().min(1),
  role: MediaRole,
  /** Display order within the owner's gallery; lower sorts first. */
  sortOrder: z.number().int().nonnegative(),
});
export type MediaAttachment = z.infer<typeof MediaAttachment>;

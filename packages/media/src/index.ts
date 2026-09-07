/**
 * @lumin/media — a GENERIC media model + mock storage for Booking Lumin Checkout.
 *
 * The generalization test, applied to media: cars, equipment, tents, rooms and
 * service examples are all just data over ONE model. A `MediaAsset` is tenant-
 * owned; a `MediaAttachment` binds it to any owner by (ownerType, ownerId); a
 * `MediaVariant` is a responsive derivative. No car/vehicle/tent field exists
 * anywhere — the engine models media by ROLE and OWNER SHAPE, never by vertical.
 *
 * The package is model + plan + mock only: `planVariants` computes the responsive
 * SPEC (no pixels are touched — no sharp/canvas), and `createMockMediaStorageProvider`
 * makes the whole pipeline runnable with zero credentials. Real CDN/S3/Supabase
 * adapters are future implementations of the same `MediaStorageProvider` port.
 *
 * Additive only: depends solely on `@lumin/contracts`; touches no core, adapter,
 * contract, or app code.
 */

export {
  MediaKind,
  MediaPurpose,
  MediaFormat,
  MediaRole,
  MediaOwnerType,
  MediaAsset,
  MediaVariant,
  MediaAttachment,
} from "./types";

export {
  DEFAULT_BREAKPOINTS,
  MOBILE_OPTIMIZATION_NOTE,
  planVariants,
  clampWidth,
  scaledHeight,
} from "./variants";
export type { PlanVariantsOptions } from "./variants";

export {
  tenantKeyPrefix,
  isTenantKey,
  assertTenantKey,
  assetStorageKey,
  variantStorageKey,
  createMockMediaStorageProvider,
} from "./storage";
export type {
  MediaStorageProvider,
  MockMediaStorageProvider,
  MockMediaStorageOptions,
  StoredMediaObject,
  PutMediaOptions,
  SignedUpload,
} from "./storage";

export { orderGallery, coverImage, buildServiceMediaView } from "./gallery";
export type { ResolvedMedia, ServiceMediaView } from "./gallery";

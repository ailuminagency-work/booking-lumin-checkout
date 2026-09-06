import { MediaAsset, MediaFormat, MediaPurpose, MediaVariant } from "./types";
import { variantStorageKey } from "./storage";

/**
 * planVariants — a PURE, deterministic responsive-variant planner.
 *
 * Given an image asset's intrinsic dimensions and a responsive policy, it
 * returns the MediaVariant[] SPEC a storage/transform layer would then execute.
 * It performs NO image processing (no sharp, no canvas) — it only computes the
 * integer target geometry and the storage keys.
 *
 * Rules, in order:
 *  1. Preserve aspect ratio — every variant has the source's width:height ratio.
 *  2. Never upscale — a target wider than the original is CLAMPED to the
 *     original width (the hero slot of a small photo is just the native image).
 *  3. Integer pixels — heights are rounded to whole pixels.
 *  4. Modern format by default — `webp`; override per policy.
 *
 * Mobile optimization: `mobile` (640px) is a first-class breakpoint distinct
 * from `hero` (1920px) precisely so a phone is never shipped a desktop-sized
 * asset. Variants are returned ascending by target width (mobile-first), so a
 * consumer building `srcset`/`sizes` picks the smallest sufficient source.
 */

/** Default responsive breakpoints (target CSS pixel widths) per purpose. */
export const DEFAULT_BREAKPOINTS: Readonly<Record<MediaPurpose, number>> = Object.freeze({
  thumbnail: 160,
  card: 480,
  mobile: 640,
  gallery: 1024,
  hero: 1920,
});

/**
 * Human-readable rationale carried alongside the plan: don't ship desktop
 * assets to phones. Kept as data so UIs/tooling can surface it verbatim.
 */
export const MOBILE_OPTIMIZATION_NOTE =
  "Serve the smallest variant that fills the layout slot; phones should receive the " +
  "'mobile' (640px) or smaller source, never the desktop 'hero' (1920px) asset.";

export interface PlanVariantsOptions {
  /** Override any subset of the default breakpoints (target widths, px). */
  breakpoints?: Partial<Record<MediaPurpose, number>>;
  /** Encoding for every produced variant. Defaults to `webp`. */
  format?: MediaFormat;
  /**
   * Which purposes to plan, in the order to consider them. Defaults to all five.
   * Output is always re-sorted ascending by final width regardless of this order.
   */
  purposes?: MediaPurpose[];
}

const ALL_PURPOSES: MediaPurpose[] = ["thumbnail", "card", "mobile", "gallery", "hero"];

/** Clamp a target width to the original — rule 2, never upscale. */
export function clampWidth(targetWidth: number, originalWidth: number): number {
  return Math.min(targetWidth, originalWidth);
}

/** Height that preserves the source aspect ratio for a given width — rule 1 + 3. */
export function scaledHeight(width: number, originalWidth: number, originalHeight: number): number {
  return Math.round((width * originalHeight) / originalWidth);
}

/**
 * Produce the responsive variant spec for an asset. Returns `[]` for non-image
 * kinds (no raster breakpoints apply). Throws if an image is missing intrinsic
 * width/height — the planner needs real dimensions to preserve ratio and clamp.
 */
export function planVariants(asset: MediaAsset, opts: PlanVariantsOptions = {}): MediaVariant[] {
  if (asset.kind !== "image") return [];

  const { width: ow, height: oh } = asset;
  if (ow === undefined || oh === undefined) {
    throw new Error(`planVariants: image asset "${asset.id}" is missing intrinsic width/height`);
  }

  const format: MediaFormat = opts.format ?? "webp";
  const breakpoints = { ...DEFAULT_BREAKPOINTS, ...(opts.breakpoints ?? {}) };
  const purposes = opts.purposes ?? ALL_PURPOSES;

  const variants: MediaVariant[] = purposes.map((purpose) => {
    const target = breakpoints[purpose];
    const width = clampWidth(target, ow);
    const height = scaledHeight(width, ow, oh);
    return {
      id: `${asset.id}:${purpose}`,
      assetId: asset.id,
      tenantId: asset.tenantId,
      purpose,
      width,
      height,
      storageKey: variantStorageKey(asset.tenantId, asset.id, purpose, width, height, format),
      format,
    };
  });

  // Mobile-first ordering: smallest sufficient source first. Stable tie-break by
  // the default breakpoint so clamped duplicates keep a deterministic order.
  return variants.sort(
    (a, b) => a.width - b.width || DEFAULT_BREAKPOINTS[a.purpose] - DEFAULT_BREAKPOINTS[b.purpose],
  );
}

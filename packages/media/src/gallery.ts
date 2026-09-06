import { MediaAsset, MediaAttachment, MediaVariant } from "./types";

/**
 * Gallery assembly — generic across owner types.
 *
 * These helpers turn raw (attachment, asset, variant) rows into the view a
 * checkout card renders, without ever knowing what the owner *is*. A tent, a
 * detailing package, a room and a rental all assemble identically: the owner is
 * addressed by (ownerType, ownerId) upstream; here we only order and resolve.
 */

/** An asset paired with its planned responsive variants. */
export interface ResolvedMedia {
  asset: MediaAsset;
  variants: MediaVariant[];
}

/**
 * The media a checkout card needs for one owner: a single cover plus an ordered
 * gallery, each already resolved to asset + variants. Vertical-agnostic.
 */
export interface ServiceMediaView {
  cover: ResolvedMedia | null;
  gallery: ResolvedMedia[];
}

/**
 * Order attachments for display: ascending `sortOrder`, then `id` as a stable
 * tie-break so equal orders never render nondeterministically. Returns a new
 * array; the input is not mutated.
 */
export function orderGallery(attachments: readonly MediaAttachment[]): MediaAttachment[] {
  return [...attachments].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function assetIndex(assets: readonly MediaAsset[]): Map<string, MediaAsset> {
  return new Map(assets.map((a) => [a.id, a]));
}

function variantIndex(variants: readonly MediaVariant[]): Map<string, MediaVariant[]> {
  const byAsset = new Map<string, MediaVariant[]>();
  for (const v of variants) {
    const list = byAsset.get(v.assetId);
    if (list) list.push(v);
    else byAsset.set(v.assetId, [v]);
  }
  return byAsset;
}

/**
 * Pick the cover asset for an owner. Prefers the earliest `cover`-role
 * attachment; when none is marked cover, falls back to the first ordered
 * `gallery` item so a card always has something to show. Returns `undefined`
 * when nothing resolves (no attachments, or the asset is missing).
 */
export function coverImage(
  attachments: readonly MediaAttachment[],
  assets: readonly MediaAsset[],
): MediaAsset | undefined {
  const ordered = orderGallery(attachments);
  const byId = assetIndex(assets);
  const cover = ordered.find((a) => a.role === "cover") ?? ordered.find((a) => a.role === "gallery");
  if (!cover) return undefined;
  return byId.get(cover.assetId);
}

/**
 * Assemble a full ServiceMediaView for one owner. `cover` is resolved via
 * {@link coverImage}; `gallery` is every `gallery`-role attachment in display
 * order. Each entry carries the asset's variants (empty array when none planned).
 * Attachments whose asset is absent from `assets` are skipped rather than throwing.
 */
export function buildServiceMediaView(
  attachments: readonly MediaAttachment[],
  assets: readonly MediaAsset[],
  variants: readonly MediaVariant[] = [],
): ServiceMediaView {
  const ordered = orderGallery(attachments);
  const byId = assetIndex(assets);
  const byAsset = variantIndex(variants);

  const resolve = (assetId: string): ResolvedMedia | null => {
    const asset = byId.get(assetId);
    if (!asset) return null;
    return { asset, variants: byAsset.get(assetId) ?? [] };
  };

  const coverAsset = coverImage(attachments, assets);
  const cover = coverAsset ? resolve(coverAsset.id) : null;

  const gallery: ResolvedMedia[] = [];
  for (const attachment of ordered) {
    if (attachment.role !== "gallery") continue;
    const resolved = resolve(attachment.assetId);
    if (resolved) gallery.push(resolved);
  }

  return { cover, gallery };
}

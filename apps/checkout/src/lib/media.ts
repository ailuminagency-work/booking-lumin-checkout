/**
 * Checkout integration seam onto @lumin/media (mock storage only — no network).
 *
 * When a service asks for a customer photo, we run the full media pipeline
 * against the in-memory mock provider: bytes → tenant-scoped storage key → a
 * `MediaAsset` + a `MediaAttachment` that binds it to the checkout draft by
 * (ownerType "checkout", ownerId). Real CDN/S3/Supabase adapters are future
 * implementations of the same port; nothing here changes when one is wired.
 */
import {
  assetStorageKey,
  createMockMediaStorageProvider,
  MediaAsset,
  MediaAttachment,
} from "@lumin/media";

/** Session-scoped mock storage. Deterministic, credential-free. */
export const mediaStorage = createMockMediaStorageProvider();

export interface UploadedMedia {
  asset: MediaAsset;
  attachment: MediaAttachment;
  /** Deterministic public URL for the stored original (mock host). */
  publicUrl: string;
}

let seq = 0;

export interface MockUploadInput {
  tenantId: string;
  /** The checkout draft this photo attaches to (e.g. the idempotency key). */
  ownerId: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
  altText?: string;
}

/**
 * Store bytes in the mock provider and return the asset + attachment records.
 * Purely mock: the bytes never leave memory. The returned records are validated
 * against the @lumin/media schemas so a malformed upload fails loudly here.
 */
export async function mockUploadPhoto(input: MockUploadInput): Promise<UploadedMedia> {
  const assetId = `asset-${input.ownerId}-${seq++}`;
  const ext = input.mimeType === "image/png" ? "png" : "jpg";
  const key = assetStorageKey(input.tenantId, assetId, ext);

  await mediaStorage.put(input.tenantId, key, input.bytes, { contentType: input.mimeType });

  const asset = MediaAsset.parse({
    id: assetId,
    tenantId: input.tenantId,
    kind: "image",
    storageKey: key,
    mimeType: input.mimeType,
    bytes: input.bytes.byteLength,
    ...(input.altText ? { altText: input.altText } : {}),
    createdAt: new Date().toISOString(),
  });

  const attachment = MediaAttachment.parse({
    id: `att-${assetId}`,
    tenantId: input.tenantId,
    assetId,
    ownerType: "checkout",
    ownerId: input.ownerId,
    role: "gallery",
    sortOrder: 0,
  });

  return { asset, attachment, publicUrl: mediaStorage.getPublicUrl(input.tenantId, key) };
}

/** Deterministic placeholder bytes so the mock upload needs no real file input. */
export function placeholderImageBytes(label: string): Uint8Array {
  return new TextEncoder().encode(`mock-image:${label}:${Date.now()}`);
}

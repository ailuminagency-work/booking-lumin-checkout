/**
 * Mock media library for the portal (via @lumin/media). Seeds a few tenant-owned
 * image assets into the in-memory mock storage and precomputes their responsive
 * variant SPEC with `planVariants` (no pixels are touched). Provider-neutral —
 * a real CDN/S3 adapter is a future implementation of the same port.
 */
import { assetStorageKey, createMockMediaStorageProvider, MediaAsset, planVariants } from "@lumin/media";
import { DEMO_TENANT_ID } from "./mockTenant";

export const portalMediaStorage = createMockMediaStorageProvider();

interface Seed {
  id: string;
  label: string;
  width: number;
  height: number;
}

const SEEDS: Seed[] = [
  { id: "asset-hero-1", label: "Storefront hero", width: 1600, height: 900 },
  { id: "asset-crew-1", label: "Crew on site", width: 1200, height: 800 },
  { id: "asset-before-1", label: "Before photo", width: 1024, height: 768 },
  { id: "asset-after-1", label: "After photo", width: 800, height: 600 },
];

export interface LibraryEntry {
  asset: MediaAsset;
  label: string;
  publicUrl: string;
  variantCount: number;
}

export const portalMediaLibrary: LibraryEntry[] = SEEDS.map((s) => {
  const storageKey = assetStorageKey(DEMO_TENANT_ID, s.id, "webp");
  // The mock provider stores synchronously; the promise is a formality here.
  void portalMediaStorage.put(DEMO_TENANT_ID, storageKey, `mock:${s.id}`, {
    contentType: "image/webp",
  });
  const asset = MediaAsset.parse({
    id: s.id,
    tenantId: DEMO_TENANT_ID,
    kind: "image",
    storageKey,
    width: s.width,
    height: s.height,
    mimeType: "image/webp",
    altText: s.label,
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  return {
    asset,
    label: s.label,
    publicUrl: portalMediaStorage.getPublicUrl(DEMO_TENANT_ID, storageKey),
    variantCount: planVariants(asset).length,
  };
});

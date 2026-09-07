import { MediaAsset, MediaAttachment } from "../src/types";

/** Deterministic valid UUIDs for fixtures (mirrors the core/templates helper). */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Neutral demo tenants — never a real business name (contamination invariant). */
export const TENANT_A = uuid(9001);
export const TENANT_B = uuid(9002);

/** A large landscape original (4:3). */
export function asset4000x3000(tenantId = TENANT_A): MediaAsset {
  return {
    id: "asset-4k",
    tenantId,
    kind: "image",
    storageKey: `t/${tenantId}/assets/asset-4k/original.jpg`,
    width: 4000,
    height: 3000,
    bytes: 2_400_000,
    mimeType: "image/jpeg",
    altText: "A neutral example photo",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A small landscape original (4:3) — used to prove clamping/no-upscaling. */
export function asset800x600(tenantId = TENANT_A): MediaAsset {
  return {
    id: "asset-sm",
    tenantId,
    kind: "image",
    storageKey: `t/${tenantId}/assets/asset-sm/original.jpg`,
    width: 800,
    height: 600,
    bytes: 90_000,
    mimeType: "image/jpeg",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Build a bare asset record (generic; owner-agnostic). */
export function makeAsset(id: string, tenantId = TENANT_A): MediaAsset {
  return {
    id,
    tenantId,
    kind: "image",
    storageKey: `t/${tenantId}/assets/${id}/original.jpg`,
    width: 1600,
    height: 1200,
    mimeType: "image/jpeg",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Build an attachment binding an asset to any owner. */
export function makeAttachment(
  id: string,
  assetId: string,
  role: MediaAttachment["role"],
  sortOrder: number,
  ownerType: MediaAttachment["ownerType"] = "service",
  ownerId = "owner-1",
  tenantId = TENANT_A,
): MediaAttachment {
  return { id, tenantId, assetId, ownerType, ownerId, role, sortOrder };
}

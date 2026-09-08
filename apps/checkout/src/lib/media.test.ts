import { describe, expect, it } from "vitest";
import { TENANT_ID } from "../config/demoTenant";
import { mediaStorage, mockUploadPhoto, placeholderImageBytes } from "./media";

/** media wiring: a mock upload stores tenant-scoped bytes and returns an
 *  asset + attachment bound to the checkout draft. No network. */
describe("checkout mock media upload", () => {
  it("stores bytes and attaches the asset to the checkout draft", async () => {
    const ownerId = "ck-media-owner-key-1234567890";
    const before = mediaStorage.keysForTenant(TENANT_ID).length;

    const uploaded = await mockUploadPhoto({
      tenantId: TENANT_ID,
      ownerId,
      fileName: "site.png",
      bytes: placeholderImageBytes("unit"),
      mimeType: "image/png",
      altText: "Site photo",
    });

    expect(mediaStorage.has(TENANT_ID, uploaded.asset.storageKey)).toBe(true);
    expect(mediaStorage.keysForTenant(TENANT_ID).length).toBe(before + 1);

    expect(uploaded.asset.kind).toBe("image");
    expect(uploaded.attachment.ownerType).toBe("checkout");
    expect(uploaded.attachment.ownerId).toBe(ownerId);
    expect(uploaded.attachment.assetId).toBe(uploaded.asset.id);
    expect(uploaded.publicUrl).toContain(uploaded.asset.storageKey);
  });
});

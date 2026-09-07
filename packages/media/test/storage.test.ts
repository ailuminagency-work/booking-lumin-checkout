import { describe, expect, it } from "vitest";
import {
  assetStorageKey,
  createMockMediaStorageProvider,
  isTenantKey,
  tenantKeyPrefix,
  variantStorageKey,
} from "../src/storage";
import { TENANT_A, TENANT_B } from "./fixtures";

const decoder = new TextDecoder();

describe("mock media storage: put / get / delete", () => {
  it("stores and reads back bytes at a tenant-scoped key", async () => {
    const store = createMockMediaStorageProvider();
    const key = assetStorageKey(TENANT_A, "a1", "jpg");
    expect(key).toBe(`t/${TENANT_A}/assets/a1/original.jpg`);

    const { key: written } = await store.put(TENANT_A, key, "hello-bytes", { contentType: "image/jpeg" });
    expect(written).toBe(key);

    const got = await store.get(TENANT_A, key);
    expect(got).toBeDefined();
    expect(decoder.decode(got!.body)).toBe("hello-bytes");
    expect(got!.contentType).toBe("image/jpeg");
    expect(got!.bytes).toBe(11);
    expect(store.size()).toBe(1);
    expect(store.has(TENANT_A, key)).toBe(true);
  });

  it("delete removes the object and is idempotent", async () => {
    const store = createMockMediaStorageProvider();
    const key = assetStorageKey(TENANT_A, "a2", "webp");
    await store.put(TENANT_A, key, "x");
    expect(store.size()).toBe(1);
    await store.delete(TENANT_A, key);
    expect(store.size()).toBe(0);
    expect(await store.get(TENANT_A, key)).toBeUndefined();
    // Second delete is a no-op, not an error.
    await expect(store.delete(TENANT_A, key)).resolves.toBeUndefined();
  });

  it("get returns undefined for an absent key", async () => {
    const store = createMockMediaStorageProvider();
    expect(await store.get(TENANT_A, `${tenantKeyPrefix(TENANT_A)}nope`)).toBeUndefined();
  });
});

describe("mock media storage: tenant-key isolation", () => {
  it("a key written for tenant A is unreachable through tenant B", async () => {
    const store = createMockMediaStorageProvider();
    const keyA = assetStorageKey(TENANT_A, "secret", "jpg");
    await store.put(TENANT_A, keyA, "tenant-A-bytes");

    // The key is not under B's prefix, so every B-scoped op rejects it.
    expect(isTenantKey(TENANT_B, keyA)).toBe(false);
    await expect(store.get(TENANT_B, keyA)).rejects.toThrow(/cross-tenant/);
    await expect(store.delete(TENANT_B, keyA)).rejects.toThrow(/cross-tenant/);
    expect(() => store.getPublicUrl(TENANT_B, keyA)).toThrow(/cross-tenant/);
    expect(() => store.signUploadUrl(TENANT_B, keyA)).toThrow(/cross-tenant/);
    expect(store.has(TENANT_B, keyA)).toBe(false);

    // A can still read its own object; the delete by B did not remove it.
    expect(decoder.decode((await store.get(TENANT_A, keyA))!.body)).toBe("tenant-A-bytes");
  });

  it("put rejects a key outside the caller's prefix", async () => {
    const store = createMockMediaStorageProvider();
    const keyA = assetStorageKey(TENANT_A, "x", "jpg");
    await expect(store.put(TENANT_B, keyA, "nope")).rejects.toThrow(/cross-tenant/);
  });

  it("keysForTenant only returns that tenant's keys", async () => {
    const store = createMockMediaStorageProvider();
    await store.put(TENANT_A, assetStorageKey(TENANT_A, "a", "jpg"), "1");
    await store.put(TENANT_A, assetStorageKey(TENANT_A, "b", "jpg"), "2");
    await store.put(TENANT_B, assetStorageKey(TENANT_B, "c", "jpg"), "3");
    expect(store.keysForTenant(TENANT_A).sort()).toEqual(
      [assetStorageKey(TENANT_A, "a", "jpg"), assetStorageKey(TENANT_A, "b", "jpg")].sort(),
    );
    expect(store.keysForTenant(TENANT_B)).toEqual([assetStorageKey(TENANT_B, "c", "jpg")]);
  });
});

describe("mock media storage: deterministic URLs", () => {
  it("getPublicUrl is deterministic and prefix-embedded", () => {
    const store = createMockMediaStorageProvider({ publicHost: "https://cdn.example" });
    const key = variantStorageKey(TENANT_A, "a1", "hero", 1920, 1440, "webp");
    expect(store.getPublicUrl(TENANT_A, key)).toBe(`https://cdn.example/${key}`);
  });

  it("signUploadUrl is deterministic for the same inputs", () => {
    const store = createMockMediaStorageProvider({ uploadHost: "https://up.example" });
    const key = assetStorageKey(TENANT_A, "a1", "jpg");
    const a = store.signUploadUrl(TENANT_A, key, { contentType: "image/jpeg" });
    const b = store.signUploadUrl(TENANT_A, key, { contentType: "image/jpeg" });
    expect(a).toEqual(b);
    expect(a.method).toBe("PUT");
    expect(a.key).toBe(key);
    expect(a.contentType).toBe("image/jpeg");
    expect(a.url.startsWith(`https://up.example/${key}?sig=`)).toBe(true);
  });
});

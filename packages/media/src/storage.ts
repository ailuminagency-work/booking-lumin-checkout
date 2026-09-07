import { MediaFormat, MediaPurpose } from "./types";

/**
 * MediaStorageProvider — a provider-neutral storage port.
 *
 * The platform is mock-first: every integration starts NOT CONNECTED and the
 * mock below makes the whole media pipeline runnable with zero credentials.
 * Real adapters (CDN, S3, Supabase Storage, R2) are future implementations of
 * this same interface — nothing above the port learns which backend is wired.
 *
 * TENANT ISOLATION. Every key is tenant-scoped: it MUST live under the tenant's
 * prefix (`t/{tenantId}/…`). One tenant can never read, overwrite or delete
 * another's object through this port, because every method re-derives the prefix
 * from the *caller's* tenantId and rejects a key outside it. At the real storage
 * layer this is enforced again by bucket policy / Postgres RLS — the application
 * check here is a convenience, never the security boundary.
 */

/** Root prefix for a tenant's objects. All keys must start here. */
export function tenantKeyPrefix(tenantId: string): string {
  return `t/${tenantId}/`;
}

/** True when `key` belongs to `tenantId`'s namespace. */
export function isTenantKey(tenantId: string, key: string): boolean {
  return key.startsWith(tenantKeyPrefix(tenantId));
}

/**
 * Assert a key belongs to the caller's tenant, or throw. This is the single
 * choke point every provider method routes through, so cross-tenant access is
 * impossible to express by accident.
 */
export function assertTenantKey(tenantId: string, key: string): void {
  if (!isTenantKey(tenantId, key)) {
    throw new Error(`cross-tenant media key access: "${key}" is not under ${tenantKeyPrefix(tenantId)}`);
  }
}

/** Deterministic canonical key for an asset's original bytes. */
export function assetStorageKey(tenantId: string, assetId: string, ext: string): string {
  return `${tenantKeyPrefix(tenantId)}assets/${assetId}/original.${ext}`;
}

/** Deterministic canonical key for a responsive variant. */
export function variantStorageKey(
  tenantId: string,
  assetId: string,
  purpose: MediaPurpose,
  width: number,
  height: number,
  format: MediaFormat,
): string {
  return `${tenantKeyPrefix(tenantId)}assets/${assetId}/variants/${purpose}_${width}x${height}.${format}`;
}

/** A stored object as the mock holds it. */
export interface StoredMediaObject {
  key: string;
  tenantId: string;
  body: Uint8Array;
  contentType: string;
  bytes: number;
}

/** Options accepted when writing an object. */
export interface PutMediaOptions {
  contentType?: string;
}

/** A signed direct-upload target the browser can PUT to. */
export interface SignedUpload {
  url: string;
  key: string;
  method: "PUT";
  /** Header the client must send so the object lands with the right type. */
  contentType: string;
}

/** The provider-neutral storage port. */
export interface MediaStorageProvider {
  readonly providerName: string;
  /** Store bytes at a tenant-scoped key. Returns the (validated) key. */
  put(tenantId: string, key: string, body: Uint8Array | string, opts?: PutMediaOptions): Promise<{ key: string }>;
  /** Read an object, or undefined when absent. Throws on cross-tenant keys. */
  get(tenantId: string, key: string): Promise<StoredMediaObject | undefined>;
  /** Remove an object. Idempotent. Throws on cross-tenant keys. */
  delete(tenantId: string, key: string): Promise<void>;
  /** Deterministic public URL for a stored key (no existence check). */
  getPublicUrl(tenantId: string, key: string): string;
  /** Deterministic signed-upload descriptor for a client-side PUT. */
  signUploadUrl(tenantId: string, key: string, opts?: PutMediaOptions): SignedUpload;
}

/** Inspection surface layered on top of the port for tests/tooling. */
export interface MockMediaStorageProvider extends MediaStorageProvider {
  /** All stored keys, in insertion order. */
  keys(): string[];
  /** All keys under one tenant's prefix. */
  keysForTenant(tenantId: string): string[];
  /** Number of stored objects. */
  size(): number;
  /** True when the key exists AND belongs to the tenant. */
  has(tenantId: string, key: string): boolean;
  /** Remove everything (test convenience). */
  clear(): void;
}

export interface MockMediaStorageOptions {
  /** Host used to build deterministic public URLs. */
  publicHost?: string;
  /** Host used to build deterministic signed-upload URLs. */
  uploadHost?: string;
  /** Default content type when a put omits one. */
  defaultContentType?: string;
}

const encoder = new TextEncoder();

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === "string" ? encoder.encode(body) : body;
}

/**
 * A tiny deterministic signature (FNV-1a hex). NOT cryptographic — it exists so
 * signed-upload URLs are stable and inspectable in tests. Real adapters sign
 * with the backend's credentials.
 */
function mockSignature(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * In-memory, deterministic MediaStorageProvider. Keys embed the tenantId and
 * every method rejects keys outside the caller's prefix, so tenant A's objects
 * are unreachable through tenant B's context.
 */
export function createMockMediaStorageProvider(opts: MockMediaStorageOptions = {}): MockMediaStorageProvider {
  const publicHost = opts.publicHost ?? "https://media.mock.local";
  const uploadHost = opts.uploadHost ?? "https://upload.mock.local";
  const defaultContentType = opts.defaultContentType ?? "application/octet-stream";
  const store = new Map<string, StoredMediaObject>();

  return {
    providerName: "mock-media-storage",

    async put(tenantId, key, body, putOpts) {
      assertTenantKey(tenantId, key);
      const bytes = toBytes(body);
      store.set(key, {
        key,
        tenantId,
        body: bytes,
        contentType: putOpts?.contentType ?? defaultContentType,
        bytes: bytes.byteLength,
      });
      return { key };
    },

    async get(tenantId, key) {
      assertTenantKey(tenantId, key);
      const obj = store.get(key);
      if (!obj) return undefined;
      // Defensive: never hand back another tenant's object even if the map held it.
      if (obj.tenantId !== tenantId) return undefined;
      return { ...obj, body: obj.body.slice() };
    },

    async delete(tenantId, key) {
      assertTenantKey(tenantId, key);
      const obj = store.get(key);
      if (obj && obj.tenantId === tenantId) store.delete(key);
    },

    getPublicUrl(tenantId, key) {
      assertTenantKey(tenantId, key);
      return `${publicHost}/${key}`;
    },

    signUploadUrl(tenantId, key, signOpts) {
      assertTenantKey(tenantId, key);
      const contentType = signOpts?.contentType ?? defaultContentType;
      const sig = mockSignature(`${tenantId}:${key}:${contentType}`);
      return {
        url: `${uploadHost}/${key}?sig=${sig}`,
        key,
        method: "PUT",
        contentType,
      };
    },

    keys() {
      return [...store.keys()];
    },

    keysForTenant(tenantId) {
      const prefix = tenantKeyPrefix(tenantId);
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },

    size() {
      return store.size;
    },

    has(tenantId, key) {
      if (!isTenantKey(tenantId, key)) return false;
      const obj = store.get(key);
      return !!obj && obj.tenantId === tenantId;
    },

    clear() {
      store.clear();
    },
  };
}

# @lumin/media

A **generic** media model + mock storage for Booking Lumin Checkout.

This package is the generalization test applied to media: **cars, equipment,
tents, rooms and service examples are all just data over ONE model**. Nothing
here knows about any vertical. Media is modeled by **role** and **owner shape**,
never by domain — grep the source and you will not find `car`, `vehicle`,
`tent`, or `room` anywhere.

## The model

| Type              | Is                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------- |
| `MediaAsset`      | A **tenant-owned** source file (`image` / `video` / `document`) with intrinsic dims.   |
| `MediaVariant`    | A **responsive derivative** of an asset for a slot (`thumbnail`…`hero`), integer dims. |
| `MediaAttachment` | Binds an asset to **any owner** by `(ownerType, ownerId)` + `role` — the generic join. |

An asset never references its owner directly. A `MediaAttachment`'s `ownerType`
is `service | resource | checkout | other`, so a detailing-package photo, a
rental gallery, a room hero shot and a customer upload all attach through the
**same** schema. Adding a vertical adds rows, never a field.

Everything is **tenant-owned**: `tenantId` is on every record (a
`@lumin/contracts` `TenantId`), and every storage key is tenant-scoped.

## Responsive variant planning

`planVariants(asset, opts?)` is a **pure, deterministic** planner. It returns the
`MediaVariant[]` **spec** a storage/transform layer would execute — it does
**no** image processing (no `sharp`, no canvas; this package has zero heavy
deps). Rules:

1. **Preserve aspect ratio** — every variant keeps the source's ratio.
2. **Never upscale** — a target wider than the original is **clamped** to the
   original (a small photo's `hero` slot is just its native resolution).
3. **Integer pixels** — heights are rounded to whole pixels.
4. **Modern format** — `webp` by default (`opts.format` for `jpeg` / `avif`).

Default breakpoints (target widths): `thumbnail 160`, `card 480`, `mobile 640`,
`gallery 1024`, `hero 1920`. Output is ordered ascending by width (**mobile-first**),
so a consumer picks the smallest sufficient source.

**Mobile optimization:** `mobile` (640px) is a first-class breakpoint distinct
from `hero` (1920px) precisely so **phones are never shipped a desktop-sized
asset** (`MOBILE_OPTIMIZATION_NOTE` carries this verbatim for UIs).

```ts
import { planVariants } from "@lumin/media";

planVariants(asset /* 4000×3000 image */);
// [ {purpose:"thumbnail", width:160,  height:120,  format:"webp", …},
//   {purpose:"card",      width:480,  height:360,  …},
//   {purpose:"mobile",    width:640,  height:480,  …},
//   {purpose:"gallery",   width:1024, height:768,  …},
//   {purpose:"hero",      width:1920, height:1440, …} ]

planVariants(asset /* 800×600 image */);
// gallery and hero clamp to the 800×600 original — no upscaling.
```

## Storage

`MediaStorageProvider` is a **provider-neutral** port (`put` / `get` / `delete` /
`getPublicUrl` / `signUploadUrl`). `createMockMediaStorageProvider()` is an
in-memory, deterministic implementation with inspection getters — the platform
is mock-first, so the whole pipeline runs with **zero credentials**. Real CDN /
S3 / Supabase-storage / R2 adapters are future implementations of the same port.

**Tenant isolation.** Every key lives under `t/{tenantId}/…`, and every provider
method re-derives that prefix from the **caller's** `tenantId` and rejects a key
outside it — so tenant A's objects are unreachable through tenant B's context.
This is enforced again at the real storage layer by bucket policy / Postgres RLS;
the check here is a convenience, **never** the security boundary.

```ts
import { createMockMediaStorageProvider, assetStorageKey } from "@lumin/media";

const store = createMockMediaStorageProvider();
const key = assetStorageKey(tenantA, "asset-1", "jpg"); // t/{tenantA}/assets/asset-1/original.jpg
await store.put(tenantA, key, bytes, { contentType: "image/jpeg" });
await store.get(tenantB, key); // throws: cross-tenant media key access
```

## Gallery assembly

`orderGallery`, `coverImage` and `buildServiceMediaView` turn raw
`(attachment, asset, variant)` rows into the `ServiceMediaView` a checkout card
renders — **generic across owner types**, so a service, a resource or a checkout
draft assemble identically.

```ts
import { buildServiceMediaView } from "@lumin/media";

const view = buildServiceMediaView(attachments, assets, variants);
// { cover: { asset, variants[] } | null, gallery: [{ asset, variants[] }, …] }
```

## Boundaries

Additive only. Depends solely on `@lumin/contracts`; touches no core, adapter,
contract, or app code. Model + plan + mock — no pixels are ever processed here.

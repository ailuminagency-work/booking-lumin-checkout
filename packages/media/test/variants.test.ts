import { describe, expect, it } from "vitest";
import { MediaVariant } from "../src/types";
import { DEFAULT_BREAKPOINTS, clampWidth, planVariants, scaledHeight } from "../src/variants";
import { TENANT_A, asset4000x3000, asset800x600 } from "./fixtures";

/** Compact projection for hand-asserting geometry. */
function geometry(vs: MediaVariant[]) {
  return vs.map((v) => ({ purpose: v.purpose, width: v.width, height: v.height, format: v.format }));
}

describe("planVariants: large asset (4000×3000) plans every breakpoint, downscaled", () => {
  const variants = planVariants(asset4000x3000());

  it("emits all five breakpoints, ascending by width (mobile-first)", () => {
    expect(geometry(variants)).toEqual([
      { purpose: "thumbnail", width: 160, height: 120, format: "webp" },
      { purpose: "card", width: 480, height: 360, format: "webp" },
      { purpose: "mobile", width: 640, height: 480, format: "webp" },
      { purpose: "gallery", width: 1024, height: 768, format: "webp" },
      { purpose: "hero", width: 1920, height: 1440, format: "webp" },
    ]);
  });

  it("preserves the 4:3 aspect ratio at every size", () => {
    for (const v of variants) {
      expect(v.width / v.height).toBeCloseTo(4000 / 3000, 10);
    }
  });

  it("stamps deterministic tenant-scoped storage keys and ids", () => {
    const thumb = variants.find((v) => v.purpose === "thumbnail")!;
    expect(thumb.id).toBe("asset-4k:thumbnail");
    expect(thumb.assetId).toBe("asset-4k");
    expect(thumb.tenantId).toBe(TENANT_A);
    expect(thumb.storageKey).toBe(`t/${TENANT_A}/assets/asset-4k/variants/thumbnail_160x120.webp`);
    const hero = variants.find((v) => v.purpose === "hero")!;
    expect(hero.storageKey).toBe(`t/${TENANT_A}/assets/asset-4k/variants/hero_1920x1440.webp`);
  });

  it("each variant validates against the MediaVariant schema", () => {
    for (const v of variants) expect(() => MediaVariant.parse(v)).not.toThrow();
  });
});

describe("planVariants: small asset (800×600) never upscales and clamps to original", () => {
  const variants = planVariants(asset800x600());

  it("clamps gallery and hero to the 800×600 original (no upscaling)", () => {
    expect(geometry(variants)).toEqual([
      { purpose: "thumbnail", width: 160, height: 120, format: "webp" },
      { purpose: "card", width: 480, height: 360, format: "webp" },
      { purpose: "mobile", width: 640, height: 480, format: "webp" },
      // 1024 and 1920 both exceed the 800px original → clamped to native.
      { purpose: "gallery", width: 800, height: 600, format: "webp" },
      { purpose: "hero", width: 800, height: 600, format: "webp" },
    ]);
  });

  it("no variant exceeds the original dimensions", () => {
    for (const v of variants) {
      expect(v.width).toBeLessThanOrEqual(800);
      expect(v.height).toBeLessThanOrEqual(600);
    }
  });

  it("clamped keys reflect the clamped dimensions", () => {
    const gallery = variants.find((v) => v.purpose === "gallery")!;
    expect(gallery.storageKey).toBe(`t/${TENANT_A}/assets/asset-sm/variants/gallery_800x600.webp`);
  });
});

describe("planVariants options and edge cases", () => {
  it("honors a format override on every variant", () => {
    const variants = planVariants(asset4000x3000(), { format: "avif" });
    expect(variants.every((v) => v.format === "avif")).toBe(true);
    const thumb = variants.find((v) => v.purpose === "thumbnail")!;
    expect(thumb.storageKey.endsWith("thumbnail_160x120.avif")).toBe(true);
  });

  it("honors custom breakpoints", () => {
    const variants = planVariants(asset4000x3000(), { breakpoints: { thumbnail: 100 } });
    const thumb = variants.find((v) => v.purpose === "thumbnail")!;
    // 100 × 3000/4000 = 75.
    expect({ width: thumb.width, height: thumb.height }).toEqual({ width: 100, height: 75 });
  });

  it("plans only the requested subset of purposes", () => {
    const variants = planVariants(asset4000x3000(), { purposes: ["thumbnail", "card"] });
    expect(variants.map((v) => v.purpose)).toEqual(["thumbnail", "card"]);
  });

  it("returns [] for non-image kinds", () => {
    const doc = { ...asset4000x3000(), kind: "document" as const, id: "doc-1" };
    expect(planVariants(doc)).toEqual([]);
  });

  it("throws when an image lacks intrinsic dimensions", () => {
    const noDims = { ...asset4000x3000(), width: undefined, height: undefined };
    expect(() => planVariants(noDims)).toThrow(/missing intrinsic/);
  });

  it("exposes the geometry helpers used internally", () => {
    expect(clampWidth(1920, 800)).toBe(800);
    expect(clampWidth(480, 4000)).toBe(480);
    expect(scaledHeight(640, 4000, 3000)).toBe(480);
    expect(DEFAULT_BREAKPOINTS.hero).toBe(1920);
  });
});

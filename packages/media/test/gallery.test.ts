import { describe, expect, it } from "vitest";
import { buildServiceMediaView, coverImage, orderGallery } from "../src/gallery";
import { planVariants } from "../src/variants";
import { makeAsset, makeAttachment } from "./fixtures";

/**
 * A service owner with one cover + three gallery images. Attachments are given
 * out of sortOrder on purpose to prove ordering is applied, not incidental.
 */
const coverAsset = makeAsset("cover-a");
const g1 = makeAsset("g1");
const g2 = makeAsset("g2");
const g3 = makeAsset("g3");
const assets = [coverAsset, g1, g2, g3];

const attachments = [
  makeAttachment("att-g2", "g2", "gallery", 20),
  makeAttachment("att-cover", "cover-a", "cover", 0),
  makeAttachment("att-g3", "g3", "gallery", 30),
  makeAttachment("att-g1", "g1", "gallery", 10),
];

describe("orderGallery", () => {
  it("sorts by sortOrder ascending", () => {
    expect(orderGallery(attachments).map((a) => a.id)).toEqual(["att-cover", "att-g1", "att-g2", "att-g3"]);
  });

  it("tie-breaks equal sortOrder by id, and does not mutate the input", () => {
    const tied = [
      makeAttachment("b", "g1", "gallery", 5),
      makeAttachment("a", "g2", "gallery", 5),
    ];
    const before = tied.map((a) => a.id);
    expect(orderGallery(tied).map((a) => a.id)).toEqual(["a", "b"]);
    expect(tied.map((a) => a.id)).toEqual(before);
  });

  it("returns [] for no attachments", () => {
    expect(orderGallery([])).toEqual([]);
  });
});

describe("coverImage", () => {
  it("selects the cover-role attachment's asset", () => {
    expect(coverImage(attachments, assets)?.id).toBe("cover-a");
  });

  it("falls back to the first ordered gallery item when no cover is marked", () => {
    const galleryOnly = [
      makeAttachment("att-g3", "g3", "gallery", 30),
      makeAttachment("att-g1", "g1", "gallery", 10),
    ];
    expect(coverImage(galleryOnly, assets)?.id).toBe("g1");
  });

  it("returns undefined when nothing resolves", () => {
    expect(coverImage([], assets)).toBeUndefined();
    // Attachment points at an asset that isn't provided.
    const dangling = [makeAttachment("x", "missing", "cover", 0)];
    expect(coverImage(dangling, assets)).toBeUndefined();
  });
});

describe("buildServiceMediaView", () => {
  it("assembles a cover + three ordered gallery entries for a service", () => {
    const view = buildServiceMediaView(attachments, assets);
    expect(view.cover?.asset.id).toBe("cover-a");
    expect(view.gallery.map((g) => g.asset.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("attaches each asset's planned variants", () => {
    const variants = [
      ...planVariants(coverAsset),
      ...planVariants(g1),
    ];
    const view = buildServiceMediaView(attachments, assets, variants);
    // cover-a is 1600×1200 → all five breakpoints fit under the original.
    expect(view.cover?.variants.map((v) => v.purpose)).toEqual([
      "thumbnail",
      "card",
      "mobile",
      "gallery",
      "hero",
    ]);
    // g1 got variants; g2/g3 were not planned → empty arrays, not errors.
    const byId = Object.fromEntries(view.gallery.map((g) => [g.asset.id, g.variants.length]));
    expect(byId).toEqual({ g1: 5, g2: 0, g3: 0 });
  });

  it("is generic across owner types: same assembly for a resource owner", () => {
    const resourceAttachments = [
      makeAttachment("r-cover", "cover-a", "cover", 0, "resource", "room-42"),
      makeAttachment("r-g1", "g1", "gallery", 1, "resource", "room-42"),
    ];
    const view = buildServiceMediaView(resourceAttachments, assets);
    expect(view.cover?.asset.id).toBe("cover-a");
    expect(view.gallery.map((g) => g.asset.id)).toEqual(["g1"]);
  });

  it("skips gallery attachments whose asset is missing", () => {
    const withDangling = [
      makeAttachment("att-cover", "cover-a", "cover", 0),
      makeAttachment("att-missing", "gone", "gallery", 5),
      makeAttachment("att-g1", "g1", "gallery", 10),
    ];
    const view = buildServiceMediaView(withDangling, assets);
    expect(view.gallery.map((g) => g.asset.id)).toEqual(["g1"]);
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MediaLibraryPage } from "../pages/MediaLibrary";
import { portalMediaLibrary, portalMediaStorage } from "../data/media";
import { DEMO_TENANT_ID } from "../data/mockTenant";

afterEach(cleanup);

/** media wiring: assets are seeded into mock storage and their responsive
 *  variant plan (via planVariants) is surfaced. */
describe("Media Library view", () => {
  it("seeds tenant-scoped assets into the mock provider", () => {
    expect(portalMediaLibrary.length).toBeGreaterThan(0);
    for (const entry of portalMediaLibrary) {
      expect(portalMediaStorage.has(DEMO_TENANT_ID, entry.asset.storageKey)).toBe(true);
      // A 4-plus-breakpoint image plans several responsive variants.
      expect(entry.variantCount).toBeGreaterThan(0);
    }
  });

  it("renders each asset with its variant count", () => {
    render(<MediaLibraryPage />);
    for (const entry of portalMediaLibrary) {
      expect(screen.getByTestId(`asset-${entry.asset.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`variants-${entry.asset.id}`)).toHaveTextContent(
        String(entry.variantCount),
      );
    }
  });
});

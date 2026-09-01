import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL only auto-cleans when the runner exposes a global afterEach;
// vitest without `globals: true` does not, so register it explicitly.
afterEach(() => {
  cleanup();
});

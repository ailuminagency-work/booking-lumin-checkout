import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled, so React Testing Library's automatic
// cleanup does not register itself — do it explicitly.
afterEach(() => {
  cleanup();
});

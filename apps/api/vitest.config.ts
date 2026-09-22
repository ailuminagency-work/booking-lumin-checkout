import { defineConfig } from "vitest/config";

// Default `npm test` runs only fast, dependency-free unit tests (no Postgres,
// no sockets, no network). The pg-backed acceptance harnesses are standalone
// tsx scripts under src/*.integration.ts and are run via `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.ts"],
  },
});

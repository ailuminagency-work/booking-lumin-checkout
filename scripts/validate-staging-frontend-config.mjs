import { readFileSync } from "node:fs";

const configs = [
  "deploy/netlify/checkout.staging.toml",
  "deploy/netlify/portal.staging.toml",
  "deploy/netlify/command-center.staging.toml",
];

const placeholders = /__SET_|__PLATFORM_CONTEXT_ONLY__/;
for (const path of configs) {
  const source = readFileSync(path, "utf8");
  if (!source.includes('NODE_VERSION = "20"')) throw new Error(`${path}: missing Node version`);
  if (!source.includes("npm run build --workspace")) throw new Error(`${path}: build must run from the workspace root`);
  if (!source.includes("publish = \"apps/")) throw new Error(`${path}: missing workspace publish directory`);
  if (!source.includes('VITE_RUNTIME_ENV = "staging"')) throw new Error(`${path}: missing staging runtime environment`);
  if (path.includes("command-center")) {
    if (!source.includes('VITE_RUNTIME_MODE = "mock"')) throw new Error(`${path}: command center requires explicit mock mode until platform context exists`);
    if (source.includes("VITE_TENANT_ID")) throw new Error(`${path}: must not invent a tenant id`);
  } else {
    if (!source.includes('VITE_API_ORIGIN = "__SET_RENDER_STAGING_API_URL__"')) throw new Error(`${path}: missing API origin placeholder`);
    if (!placeholders.test(source)) throw new Error(`${path}: staging values must remain explicit placeholders until provisioned`);
  }
}
console.log(`validated ${configs.length} frontend staging contracts`);

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
  if (!source.includes('command = "npm run build"')) throw new Error(`${path}: missing build command`);
  if (!source.includes('publish = "dist"')) throw new Error(`${path}: missing publish directory`);
  if (!placeholders.test(source)) throw new Error(`${path}: staging values must remain explicit placeholders until provisioned`);
}
console.log(`validated ${configs.length} frontend staging contracts`);

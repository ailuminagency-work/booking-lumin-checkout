import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePreviewEnvironment } from "./preview-mode.mjs";
import { sourceProvenance, validateSourceProvenance } from "./source-provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "preview");
const apps = ["checkout", "portal", "command-center"];
const mode = validatePreviewEnvironment(process.env);
const initialSource = sourceProvenance(root);
validateSourceProvenance(initialSource, process.env);
const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Preview build failed (exit ${result.status})`);
}

// Validate the resolved target before recursive cleanup. Refuse redirected dist
// or preview paths so a symlink/junction cannot delete outside this checkout.
await mkdir(join(root, "dist"), { recursive: true });
if (await realpath(join(root, "dist")) !== join(await realpath(root), "dist")) {
  throw new Error("Refusing redirected preview output parent");
}
const existing = await lstat(output).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (existing && (existing.isSymbolicLink() || await realpath(output) !== output)) {
  throw new Error("Refusing redirected preview output");
}
if (relative(root, output) !== join("dist", "preview")) throw new Error("Unsafe preview output");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const app of apps) {
  run([vite, "build", join(root, "apps", app), "--outDir", join(output, app), "--emptyOutDir"], {
    // Explicit values also override Vite .env files; local fixture auth must
    // never be activated by an app-local development environment at publish.
    env: { ...process.env, VITE_RUNTIME_MODE: mode.runtimeMode, VITE_BASE_PATH: `/${app}/`, VITE_FLOW_LOCAL_HARNESS: "false", VITE_FLOW_API_URL: "", VITE_MODE_OWNER_LOCAL_HARNESS: "false", VITE_MODE_OWNER_API_URL: "", VITE_MODE_OWNER_DRAFT_API_URL: "" },
  });
  const entry = join(output, app, "index.html");
  const html = await readFile(entry, "utf8");
  const notice = `<aside data-preview-notice aria-label="Preview mode notice" style="position:relative;z-index:20;padding:12px 20px;background:#e9f1ec;color:#173c31;font:14px/1.5 system-ui,sans-serif;border-bottom:1px solid #cadcd1"><a href="/" style="color:inherit;font-weight:700">Lumin preview</a> · ${mode.label}. ${mode.description}</aside>`;
  if (!html.includes("<body>")) throw new Error(`Missing HTML body for ${app}`);
  await writeFile(entry, html.replace("<body>", `<body>${notice}`));
}
const landing = await readFile(join(root, "preview", "index.html"), "utf8");
await writeFile(join(output, "index.html"), landing.replace("{{MODE_LABEL}}", mode.label).replace("{{MODE_DESCRIPTION}}", mode.description));
await cp(join(root, "preview", "preview.css"), join(output, "preview.css"));
await writeFile(join(output, "_redirects"), apps.map((app) => `/${app}/* /${app}/index.html 200`).join("\n") + "\n");
await writeFile(join(output, "_headers"), "/build.json\n  Cache-Control: no-store\n");

async function hashes(directory) {
  const files = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await hashes(path));
    else files[relative(output, path).split(sep).join("/")] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return files;
}
const finalSource = sourceProvenance(root);
validateSourceProvenance(finalSource, process.env, initialSource);
await writeFile(join(output, "build.json"), JSON.stringify({
  schemaVersion: 1,
  mode: mode.mode,
  persistence: mode.persistence,
  providerConnections: mode.providerConnections,
  ...finalSource,
  builtAt: new Date().toISOString(),
  apps: Object.fromEntries(apps.map((app) => [app, `/${app}/`])),
  files: await hashes(output),
}, null, 2) + "\n");
run(["--test", join(root, "scripts", "build-preview.test.mjs"), join(root, "scripts", "preview-mode.test.mjs"), join(root, "scripts", "source-provenance.test.mjs")]);
validateSourceProvenance(sourceProvenance(root), process.env, initialSource);
console.log(`Preview ready: ${output}`);

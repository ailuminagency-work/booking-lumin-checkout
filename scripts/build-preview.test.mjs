import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { previewMode, validatePreviewEnvironment } from "./preview-mode.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "preview");
const apps = ["checkout", "portal", "command-center"];
const mode = validatePreviewEnvironment(process.env);

test("each app loads its own actual nested assets and retains a visible demo boundary", async () => {
  for (const app of apps) {
    const html = await readFile(join(output, app, "index.html"), "utf8");
    assert.match(html, /data-preview-notice/);
    assert.ok(html.includes(mode.description));
    const urls = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]);
    assert.ok(urls.some((url) => url.endsWith(".js")), `${app}: no bundle`);
    for (const url of urls) {
      assert.ok(url.startsWith(`/${app}/assets/`), `${app}: incorrect base ${url}`);
      assert.ok((await readFile(join(output, url.slice(1)))).length > 0);
    }
  }
});

test("SPA fallbacks stay app-scoped and do not force-shadow static assets", async () => {
  const redirects = (await readFile(join(output, "_redirects"), "utf8")).trim().split("\n");
  assert.deepEqual(redirects, apps.map((app) => `/${app}/* /${app}/index.html 200`));
  const html = await readFile(join(output, "index.html"), "utf8");
  for (const app of apps) assert.ok(html.includes(`href="/${app}/"`));
  assert.ok(html.includes(mode.description));
  assert.ok(!html.includes("{{MODE_"));
});

test("provenance explicitly states configured mode and verifies published artifact hashes", async () => {
  const build = JSON.parse(await readFile(join(output, "build.json"), "utf8"));
  assert.equal(build.mode, mode.mode);
  assert.equal(build.persistence, mode.persistence);
  assert.equal(build.providerConnections, mode.providerConnections);
  assert.match(build.sourceCommit, /^(?:[a-f0-9]{40}|unknown)$/);
  assert.ok(build.sourceDirty === null || typeof build.sourceDirty === "boolean");
  if (process.env.NETLIFY === "true") {
    assert.match(build.sourceCommit, /^[a-f0-9]{40}$/);
    assert.equal(build.sourceDirty, false);
  }
  assert.ok(Number.isFinite(Date.parse(build.builtAt)));
  for (const app of apps) assert.equal(build.apps[app], `/${app}/`);
  for (const [path, hash] of Object.entries(build.files)) {
    assert.ok(!path.includes("..") && !path.startsWith("/"));
    assert.equal(createHash("sha256").update(await readFile(join(output, path))).digest("hex"), hash, path);
  }
  assert.ok(build.files["index.html"] && build.files["_redirects"]);
});

test("Supabase mode never claims in-memory storage or activated payment providers", () => {
  const connected = previewMode("supabase");
  assert.equal(connected.persistence, "supabase");
  assert.equal(connected.providerConnections, "not-connected");
  assert.match(connected.description, /unconfirmed draft requests/);
  assert.doesNotMatch(connected.description, /sample data|reset on reload/);
  assert.equal(previewMode().mode, "demo-in-memory");
  assert.throws(() => previewMode("production"), /Unsupported/);
});

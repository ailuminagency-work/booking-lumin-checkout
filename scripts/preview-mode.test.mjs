import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validatePreviewEnvironment } from "./preview-mode.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const connected = {
  NETLIFY: "true", VITE_RUNTIME_MODE: "supabase",
  VITE_SUPABASE_URL: "https://fixture.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_fixture",
  VITE_TENANT_ID: "11111111-1111-4111-8111-111111111111",
};
const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.synthetic`;

test("Netlify requires an explicit mode; local mock remains intentional", () => {
  assert.equal(validatePreviewEnvironment({}).runtimeMode, "mock");
  assert.equal(validatePreviewEnvironment({ NETLIFY: "true", VITE_RUNTIME_MODE: "mock" }).mode, "demo-in-memory");
  assert.throws(() => validatePreviewEnvironment({ NETLIFY: "true" }), /explicit VITE_RUNTIME_MODE/);
  for (const mode of ["", "production", "Supabase", " supabase "]) {
    assert.throws(() => validatePreviewEnvironment({ VITE_RUNTIME_MODE: mode }), /Unsupported VITE_RUNTIME_MODE/);
  }
});

test("connected config accepts public key formats without claiming key authenticity", () => {
  assert.equal(validatePreviewEnvironment(connected).mode, "supabase-draft-requests");
  assert.equal(validatePreviewEnvironment({ ...connected, VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon") }).providerConnections, "not-connected");
});

test("local fixture API cannot become a published integration", () => {
  assert.equal(validatePreviewEnvironment({ VITE_FLOW_LOCAL_HARNESS: "false", VITE_FLOW_API_URL: "" }).runtimeMode, "mock");
  for (const value of ["true", "TRUE", "1", "", " false "]) {
    assert.throws(() => validatePreviewEnvironment({ VITE_FLOW_LOCAL_HARNESS: value }), /VITE_FLOW_LOCAL_HARNESS/);
  }
  for (const value of ["http://127.0.0.1:8787", "https://api.example.test", "private-marker"]) {
    assert.throws(() => validatePreviewEnvironment({ VITE_FLOW_API_URL: value }), error => {
      assert.match(error.message, /VITE_FLOW_API_URL/);
      assert.ok(!error.message.includes(value));
      return true;
    });
  }
});

test("invalid connected configuration rejects without echoing values", () => {
  const cases = [
    ["VITE_SUPABASE_URL", undefined], ["VITE_SUPABASE_URL", "not-a-url"],
    ["VITE_SUPABASE_URL", "http://fixture.supabase.co"],
    ["VITE_SUPABASE_URL", "https://user:private-marker@fixture.supabase.co"],
    ["VITE_SUPABASE_URL", "https://fixture.supabase.co/rest/v1"],
    ["VITE_SUPABASE_URL", "https://fixture.supabase.co?key=private-marker"],
    ["VITE_SUPABASE_URL", "https://fixture.supabase.co#private-marker"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", undefined], ["VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", "sb_secret_private-marker"],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", jwt("service_role")],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", "x.invalid.x"],
    ["VITE_TENANT_ID", undefined], ["VITE_TENANT_ID", "private-marker@example.test"],
  ];
  for (const [name, value] of cases) {
    assert.throws(() => validatePreviewEnvironment({ ...connected, [name]: value }), (error) => {
      assert.match(error.message, new RegExp(name));
      assert.ok(!error.message.includes("private-marker"));
      if (value) assert.ok(!error.message.includes(value));
      return true;
    });
  }
});

test("rejected Netlify configuration fails before touching an existing preview", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "lumin-preview-config-"));
  const fixtureScripts = join(fixture, "scripts");
  const output = join(fixture, "dist", "preview");
  await mkdir(fixtureScripts);
  await mkdir(output, { recursive: true });
  await copyFile(join(scripts, "build-preview.mjs"), join(fixtureScripts, "build-preview.mjs"));
  await copyFile(join(scripts, "preview-mode.mjs"), join(fixtureScripts, "preview-mode.mjs"));
  const marker = join(output, "previous-release.txt");
  await writeFile(marker, "unchanged accepted artifact");
  try {
    for (const overrides of [
      { NETLIFY: "true" },
      { NETLIFY: "true", VITE_RUNTIME_MODE: "" },
      { NETLIFY: "true", VITE_RUNTIME_MODE: "supabase" },
      { ...connected, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private-marker" },
      { NETLIFY: "true", VITE_RUNTIME_MODE: "mock", VITE_FLOW_LOCAL_HARNESS: "true" },
      { NETLIFY: "true", VITE_RUNTIME_MODE: "mock", VITE_FLOW_API_URL: "private-marker" },
    ]) {
      const environment = { ...process.env };
      for (const name of ["NETLIFY", "VITE_RUNTIME_MODE", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_TENANT_ID", "VITE_FLOW_LOCAL_HARNESS", "VITE_FLOW_API_URL"]) delete environment[name];
      const result = spawnSync(process.execPath, [join(fixtureScripts, "build-preview.mjs")], {
        cwd: fixture, env: { ...environment, ...overrides }, encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /VITE_RUNTIME_MODE|VITE_SUPABASE|VITE_FLOW_/);
      assert.ok(!result.stderr.includes("private-marker"));
      assert.equal(await readFile(marker, "utf8"), "unchanged accepted artifact");
    }
  } finally {
    // Only explicit fixture files; no computed recursive removal.
    await rm(marker, { force: true });
    await rm(join(fixtureScripts, "build-preview.mjs"), { force: true });
    await rm(join(fixtureScripts, "preview-mode.mjs"), { force: true });
    await rmdir(output);
    await rmdir(join(fixture, "dist"));
    await rmdir(fixtureScripts);
    await rmdir(fixture);
  }
});

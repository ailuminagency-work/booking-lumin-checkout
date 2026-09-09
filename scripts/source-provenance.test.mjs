import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sourceProvenance, validateSourceProvenance } from "./source-provenance.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const netlify = { NETLIFY: "true", VITE_RUNTIME_MODE: "mock" };
async function fixture(run, initialize = true) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "lumin-provenance-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    if (initialize) {
      git("init", "--quiet");
      await copyFile(join(scripts, "..", ".gitignore"), join(root, ".gitignore"));
      await writeFile(join(root, "source.txt"), "accepted source\n");
      git("add", ".");
      git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "fixture");
    }
    await run(root, git);
  } finally {
    // Only this freshly-created, resolved temporary Git fixture is removed.
    assert.equal(await realpath(root), resolve(root));
    assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith("lumin-provenance-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("generated Netlify directories at root and nested workspaces remain clean", async () => fixture(async root => {
  const initial = sourceProvenance(root);
  assert.equal(initial.sourceDirty, false);
  for (const directory of [".netlify", "apps/checkout/.netlify/edge-functions", "packages/example/.netlify"]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "generated.js"), "generated fixture");
  }
  assert.deepEqual(sourceProvenance(root), initial);
  validateSourceProvenance(sourceProvenance(root), netlify, initial);
}));

test("tracked files inside ignored Netlify paths still reveal changes", async () => fixture(async (root, git) => {
  await mkdir(join(root, ".netlify"));
  await writeFile(join(root, ".netlify", "tracked.txt"), "original");
  git("add", "-f", ".netlify/tracked.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "tracked fixture");
  await writeFile(join(root, ".netlify", "tracked.txt"), "changed");
  assert.equal(sourceProvenance(root).sourceDirty, true);
  assert.throws(() => validateSourceProvenance(sourceProvenance(root), netlify), /clean Git/);
}));

test("tracked edits and arbitrary untracked paths both fail closed", async () => fixture(async root => {
  await writeFile(join(root, "source.txt"), "changed");
  assert.throws(() => validateSourceProvenance(sourceProvenance(root), netlify), /clean Git/);
  await writeFile(join(root, "source.txt"), "accepted source\n");
  await mkdir(join(root, "apps", "checkout"), { recursive: true });
  await writeFile(join(root, "apps", "checkout", "unexpected.txt"), "unexpected");
  assert.equal(sourceProvenance(root).sourceDirty, true);
  assert.throws(() => validateSourceProvenance(sourceProvenance(root), netlify), /clean Git/);
  assert.doesNotThrow(() => validateSourceProvenance(sourceProvenance(root), {}));
}));

test("missing Git and missing repository are unknown, never falsely clean", async () => fixture(async root => {
  const unknown = { sourceCommit: "unknown", sourceDirty: null };
  assert.deepEqual(sourceProvenance(root), unknown);
  assert.deepEqual(sourceProvenance(root, join(root, "missing-git-executable")), unknown);
  assert.throws(() => validateSourceProvenance(unknown, netlify), /clean Git/);
}, false));

test("hidden tracked-file index flags fail closed without clearing the flags", async () => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) await fixture(async (root, git) => {
    git("update-index", flag, "source.txt");
    await writeFile(join(root, "source.txt"), "hidden tracked change");
    assert.equal(git("status", "--porcelain"), "");
    const flagsBefore = git("ls-files", "-v");
    assert.deepEqual(sourceProvenance(root), { sourceCommit: "unknown", sourceDirty: null });
    assert.throws(() => validateSourceProvenance(sourceProvenance(root), netlify), /clean Git/);
    assert.equal(git("ls-files", "-v"), flagsBefore);
  });
});

test("post-build dirty state and clean commit drift reject the accepted starting revision", async () => fixture(async (root, git) => {
  const initial = sourceProvenance(root);
  await writeFile(join(root, "source.txt"), "changed by build\n");
  assert.throws(() => validateSourceProvenance(sourceProvenance(root), netlify, initial), /clean Git/);
  git("add", "source.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "during build");
  assert.equal(sourceProvenance(root).sourceDirty, false);
  assert.throws(() => validateSourceProvenance(sourceProvenance(root), netlify, initial), /revision changed/);
}));

test("dirty and unknown Netlify inputs fail before existing preview cleanup", async () => {
  for (const initialize of [true, false]) await fixture(async root => {
    await mkdir(join(root, "scripts"));
    for (const name of ["build-preview.mjs", "preview-mode.mjs", "source-provenance.mjs"]) {
      await copyFile(join(scripts, name), join(root, "scripts", name));
    }
    await mkdir(join(root, "dist", "preview"), { recursive: true });
    const marker = join(root, "dist", "preview", "previous.txt");
    await writeFile(marker, "accepted previous artifact");
    const env = { ...process.env, ...netlify, VITE_FLOW_LOCAL_HARNESS: "false", VITE_FLOW_API_URL: "" };
    const result = spawnSync(process.execPath, [join(root, "scripts", "build-preview.mjs")], { cwd: root, env, encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /known clean Git source provenance/);
    assert.equal(await readFile(marker, "utf8"), "accepted previous artifact");
  }, initialize);
});

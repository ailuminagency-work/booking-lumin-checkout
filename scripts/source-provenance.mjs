import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Git's ignore rules apply only to untracked generated files, never tracked edits. */
export function sourceProvenance(root, gitCommand = "git") {
  const git = (args) => {
    const result = spawnSync(gitCommand, args, { cwd: root, encoding: "utf8", timeout: 10000 });
    return !result.error && result.status === 0 ? result.stdout.trim() : null;
  };
  const top = git(["rev-parse", "--show-toplevel"]);
  const revision = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  // Index flags can hide tracked edits from status. Refuse such a checkout,
  // including fsmonitor-valid entries, without altering the caller's index.
  const tracked = git(["ls-files", "-v", "-z"]);
  const monitored = git(["ls-files", "-f", "-z"]);
  const visible = (listing) => listing !== null && listing.split("\0").filter(Boolean).every(entry => entry.startsWith("H "));
  if (top === null || resolve(top) !== resolve(root) || !/^[a-f0-9]{40}$/.test(revision ?? "") || status === null || !visible(tracked) || !visible(monitored)) {
    return { sourceCommit: "unknown", sourceDirty: null };
  }
  return { sourceCommit: revision, sourceDirty: status.length > 0 };
}

/** Deployment requires a clean, known, unchanged checkout; local previews disclose it. */
export function validateSourceProvenance(value, environment, initial) {
  if (environment.NETLIFY !== "true") return;
  if (!/^[a-f0-9]{40}$/.test(value.sourceCommit) || value.sourceDirty !== false) {
    throw new Error("Netlify preview requires known clean Git source provenance");
  }
  if (initial && value.sourceCommit !== initial.sourceCommit) {
    throw new Error("Netlify preview source revision changed during build");
  }
}

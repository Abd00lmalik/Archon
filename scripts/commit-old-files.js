#!/usr/bin/env node

/**
 * Stages changed files older than N days, commits, and pushes current branch.
 *
 * Usage:
 *   node scripts/commit-old-files.js
 *   node scripts/commit-old-files.js --days=4 --message="Archon final build"
 *   node scripts/commit-old-files.js --dry-run
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function resolveGitBin() {
  if (process.env.ARCHON_GIT_PATH) return process.env.ARCHON_GIT_PATH;

  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
      "C:\\Program Files (x86)\\Git\\bin\\git.exe",
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return "git";
}

const GIT_BIN = resolveGitBin();

function runGit(args, opts = {}) {
  const result = spawnSync(GIT_BIN, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    ...opts,
  });

  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed${err ? `: ${err}` : ""} (exit ${result.status})`
    );
  }

  return result.stdout.trim();
}

function gitHasOutput(args) {
  const result = spawnSync(GIT_BIN, args, {
    encoding: "utf8",
    stdio: "ignore",
    shell: false,
  });
  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  return result.status !== 0;
}

function parseArgs(argv) {
  const out = {
    days: 4,
    message: "Archon final build",
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg.startsWith("--days=")) {
      out.days = Number(arg.slice("--days=".length));
      continue;
    }
    if (arg.startsWith("--message=")) {
      out.message = arg.slice("--message=".length);
      continue;
    }
  }

  if (!Number.isInteger(out.days) || out.days < 0) {
    throw new Error("Invalid --days value. Use a non-negative integer.");
  }

  if (!out.message) {
    throw new Error("Commit message cannot be empty.");
  }

  return out;
}

function splitNullSeparated(stdout) {
  return stdout.split("\u0000").map((x) => x.trim()).filter(Boolean);
}

async function main() {
  const { days, message, dryRun } = parseArgs(process.argv.slice(2));

  runGit(["rev-parse", "--is-inside-work-tree"]);
  const repoRoot = runGit(["rev-parse", "--show-toplevel"]);
  process.chdir(repoRoot);

  // Safety: prevent mixing pre-staged files with this commit.
  const hasStaged = gitHasOutput(["diff", "--cached", "--quiet"]);
  if (hasStaged) {
    throw new Error(
      "Staged changes already exist. Please commit/stash/reset staged changes first."
    );
  }

  // Only inspect git-visible changed/untracked files.
  const changedRaw = runGit(["ls-files", "-m", "-o", "--exclude-standard", "-z"]);
  const changedPaths = splitNullSeparated(changedRaw);

  if (changedPaths.length === 0) {
    console.log("No changed or untracked files found. Nothing to do.");
    return;
  }

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const matching = [];

  for (const rel of changedPaths) {
    // Ignore .git paths explicitly (safety belt; git ls-files already excludes these).
    if (rel === ".git" || rel.startsWith(".git/")) continue;

    const abs = path.join(repoRoot, rel);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      // Could be deleted/missing path; skip because we cannot evaluate file mtime.
      continue;
    }
    if (!stat.isFile()) continue;

    if (stat.mtimeMs < cutoffMs) {
      matching.push(rel);
    }
  }

  if (matching.length === 0) {
    console.log(`No files modified more than ${days} day(s) ago. Nothing to commit.`);
    return;
  }

  console.log(`Files matched (> ${days} day(s) old):`);
  for (const file of matching) {
    console.log(` - ${file}`);
  }

  if (dryRun) {
    console.log("Dry run enabled. No files staged, committed, or pushed.");
    return;
  }

  runGit(["add", "--", ...matching]);

  // Re-check staged content to avoid empty commit edge cases.
  const hasNewStaged = gitHasOutput(["diff", "--cached", "--quiet"]);

  if (!hasNewStaged) {
    console.log("No staged changes after filtering. Nothing to commit.");
    return;
  }

  console.log("Files staged for commit:");
  const stagedList = runGit(["diff", "--cached", "--name-only"])
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const file of stagedList) {
    console.log(` - ${file}`);
  }

  runGit(["commit", "-m", message], { stdio: ["ignore", "inherit", "inherit"] });

  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  runGit(["push", "origin", branch], { stdio: ["ignore", "inherit", "inherit"] });

  console.log(`Committed and pushed on branch: ${branch}`);
  console.log(`Commit message: "${message}"`);
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});

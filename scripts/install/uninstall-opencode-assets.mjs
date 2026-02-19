#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, ".opencode");

function parseArgs(argv) {
  const args = {
    target: ".opencode.local",
    dryRun: false,
    force: false,
    removeEnv: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--target" && argv[i + 1]) {
      args.target = argv[i + 1];
      i += 1;
    } else if (current === "--dry-run") {
      args.dryRun = true;
    } else if (current === "--force") {
      args.force = true;
    } else if (current === "--remove-env") {
      args.removeEnv = true;
    }
  }
  return args;
}

function listFilesRecursive(rootPath, base = rootPath, output = []) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry.name)) {
        continue;
      }
      listFilesRecursive(abs, base, output);
    } else if (entry.isFile()) {
      output.push(path.relative(base, abs));
    }
  }
  return output;
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function filesEqual(a, b) {
  try {
    const left = fs.readFileSync(a);
    const right = fs.readFileSync(b);
    return Buffer.compare(left, right) === 0;
  } catch {
    return false;
  }
}

function symlinkPointsTo(targetPath, sourcePath) {
  try {
    const resolvedTarget = fs.realpathSync(targetPath);
    const resolvedSource = fs.realpathSync(sourcePath);
    return resolvedTarget === resolvedSource;
  } catch {
    return false;
  }
}

function removeIfEligible(sourceFile, targetFile, force, dryRun) {
  if (!fs.existsSync(targetFile)) {
    return "missing";
  }

  const stats = fs.lstatSync(targetFile);
  if (stats.isSymbolicLink()) {
    if (!force && !symlinkPointsTo(targetFile, sourceFile)) {
      return "kept";
    }
    if (!dryRun) {
      fs.unlinkSync(targetFile);
    }
    return "removed";
  }

  if (!stats.isFile()) {
    return "skipped";
  }

  if (!force && !filesEqual(sourceFile, targetFile)) {
    return "kept";
  }

  if (!dryRun) {
    fs.unlinkSync(targetFile);
  }
  return "removed";
}

function uniqueParentDirs(relativeFiles) {
  const dirs = new Set();
  for (const relativeFile of relativeFiles) {
    let current = path.dirname(relativeFile);
    while (current && current !== ".") {
      dirs.add(current);
      current = path.dirname(current);
    }
  }
  return Array.from(dirs).sort((a, b) => b.length - a.length);
}

function pruneEmptyDirs(targetRoot, relativeDirs, dryRun) {
  let removed = 0;
  for (const relativeDir of relativeDirs) {
    const absDir = path.join(targetRoot, relativeDir);
    if (!fs.existsSync(absDir)) {
      continue;
    }
    const stats = fs.lstatSync(absDir);
    if (!stats.isDirectory()) {
      continue;
    }
    const entries = fs.readdirSync(absDir);
    if (entries.length > 0) {
      continue;
    }
    if (!dryRun) {
      fs.rmdirSync(absDir);
    }
    removed += 1;
  }
  return removed;
}

const { target, dryRun, force, removeEnv } = parseArgs(process.argv.slice(2));

if (!fs.existsSync(sourceRoot)) {
  console.error(`ERROR: source .opencode directory missing at ${sourceRoot}`);
  process.exit(2);
}

const targetRoot = path.resolve(repoRoot, target);
const files = listFilesRecursive(sourceRoot);
const relativeDirs = uniqueParentDirs(files);

const summary = {
  removed: 0,
  kept: 0,
  skipped: 0,
  missing: 0,
  dirsRemoved: 0,
  envRemoved: 0
};

for (const relativeFile of files) {
  const src = path.join(sourceRoot, relativeFile);
  const dst = path.join(targetRoot, relativeFile);
  const action = removeIfEligible(src, dst, force, dryRun);

  if (action === "removed") summary.removed += 1;
  if (action === "kept") summary.kept += 1;
  if (action === "skipped") summary.skipped += 1;
  if (action === "missing") summary.missing += 1;
}

if (removeEnv) {
  const envPath = path.join(targetRoot, ".env");
  if (fs.existsSync(envPath) && fs.lstatSync(envPath).isFile()) {
    if (!dryRun) {
      fs.unlinkSync(envPath);
    }
    summary.envRemoved = 1;
  }
}

summary.dirsRemoved = pruneEmptyDirs(targetRoot, relativeDirs, dryRun);

console.log(`Uninstall target: ${toPosix(targetRoot)}`);
console.log(`Force: ${force ? "yes" : "no"}${dryRun ? " (dry-run)" : ""}`);
console.log(`Removed files: ${summary.removed}`);
console.log(`Kept files: ${summary.kept}`);
console.log(`Skipped paths: ${summary.skipped}`);
console.log(`Missing paths: ${summary.missing}`);
console.log(`Removed empty directories: ${summary.dirsRemoved}`);
if (removeEnv) {
  console.log(`Removed env file: ${summary.envRemoved}`);
}
if (summary.kept > 0 && !force) {
  console.log("Note: kept files are non-matching files/symlinks. Use --force to remove them.");
}

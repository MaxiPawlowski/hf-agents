#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, ".opencode");

function parseArgs(argv) {
  const args = {
    target: ".opencode.local",
    collision: "backup",
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--target" && argv[i + 1]) {
      args.target = argv[i + 1];
      i += 1;
    } else if (current === "--collision" && argv[i + 1]) {
      args.collision = argv[i + 1];
      i += 1;
    } else if (current === "--dry-run") {
      args.dryRun = true;
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function applyContextTransform(content, targetNamespace) {
  if (targetNamespace === ".opencode") {
    return content;
  }
  const normalized = toPosix(targetNamespace).replace(/\/+$/, "");
  const contextPrefix = `${normalized}/context/`;
  return content.replaceAll("@.opencode/context/", `@${contextPrefix}`);
}

function copyFileWithPolicy(sourceFile, targetFile, policy, backupDir, dryRun, installRoot, contextNamespace) {
  const exists = fs.existsSync(targetFile);

  if (!exists) {
    if (!dryRun) {
      ensureDir(path.dirname(targetFile));
      const raw = fs.readFileSync(sourceFile, "utf8");
      const transformed = sourceFile.endsWith(".md") ? applyContextTransform(raw, contextNamespace) : raw;
      fs.writeFileSync(targetFile, transformed, "utf8");
    }
    return { action: "created", target: targetFile };
  }

  if (policy === "skip") {
    return { action: "skipped", target: targetFile };
  }

  if (policy === "cancel") {
    return { action: "cancel", target: targetFile };
  }

  if (policy === "backup") {
    const relative = path.relative(installRoot, targetFile);
    const backupTarget = path.join(backupDir, relative);
    if (!dryRun) {
      ensureDir(path.dirname(backupTarget));
      fs.copyFileSync(targetFile, backupTarget);
    }
  }

  if (!dryRun) {
    const raw = fs.readFileSync(sourceFile, "utf8");
    const transformed = sourceFile.endsWith(".md") ? applyContextTransform(raw, contextNamespace) : raw;
    fs.writeFileSync(targetFile, transformed, "utf8");
  }
  return { action: policy === "overwrite" ? "overwritten" : "backup+overwritten", target: targetFile };
}

const { target, collision, dryRun } = parseArgs(process.argv.slice(2));
if (!["skip", "overwrite", "backup", "cancel"].includes(collision)) {
  console.error("ERROR: --collision must be one of: skip, overwrite, backup, cancel");
  process.exit(2);
}

if (!fs.existsSync(sourceRoot)) {
  console.error(`ERROR: source .opencode directory missing at ${sourceRoot}`);
  process.exit(2);
}

const targetRoot = path.resolve(repoRoot, target);
const contextNamespace = path.isAbsolute(target)
  ? ".opencode"
  : toPosix(target).replace(/\/+$/, "") || ".opencode";
const backupDir = path.resolve(repoRoot, `.opencode.backup.${new Date().toISOString().replace(/[:.]/g, "-")}`);
const files = listFilesRecursive(sourceRoot);

const summary = {
  created: 0,
  skipped: 0,
  overwritten: 0,
  backupOverwritten: 0,
  cancelled: false
};

for (const relativeFile of files) {
  const src = path.join(sourceRoot, relativeFile);
  const dst = path.join(targetRoot, relativeFile);
  const result = copyFileWithPolicy(src, dst, collision, backupDir, dryRun, targetRoot, contextNamespace);

  if (result.action === "cancel") {
    summary.cancelled = true;
    break;
  }
  if (result.action === "created") summary.created += 1;
  if (result.action === "skipped") summary.skipped += 1;
  if (result.action === "overwritten") summary.overwritten += 1;
  if (result.action === "backup+overwritten") summary.backupOverwritten += 1;
}

if (summary.cancelled) {
  console.log("Installation cancelled due to collision policy.");
  process.exit(1);
}

console.log(`Install target: ${toPosix(targetRoot)}`);
console.log(`Policy: ${collision}${dryRun ? " (dry-run)" : ""}`);
console.log(`Created: ${summary.created}`);
console.log(`Skipped: ${summary.skipped}`);
console.log(`Overwritten: ${summary.overwritten}`);
console.log(`Backup+Overwritten: ${summary.backupOverwritten}`);
if (summary.backupOverwritten > 0) {
  console.log(`Backup directory: ${toPosix(backupDir)}`);
}
if (path.isAbsolute(target)) {
  console.log("Note: absolute --target keeps @.opencode/context references for portability.");
}

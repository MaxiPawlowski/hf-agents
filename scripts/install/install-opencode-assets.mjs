#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, ".opencode");

function printHelp() {
  console.log("Install OpenCode assets from this repo's .opencode directory.");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/install/install-opencode-assets.mjs [--target <path>] [--mode symlink|copy] [--collision skip|overwrite|backup|cancel] [--dry-run]");
  console.log("");
  console.log("Options:");
  console.log("  --target <path>      Install destination (default: .opencode.local)");
  console.log("  --mode <mode>        symlink (default) or copy");
  console.log("  --collision <policy> skip | overwrite | backup (default) | cancel");
  console.log("  --dry-run            Print actions without writing");
  console.log("  --help               Show this help");
  console.log("");
  console.log("Notes:");
  console.log("  - On Windows, symlink mode may require Admin or Developer Mode.");
  console.log("    If symlink creation fails, retry with: --mode copy");
  console.log("  - Absolute --target keeps @.opencode/context references for portability.");
}

function parseArgs(argv) {
  const args = {
    target: ".opencode.local",
    collision: "backup",
    dryRun: false,
    mode: "symlink",
    help: false
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
    } else if (current === "--mode" && argv[i + 1]) {
      args.mode = argv[i + 1];
      i += 1;
    } else if (current === "--help" || current === "-h") {
      args.help = true;
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

function removePath(targetPath, dryRun) {
  if (dryRun) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function backupPath(targetPath, backupDir, installRoot, dryRun) {
  const relative = path.relative(installRoot, targetPath);
  const backupTarget = path.join(backupDir, relative);
  if (!dryRun) {
    ensureDir(path.dirname(backupTarget));
    fs.renameSync(targetPath, backupTarget);
  }
}

function isSymlinkTo(targetPath, sourceFile) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const stats = fs.lstatSync(targetPath);
  if (!stats.isSymbolicLink()) {
    return false;
  }

  try {
    const resolvedTarget = fs.realpathSync(targetPath);
    const resolvedSource = fs.realpathSync(sourceFile);
    return resolvedTarget === resolvedSource;
  } catch {
    return false;
  }
}

function linkFileWithPolicy(sourceFile, targetFile, policy, backupDir, dryRun, installRoot) {
  if (!fs.existsSync(targetFile)) {
    if (!dryRun) {
      ensureDir(path.dirname(targetFile));
      try {
        fs.symlinkSync(sourceFile, targetFile, "file");
      } catch (error) {
        const message = (error && error.message) || String(error);
        if (process.platform === "win32") {
          throw new Error(
            `Failed to create symlink on Windows: ${message}\n` +
              "Tip: enable Developer Mode or run as Administrator, or retry with --mode copy."
          );
        }
        throw new Error(`Failed to create symlink: ${message}`);
      }
    }
    return { action: "linked", target: targetFile };
  }

  if (isSymlinkTo(targetFile, sourceFile)) {
    return { action: "linked-unchanged", target: targetFile };
  }

  if (policy === "skip") {
    return { action: "skipped", target: targetFile };
  }

  if (policy === "cancel") {
    return { action: "cancel", target: targetFile };
  }

  if (policy === "backup") {
    backupPath(targetFile, backupDir, installRoot, dryRun);
  } else {
    removePath(targetFile, dryRun);
  }

  if (!dryRun) {
    ensureDir(path.dirname(targetFile));
    try {
      fs.symlinkSync(sourceFile, targetFile, "file");
    } catch (error) {
      const message = (error && error.message) || String(error);
      if (process.platform === "win32") {
        throw new Error(
          `Failed to create symlink on Windows: ${message}\n` +
            "Tip: enable Developer Mode or run as Administrator, or retry with --mode copy."
        );
      }
      throw new Error(`Failed to create symlink: ${message}`);
    }
  }

  return {
    action: policy === "overwrite" ? "linked-overwritten" : "linked-backup+overwritten",
    target: targetFile
  };
}


try {
  const { target, collision, dryRun, mode, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printHelp();
    process.exit(0);
  }
  if (!["skip", "overwrite", "backup", "cancel"].includes(collision)) {
    console.error("ERROR: --collision must be one of: skip, overwrite, backup, cancel");
    console.error("Run with --help for usage.");
    process.exit(2);
  }

  if (!["copy", "symlink"].includes(mode)) {
    console.error("ERROR: --mode must be one of: copy, symlink");
    console.error("Run with --help for usage.");
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
    linked: 0,
    linkedUnchanged: 0,
    linkedOverwritten: 0,
    backupOverwritten: 0,
    cancelled: false
  };

  for (const relativeFile of files) {
    const src = path.join(sourceRoot, relativeFile);
    const dst = path.join(targetRoot, relativeFile);
    const result =
      mode === "symlink"
        ? linkFileWithPolicy(src, dst, collision, backupDir, dryRun, targetRoot)
        : copyFileWithPolicy(src, dst, collision, backupDir, dryRun, targetRoot, contextNamespace);

    if (result.action === "cancel") {
      summary.cancelled = true;
      break;
    }
    if (result.action === "created") summary.created += 1;
    if (result.action === "skipped") summary.skipped += 1;
    if (result.action === "overwritten") summary.overwritten += 1;
    if (result.action === "linked") summary.linked += 1;
    if (result.action === "linked-unchanged") summary.linkedUnchanged += 1;
    if (result.action === "linked-overwritten") summary.linkedOverwritten += 1;
    if (result.action === "linked-backup+overwritten") summary.backupOverwritten += 1;
    if (result.action === "backup+overwritten") summary.backupOverwritten += 1;
  }

  if (summary.cancelled) {
    console.log("Installation cancelled due to collision policy.");
    process.exit(1);
  }

  console.log(`Install target: ${toPosix(targetRoot)}`);
  console.log(`Mode: ${mode}`);
  console.log(`Policy: ${collision}${dryRun ? " (dry-run)" : ""}`);
  console.log(`Created: ${summary.created}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Overwritten: ${summary.overwritten}`);
  console.log(`Linked: ${summary.linked}`);
  console.log(`Linked unchanged: ${summary.linkedUnchanged}`);
  console.log(`Linked overwritten: ${summary.linkedOverwritten}`);
  console.log(`Backup+Overwritten: ${summary.backupOverwritten}`);
  if (summary.backupOverwritten > 0) {
    console.log(`Backup directory: ${toPosix(backupDir)}`);
  }
  if (path.isAbsolute(target)) {
    console.log("Note: absolute --target keeps @.opencode/context references for portability.");
  }
} catch (error) {
  console.error("ERROR: install failed");
  console.error((error && error.message) || String(error));
  process.exit(2);
}

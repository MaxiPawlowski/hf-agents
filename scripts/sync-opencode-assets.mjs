#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const agentSources = [
  "agents/hf-planner.md",
  "agents/hf-builder.md",
  "subagents/hf-coder.md",
  "subagents/hf-plan-reviewer.md",
  "subagents/hf-reviewer.md"
];

const skillDirectories = [
  "skills/local-context",
  "skills/milestone-tracking",
  "skills/plan-synthesis",
  "skills/verification-before-completion"
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv) {
  const options = {
    sourceRoot,
    targetRoot: sourceRoot
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-root" && argv[index + 1]) {
      options.sourceRoot = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--target-root" && argv[index + 1]) {
      options.targetRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function createRelativeLinkTarget(sourcePath, targetPath) {
  return path.relative(path.dirname(targetPath), sourcePath);
}

function createFileLink(options, sourceRelativePath, targetRelativePath) {
  const sourcePath = path.join(options.sourceRoot, sourceRelativePath);
  const targetPath = path.join(options.targetRoot, ".opencode", targetRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.symlinkSync(createRelativeLinkTarget(sourcePath, targetPath), targetPath, "file");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "EPERM" || error.code === "EISDIR")) {
      fs.copyFileSync(sourcePath, targetPath);
      return;
    }
    throw error;
  }
}

function walkFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function syncAgents(options) {
  const targetDir = path.join(options.targetRoot, ".opencode", "agents");
  resetDir(targetDir);

  for (const source of agentSources) {
    createFileLink(options, source, path.join("agents", path.basename(source)));
  }

  log(`Linked ${agentSources.length} OpenCode agent files.`);
}

function syncSkills(options) {
  const targetDir = path.join(options.targetRoot, ".opencode", "skills");
  resetDir(targetDir);

  for (const sourceDir of skillDirectories) {
    const sourcePath = path.join(options.sourceRoot, sourceDir);
    const files = walkFiles(sourcePath);
    for (const filePath of files) {
      const relativePath = path.relative(options.sourceRoot, filePath);
      createFileLink(options, relativePath, relativePath);
    }
  }

  log(`Linked ${skillDirectories.length} OpenCode skills.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  syncAgents(options);
  syncSkills(options);
}

main();

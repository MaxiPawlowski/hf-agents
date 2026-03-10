#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opencodeRoot = path.join(repoRoot, ".opencode");

const agentSources = [
  "agents/hf-planner.md",
  "agents/hf-builder.md",
  "subagents/hf-coder.md",
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

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function createRelativeLinkTarget(sourcePath, targetPath) {
  return path.relative(path.dirname(targetPath), sourcePath);
}

function createFileLink(sourceRelativePath, targetRelativePath) {
  const sourcePath = path.join(repoRoot, sourceRelativePath);
  const targetPath = path.join(opencodeRoot, targetRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.symlinkSync(createRelativeLinkTarget(sourcePath, targetPath), targetPath, "file");
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

function syncAgents() {
  const targetDir = path.join(opencodeRoot, "agents");
  resetDir(targetDir);

  for (const source of agentSources) {
    createFileLink(source, path.join("agents", path.basename(source)));
  }

  log(`Linked ${agentSources.length} OpenCode agent files.`);
}

function syncSkills() {
  const targetDir = path.join(opencodeRoot, "skills");
  resetDir(targetDir);

  for (const sourceDir of skillDirectories) {
    const sourcePath = path.join(repoRoot, sourceDir);
    const files = walkFiles(sourcePath);
    for (const filePath of files) {
      const relativePath = path.relative(repoRoot, filePath);
      createFileLink(relativePath, relativePath);
    }
  }

  log(`Linked ${skillDirectories.length} OpenCode skills.`);
}

function main() {
  syncAgents();
  syncSkills();
}

main();

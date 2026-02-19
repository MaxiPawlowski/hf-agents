#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const includeRoots = [
  path.join(repoRoot, ".opencode", "agents"),
  path.join(repoRoot, ".opencode", "commands"),
  path.join(repoRoot, ".opencode", "context"),
  path.join(repoRoot, ".opencode", "skills")
];

function walkMarkdownFiles(dirPath, files) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && fullPath.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
}

function findReferenceViolations(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const references = line.match(/@[A-Za-z0-9_./~$:-]+/g) || [];
    for (const ref of references) {
      if (!ref.includes("context/")) {
        continue;
      }
      if (!ref.startsWith("@.opencode/context/")) {
        violations.push({
          line: i + 1,
          ref
        });
      }
    }
  }

  return violations;
}

const markdownFiles = [];
for (const root of includeRoots) {
  walkMarkdownFiles(root, markdownFiles);
}

const allViolations = [];
for (const filePath of markdownFiles) {
  const violations = findReferenceViolations(filePath);
  for (const violation of violations) {
    allViolations.push({ filePath, ...violation });
  }
}

if (allViolations.length > 0) {
  console.error("Context reference convention violations found:");
  for (const violation of allViolations) {
    const relativePath = path.relative(repoRoot, violation.filePath).replaceAll("\\", "/");
    console.error(`- ${relativePath}:${violation.line} -> ${violation.ref}`);
  }
  console.error("Convention: use @.opencode/context/path/to/file.md");
  process.exit(1);
}

console.log(`Context reference validation passed (${markdownFiles.length} markdown files scanned).`);

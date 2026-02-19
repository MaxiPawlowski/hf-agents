#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const commandsRoot = path.join(repoRoot, ".opencode", "commands");

const requiredSections = [
  "## Purpose",
  "## Preconditions",
  "## Execution Contract",
  "## Required Output",
  "## Failure Contract"
];

if (!fs.existsSync(commandsRoot)) {
  console.error(`Command contracts directory not found: ${commandsRoot}`);
  process.exit(2);
}

const files = fs
  .readdirSync(commandsRoot)
  .filter((entry) => entry.toLowerCase().endsWith(".md"))
  .map((entry) => path.join(commandsRoot, entry));

const findings = [];

for (const filePath of files) {
  const relativePath = path.relative(repoRoot, filePath).replaceAll("\\", "/");
  const text = fs.readFileSync(filePath, "utf8");

  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    findings.push(`${relativePath}: missing YAML frontmatter block`);
  }

  for (const section of requiredSections) {
    if (!new RegExp(`^${section}$`, "m").test(text)) {
      findings.push(`${relativePath}: missing section ${section}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Command contract lint failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Command contract lint passed (${files.length} files).`);

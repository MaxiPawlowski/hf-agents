#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const agentsRoot = path.join(repoRoot, ".opencode", "agents");

const requiredSections = [
  "## Purpose",
  "## Boundaries",
  "## Preconditions",
  "## Execution Contract",
  "## Required Output",
  "## Failure Contract"
];

const forbiddenSections = [
  "## Output contract",
  "## Responsibilities",
  "## Constraints",
  "## Execution rules"
];

if (!fs.existsSync(agentsRoot)) {
  console.error(`Agent contracts directory not found: ${agentsRoot}`);
  process.exit(2);
}

const files = fs
  .readdirSync(agentsRoot)
  .filter((entry) => entry.toLowerCase().endsWith(".md"))
  .map((entry) => path.join(agentsRoot, entry));

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

  for (const section of forbiddenSections) {
    if (new RegExp(`^${section}$`, "m").test(text)) {
      findings.push(`${relativePath}: deprecated section ${section} (use contract template headings)`);
    }
  }
}

if (findings.length > 0) {
  console.error("Agent contract lint failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Agent contract lint passed (${files.length} files).`);

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, ".opencode", "skills");

const requiredSections = [
  "## Overview",
  "## When to Use",
  "## When Not to Use",
  "## Workflow",
  "## Verification",
  "## Failure Behavior",
  "## Integration",
  "## Examples",
  "## Red Flags"
];

function listSkillFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(root, entry.name, "SKILL.md");
    if (fs.existsSync(filePath)) {
      files.push(filePath);
    }
  }
  return files;
}

const files = listSkillFiles(skillsRoot);
if (files.length === 0) {
  console.error(`No skills found under: ${skillsRoot}`);
  process.exit(2);
}

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

  if (!/^Iron law:/m.test(text)) {
    findings.push(`${relativePath}: missing 'Iron law:' statement`);
  }

  const hasVerificationCommand = /^- Run: `.+`/m.test(text) || /^- Run: .+/m.test(text);
  if (!hasVerificationCommand) {
    findings.push(`${relativePath}: verification section should include at least one '- Run: <command>' line`);
  }
}

if (findings.length > 0) {
  console.error("Skill contract lint failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Skill contract lint passed (${files.length} skills).`);

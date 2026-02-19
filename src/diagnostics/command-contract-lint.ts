import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  markdownContractLintResultSchema,
  type MarkdownContractLintFinding,
  type MarkdownContractLintResult
} from "../contracts/index.js";

const REQUIRED_SECTIONS: Array<{ heading: string; rule: MarkdownContractLintFinding["rule"] }> = [
  { heading: "## Purpose", rule: "purpose" },
  { heading: "## Preconditions", rule: "preconditions" },
  { heading: "## Execution Contract", rule: "execution-contract" },
  { heading: "## Required Output", rule: "required-output" },
  { heading: "## Failure Contract", rule: "failure-contract" }
];

function listCommandFiles(commandsRoot: string): string[] {
  if (!existsSync(commandsRoot)) {
    return [];
  }
  return readdirSync(commandsRoot)
    .filter((entry) => entry.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(commandsRoot, entry));
}

function lintSingleFile(filePath: string, repoRoot: string): MarkdownContractLintResult {
  const relativePath = path.relative(repoRoot, filePath).replaceAll("\\", "/");
  const text = readFileSync(filePath, "utf8");
  const findings: MarkdownContractLintFinding[] = [];

  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    findings.push({
      filePath: relativePath,
      rule: "frontmatter",
      message: "Missing YAML frontmatter block."
    });
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^${section.heading}$`, "m").test(text)) {
      findings.push({
        filePath: relativePath,
        rule: section.rule,
        message: `Missing section: ${section.heading}`
      });
    }
  }

  return markdownContractLintResultSchema.parse({
    filePath: relativePath,
    ok: findings.length === 0,
    findings
  });
}

export function lintCommandContracts(repoRoot = process.cwd()): {
  scanned: number;
  ok: boolean;
  results: MarkdownContractLintResult[];
} {
  const commandsRoot = path.join(repoRoot, ".opencode", "commands");
  const files = listCommandFiles(commandsRoot);
  const results = files.map((filePath) => lintSingleFile(filePath, repoRoot));
  const ok = results.every((result) => result.ok);
  return {
    scanned: files.length,
    ok,
    results
  };
}

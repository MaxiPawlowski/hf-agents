import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { diagnosticsReportSchema, type DiagnosticsItem, type DiagnosticsReport } from "../contracts/index.js";
import { lintCommandContracts } from "./command-contract-lint.js";
import { listSkills } from "../skills/skill-engine.js";
import { loadPolicy, policyFileForMode } from "../policies/policy-loader.js";

function buildPolicyItem(repoRoot: string): DiagnosticsItem {
  const modes = ["fast", "balanced", "strict"] as const;
  const details: string[] = [];
  let failed = false;

  for (const mode of modes) {
    const filePath = path.join(repoRoot, policyFileForMode(mode));
    if (!existsSync(filePath)) {
      failed = true;
      details.push(`Missing policy file: ${policyFileForMode(mode)}`);
      continue;
    }
    try {
      loadPolicy(filePath);
      details.push(`Parsed policy: ${policyFileForMode(mode)}`);
    } catch (error) {
      failed = true;
      details.push(`Invalid policy (${mode}): ${(error as Error).message}`);
    }
  }

  return {
    id: "policy",
    status: failed ? "fail" : "pass",
    summary: failed ? "Policy checks failed." : "Policy files are present and parse correctly.",
    details
  };
}

function buildRegistryItem(repoRoot: string): DiagnosticsItem {
  const registryPath = path.join(repoRoot, ".opencode", "registry.json");
  if (!existsSync(registryPath)) {
    return {
      id: "registry",
      status: "fail",
      summary: "Registry file is missing.",
      details: ["Missing .opencode/registry.json"]
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as { assets?: Array<{ path?: string }> };
    const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    const missingPaths = assets
      .map((asset) => asset.path)
      .filter((assetPath): assetPath is string => typeof assetPath === "string")
      .filter((assetPath) => !existsSync(path.join(repoRoot, assetPath)));

    if (missingPaths.length > 0) {
      return {
        id: "registry",
        status: "fail",
        summary: "Registry references missing files.",
        details: missingPaths.map((entry) => `Missing asset path: ${entry}`)
      };
    }

    return {
      id: "registry",
      status: "pass",
      summary: `Registry parsed (${assets.length} assets).`,
      details: []
    };
  } catch (error) {
    return {
      id: "registry",
      status: "fail",
      summary: "Registry parse failed.",
      details: [(error as Error).message]
    };
  }
}

function buildCommandContractItem(repoRoot: string): DiagnosticsItem {
  const lint = lintCommandContracts(repoRoot);
  const failing = lint.results.filter((result) => !result.ok);

  if (failing.length === 0) {
    return {
      id: "command-contracts",
      status: "pass",
      summary: `Command contracts lint passed (${lint.scanned} files).`,
      details: []
    };
  }

  return {
    id: "command-contracts",
    status: "fail",
    summary: `Command contracts lint failed (${failing.length}/${lint.scanned} files).`,
    details: failing.flatMap((entry) => entry.findings.map((finding) => `${finding.filePath}: ${finding.message}`))
  };
}

function buildSkillsItem(repoRoot: string): DiagnosticsItem {
  const registryPath = path.join(repoRoot, ".opencode", "registry.json");
  const runtimeSkillIds = listSkills().map((skill) => skill.id);

  let registrySkillIds: string[] = [];
  if (existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as {
        assets?: Array<{ id?: string; type?: string }>;
      };
      registrySkillIds = (parsed.assets ?? [])
        .filter((asset) => asset.type === "skill" && typeof asset.id === "string")
        .map((asset) => String(asset.id).replace(/^skill-/, "hf-"));
    } catch {
      registrySkillIds = [];
    }
  }

  const allSkillIds = Array.from(new Set([...runtimeSkillIds, ...registrySkillIds]));
  const missing = allSkillIds
    .map((skill) => ({
      id: skill,
      path: path.join(".opencode", "skills", skill.replace(/^hf-/, ""), "SKILL.md")
    }))
    .filter((entry) => !existsSync(path.join(repoRoot, entry.path)));

  const missingFromRuntime = registrySkillIds.filter((id) => !runtimeSkillIds.includes(id));

  if (missing.length === 0 && missingFromRuntime.length === 0) {
    return {
      id: "skills",
      status: "pass",
      summary: "All skills are consistent across runtime, registry, and markdown artifacts.",
      details: []
    };
  }

  return {
    id: "skills",
    status: "fail",
    summary: "Skill registry/runtime drift detected.",
    details: [
      ...missing.map((entry) => `${entry.id} -> missing artifact at ${entry.path}`),
      ...missingFromRuntime.map((id) => `${id} -> present in registry but missing in src/skills/skill-engine.ts`)
    ]
  };
}

function buildOptionalArtifactsItem(repoRoot: string): DiagnosticsItem {
  const hooksPath = path.join(repoRoot, "hooks", "hooks.json");
  const lifecyclePath = path.join(repoRoot, ".tmp", "task-lifecycle.json");
  const details: string[] = [];

  if (existsSync(hooksPath)) {
    details.push("hooks/hooks.json present.");
  } else {
    details.push("hooks/hooks.json missing (optional).");
  }

  if (existsSync(lifecyclePath)) {
    details.push(".tmp/task-lifecycle.json present.");
  } else {
    details.push(".tmp/task-lifecycle.json missing (created on first task lifecycle write).");
  }

  const warned = !existsSync(hooksPath) || !existsSync(lifecyclePath);
  return {
    id: "optional-artifacts",
    status: warned ? "warn" : "pass",
    summary: warned ? "Optional artifacts have gaps." : "Optional artifacts are present.",
    details
  };
}

export function generateDiagnosticsReport(repoRoot = process.cwd()): DiagnosticsReport {
  const items = [
    buildPolicyItem(repoRoot),
    buildRegistryItem(repoRoot),
    buildCommandContractItem(repoRoot),
    buildSkillsItem(repoRoot),
    buildOptionalArtifactsItem(repoRoot)
  ];

  return diagnosticsReportSchema.parse({
    jsonVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: items.every((item) => item.status === "pass" || item.status === "warn"),
    items
  });
}

export function formatDiagnosticsReport(report: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push(`Diagnostics: ${report.ok ? "OK" : "FAILED"}`);
  for (const item of report.items) {
    lines.push(`[${item.status.toUpperCase()}] ${item.id}: ${item.summary}`);
    for (const detail of item.details) {
      lines.push(`  - ${detail}`);
    }
  }
  return lines.join("\n");
}

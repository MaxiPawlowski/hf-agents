import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { diagnosticsReportSchema, type DiagnosticsItem, type DiagnosticsReport } from "../contracts/index.js";
import { lintCommandContracts } from "./command-contract-lint.js";
import { listSkills } from "../skills/skill-engine.js";
import {
  loadBackgroundTaskConfig,
  loadMcpIntegrations,
  loadPolicy,
  policyFileForMode
} from "../policies/policy-loader.js";

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
  const missing = listSkills()
    .map((skill) => ({
      id: skill.id,
      path: path.join(".opencode", "skills", skill.id.replace(/^hf-/, ""), "SKILL.md")
    }))
    .filter((entry) => !existsSync(path.join(repoRoot, entry.path)));

  if (missing.length === 0) {
    return {
      id: "skills",
      status: "pass",
      summary: "All registered skills have markdown artifacts.",
      details: []
    };
  }

  return {
    id: "skills",
    status: "fail",
    summary: "Some skill artifacts are missing.",
    details: missing.map((entry) => `${entry.id} -> ${entry.path}`)
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

function buildRuntimeIntegrationsItem(repoRoot: string): DiagnosticsItem {
  try {
    const policy = loadPolicy(path.join(repoRoot, policyFileForMode("fast")));
    const background = loadBackgroundTaskConfig(policy);
    const mcp = loadMcpIntegrations(policy);

    return {
      id: "runtime-integrations",
      status: "pass",
      summary: "Background runtime and MCP integrations are configured.",
      details: [
        `background.defaultConcurrency=${background.defaultConcurrency}`,
        `background.staleTimeoutMs=${background.staleTimeoutMs}`,
        `mcp.tavily=${mcp.tavily.enabled ? "enabled" : "disabled"} (maxResults=${mcp.tavily.maxResults})`,
        `mcp.ghGrep=${mcp.ghGrep.enabled ? "enabled" : "disabled"} (maxResults=${mcp.ghGrep.maxResults})`
      ]
    };
  } catch (error) {
    return {
      id: "runtime-integrations",
      status: "fail",
      summary: "Runtime integration checks failed.",
      details: [(error as Error).message]
    };
  }
}

export function generateDiagnosticsReport(repoRoot = process.cwd()): DiagnosticsReport {
  const items = [
    buildPolicyItem(repoRoot),
    buildRegistryItem(repoRoot),
    buildCommandContractItem(repoRoot),
    buildSkillsItem(repoRoot),
    buildOptionalArtifactsItem(repoRoot),
    buildRuntimeIntegrationsItem(repoRoot)
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

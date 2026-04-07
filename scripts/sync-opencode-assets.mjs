#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFileName = "hybrid-framework.json";

const generatedOpenCodeAgentSources = [
  "agents/hf-planner.md",
  "agents/hf-builder.md",
  "subagents/hf-coder.md",
  "subagents/hf-plan-reviewer.md",
  "subagents/hf-reviewer.md"
];

const generatedOpenCodeSkillDirectories = [
  "skills/local-context",
  "skills/milestone-tracking",
  "skills/plan-synthesis",
  "skills/verification-before-completion"
];

function stripDisableModelInvocation(content) {
  return content.replace(/^disable-model-invocation:.*\r?\n/m, "");
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function applyArgToOptions(argv, index, options) {
  const arg = argv[index];
  if (arg === "--source-root" && argv[index + 1]) {
    options.sourceRoot = path.resolve(argv[index + 1]);
    return index + 1;
  }
  if (arg === "--target-root" && argv[index + 1]) {
    options.targetRoot = path.resolve(argv[index + 1]);
    return index + 1;
  }
  if (arg === "--config" && argv[index + 1]) {
    options.configPath = path.resolve(argv[index + 1]);
    return index + 1;
  }
  if (arg === "--tool" && argv[index + 1]) {
    options.tool = argv[index + 1];
    return index + 1;
  }
  return index;
}

function parseArgs(argv) {
  const options = {
    sourceRoot,
    targetRoot: sourceRoot,
    configPath: null,
    tool: "all"
  };

  let index = 0;
  while (index < argv.length) {
    const consumed = applyArgToOptions(argv, index, options);
    index = consumed + 1;
  }

  if (!["all", "claude", "opencode"].includes(options.tool)) {
    throw new Error(`Unsupported --tool value: ${options.tool}`);
  }

  return options;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    // eslint-disable-next-line no-restricted-syntax -- plain JS script; typeof is unavoidable without TypeScript type guards
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function getConfigPath(options) {
  return options.configPath ?? path.join(options.targetRoot, configFileName);
}

function loadProjectConfig(options) {
  return readJson(getConfigPath(options), {});
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

function removeIfPresent(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function resetDir(dirPath) {
  removeIfPresent(dirPath);
  fs.mkdirSync(dirPath, { recursive: true });
}

function createRelativeLinkTarget(sourcePath, targetPath) {
  return path.relative(path.dirname(targetPath), sourcePath);
}

function trySymlink(sourcePath, targetPath, allowFallback) {
  try {
    fs.symlinkSync(createRelativeLinkTarget(sourcePath, targetPath), targetPath, "file");
    return "symlink";
  } catch (error) {
    if (
      allowFallback
      && error
      // eslint-disable-next-line no-restricted-syntax -- plain JS script; typeof is unavoidable without TypeScript type guards
      && typeof error === "object"
      && "code" in error
      && ["EPERM", "EISDIR", "EXDEV", "UNKNOWN"].includes(error.code)
    ) {
      fs.copyFileSync(sourcePath, targetPath);
      return "copy";
    }

    throw error;
  }
}

// oxlint-disable-next-line max-params -- internal helper; params are positional and tightly coupled
function materializeFile(options, sourceRelativePath, targetRelativePath, stats, transform) {
  const sourcePath = path.join(options.sourceRoot, sourceRelativePath);
  const targetPath = path.join(options.targetRoot, targetRelativePath);

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Source asset does not exist: ${sourceRelativePath}`);
  }

  removeIfPresent(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (transform) {
    const content = fs.readFileSync(sourcePath, "utf8");
    fs.writeFileSync(targetPath, transform(content), "utf8");
    stats.copied += 1;
    return;
  }

  if (options.mode === "copy") {
    fs.copyFileSync(sourcePath, targetPath);
    stats.copied += 1;
    return;
  }

  const result = trySymlink(sourcePath, targetPath, options.mode === "references");
  if (result === "symlink") {
    stats.symlinked += 1;
    return;
  }

  stats.copied += 1;
}

function resolveAssetMode(config) {
  const mode = config.assets?.mode ?? "references";
  if (!["references", "copy", "symlink"].includes(mode)) {
    throw new Error(`Unsupported assets.mode value: ${mode}`);
  }
  return mode;
}

function resolveAdapters(config) {
  return {
    claude: config.adapters?.claude?.enabled ?? true,
    opencode: config.adapters?.opencode?.enabled ?? true
  };
}

function applyToolSelection(adapters, tool) {
  if (tool === "claude") {
    return {
      claude: adapters.claude,
      opencode: false
    };
  }

  if (tool === "opencode") {
    return {
      claude: false,
      opencode: adapters.opencode
    };
  }

  return adapters;
}

function normalizeConfiguredAssets(configuredAssets) {
  if (configuredAssets === undefined) {
    return [];
  }

  if (!Array.isArray(configuredAssets)) {
    throw new Error("Configured asset lists must be arrays of canonical markdown paths.");
  }

  return [...new Set(configuredAssets.map((value) => {
    // eslint-disable-next-line no-restricted-syntax -- plain JS script; typeof is unavoidable without TypeScript type guards
    if (typeof value !== "string") {
      throw new Error("Configured asset lists must contain only string paths.");
    }

    const normalized = value.split("/").join(path.sep);
    const relativePath = normalized.split(path.sep).join("/");
    if (!relativePath.endsWith(".md")) {
      throw new Error(`Configured asset must be a markdown file: ${value}`);
    }

    const topLevelDir = relativePath.split("/")[0];
    if (!["agents", "subagents", "skills"].includes(topLevelDir)) {
      throw new Error(`Configured asset must live under agents/, subagents/, or skills/: ${value}`);
    }

    return relativePath;
  }))];
}

function mapConfiguredAsset(adapter, sourceRelativePath) {
  if (adapter === "opencode") {
    if (sourceRelativePath.startsWith("skills/")) {
      return path.posix.join(".opencode", sourceRelativePath);
    }

    return path.posix.join(".opencode", "agents", path.basename(sourceRelativePath));
  }

  if (sourceRelativePath.startsWith("skills/")) {
    return path.posix.join(".claude", sourceRelativePath);
  }

  return path.posix.join(".claude", "agents", path.basename(sourceRelativePath));
}

function buildConfiguredMappings(adapter, configuredAssets) {
  const mappings = [];
  const seenTargets = new Map();

  for (const sourceRelativePath of normalizeConfiguredAssets(configuredAssets)) {
    const targetRelativePath = mapConfiguredAsset(adapter, sourceRelativePath);
    const previous = seenTargets.get(targetRelativePath);
    if (previous) {
      throw new Error(
        `Configured ${adapter} assets collide at ${targetRelativePath}: ${previous} and ${sourceRelativePath}`
      );
    }

    seenTargets.set(targetRelativePath, sourceRelativePath);
    mappings.push({ sourceRelativePath, targetRelativePath });
  }

  return mappings;
}

// oxlint-disable-next-line max-params -- internal helper; params are positional and tightly coupled
function syncMappings(options, mappings, label, transform) {
  const dedupedMappings = [];
  const seenTargets = new Set();

  for (const mapping of mappings) {
    if (seenTargets.has(mapping.targetRelativePath)) {
      continue;
    }

    seenTargets.add(mapping.targetRelativePath);
    dedupedMappings.push(mapping);
  }

  const stats = { copied: 0, symlinked: 0 };

  for (const mapping of dedupedMappings) {
    materializeFile(options, mapping.sourceRelativePath, mapping.targetRelativePath, stats, transform);
  }

  log(`${label}: ${dedupedMappings.length} files (${stats.symlinked} symlinked, ${stats.copied} copied).`);
}

function buildGeneratedAgentMappings() {
  return generatedOpenCodeAgentSources.map((sourceRelativePath) => ({
    sourceRelativePath,
    targetRelativePath: path.posix.join(".opencode", "agents", path.basename(sourceRelativePath))
  }));
}

function buildGeneratedSkillMappings(sourceRoot) {
  const skillMappings = [];
  for (const sourceDir of generatedOpenCodeSkillDirectories) {
    const sourcePath = path.join(sourceRoot, sourceDir);
    for (const filePath of walkFiles(sourcePath)) {
      const relativePath = path.relative(sourceRoot, filePath).split(path.sep).join("/");
      skillMappings.push({
        sourceRelativePath: relativePath,
        targetRelativePath: path.posix.join(".opencode", relativePath)
      });
    }
  }
  return skillMappings;
}

function syncOpenCode(options, config) {
  const shouldSyncGenerated = config.assets?.opencode?.syncGenerated ?? true;
  const configuredMappings = buildConfiguredMappings("opencode", config.assets?.opencode?.copy);
  const opencodeRoot = path.join(options.targetRoot, ".opencode");

  fs.mkdirSync(opencodeRoot, { recursive: true });

  if (shouldSyncGenerated || configuredMappings.some((mapping) => mapping.targetRelativePath.startsWith(".opencode/agents/"))) {
    resetDir(path.join(opencodeRoot, "agents"));
  }

  if (shouldSyncGenerated || configuredMappings.some((mapping) => mapping.targetRelativePath.startsWith(".opencode/skills/"))) {
    resetDir(path.join(opencodeRoot, "skills"));
  }

  const agentMappings = shouldSyncGenerated ? buildGeneratedAgentMappings() : [];
  const skillMappings = shouldSyncGenerated ? buildGeneratedSkillMappings(options.sourceRoot) : [];

  for (const mapping of configuredMappings) {
    if (mapping.targetRelativePath.startsWith(".opencode/skills/")) {
      skillMappings.push(mapping);
      continue;
    }

    agentMappings.push(mapping);
  }

  syncMappings(options, agentMappings, "OpenCode agents");
  syncMappings(options, skillMappings, "OpenCode skills", stripDisableModelInvocation);
}

function syncClaude(options, config) {
  const configuredMappings = buildConfiguredMappings("claude", config.assets?.claude?.copy);
  const claudeRoot = path.join(options.targetRoot, ".claude");

  if (configuredMappings.length === 0) {
    log("Claude assets: 0 files (0 symlinked, 0 copied).");
    return;
  }

  fs.mkdirSync(claudeRoot, { recursive: true });

  const agentMappings = configuredMappings.filter((mapping) => mapping.targetRelativePath.startsWith(".claude/agents/"));
  const skillMappings = configuredMappings.filter((mapping) => mapping.targetRelativePath.startsWith(".claude/skills/"));

  if (agentMappings.length > 0) {
    resetDir(path.join(claudeRoot, "agents"));
  }

  if (skillMappings.length > 0) {
    resetDir(path.join(claudeRoot, "skills"));
  }

  syncMappings(options, agentMappings, "Claude agents");
  syncMappings(options, skillMappings, "Claude skills");
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const config = loadProjectConfig(parsed);
  const adapters = applyToolSelection(resolveAdapters(config), parsed.tool);
  const options = {
    ...parsed,
    mode: resolveAssetMode(config)
  };

  if (adapters.opencode) {
    syncOpenCode(options, config);
  } else {
    log("OpenCode assets skipped by config.");
  }

  if (adapters.claude) {
    syncClaude(options, config);
  } else {
    log("Claude assets skipped by config.");
  }
}

main();

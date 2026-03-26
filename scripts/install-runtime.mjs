#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), "..");
const packageJsonPath = path.join(sourceRoot, "package.json");
const lifecycleCommands = ["install", "init", "sync", "uninstall"];
const configFileName = "hybrid-framework.json";
const manifestRelativePath = path.join(".hybrid-framework", "generated-state.json");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function getInvokedCommand(argv) {
  const executableName = path.basename(process.argv[1] ?? "").replace(/\.(cjs|mjs|js)$/u, "");
  const aliasedCommand = executableName.replace(/^hf-/u, "");

  if (lifecycleCommands.includes(aliasedCommand)) {
    return aliasedCommand;
  }

  if (lifecycleCommands.includes(argv[0])) {
    return argv[0];
  }

  return "install";
}

function printHelp() {
  log("Hybrid Framework consumer lifecycle contract");
  log("");
  log("Commands:");
  log("  hf-install   Install adapter wiring into a target project.");
  log("  hf-init      Scaffold plans/vault workspace, then install adapter wiring.");
  log("  hf-sync      Refresh generated adapter assets from canonical root assets.");
  log("  hf-uninstall Remove generated framework artifacts from a target project.");
  log("");
  log("Options:");
  log("  --target-dir <path>  Target project root. Defaults to the current repo.");
  log("  --tool <all|claude|opencode>  Adapter selection for install/sync/uninstall.");
  log("  --config <path>      Optional path to hybrid-framework.json in the target project.");
  log("  --platform <windows|linux>  Claude command rendering override.");
  log("  --skip-build         Skip npm install + npm run build before install.");
  log("  --help               Print this contract summary.");
  log("");
  log("Target-project config contract: hybrid-framework.json");
  log("  adapters.claude.enabled: boolean, default true");
  log("  adapters.opencode.enabled: boolean, default true");
  log("  scaffold.plans: boolean, default false for hf-install and hf-sync, true for hf-init");
  log("  scaffold.vault: boolean, default false for hf-install and hf-sync, true for hf-init");
  log("  assets.mode: one of references|copy|symlink, default references");
  log("  assets.claude.copy: array of canonical markdown asset paths, default []");
  log("  assets.opencode.copy: array of canonical markdown asset paths, default []");
  log("  assets.opencode.syncGenerated: boolean, default true");
  log("");
  log("Safe defaults with no config file:");
  log("  - hf-install enables Claude and OpenCode wiring only.");
  log("  - hf-init creates plans/ and vault/ scaffolding, then wires Claude and OpenCode.");
  log("  - hf-sync refreshes generated adapter surfaces while keeping repo-root markdown assets canonical.");
  log("  - hf-uninstall removes only generated framework artifacts and preserves unrelated user config.");
  log(`  - generated install state is tracked at ${manifestRelativePath.replaceAll("\\", "/")}.`);
}

function parseArgs(argv) {
  const options = {
    command: getInvokedCommand(argv),
    tool: "all",
    configPath: null,
    skipBuild: false,
    platform: process.platform === "win32" ? "windows" : "linux",
    targetDir: sourceRoot,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (index === 0 && lifecycleCommands.includes(arg)) {
      continue;
    }

    if (arg === "--tool" && argv[index + 1]) {
      options.tool = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--platform" && argv[index + 1]) {
      options.platform = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--config" && argv[index + 1]) {
      options.configPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--target-dir" && argv[index + 1]) {
      options.targetDir = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  if (!["all", "claude", "opencode"].includes(options.tool)) {
    throw new Error(`Unsupported --tool value: ${options.tool}`);
  }

  if (!["windows", "linux"].includes(options.platform)) {
    throw new Error(`Unsupported --platform value: ${options.platform}`);
  }

  return options;
}

function ensureTargetDir(targetDir) {
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }
}

function toProjectRelative(targetDir, filePath) {
  return path.relative(targetDir, filePath).split(path.sep).join("/");
}

function getConfigPath(options) {
  return options.configPath ?? path.join(options.targetDir, configFileName);
}

function loadProjectConfig(options) {
  const resolvedConfigPath = getConfigPath(options);
  const config = readJson(resolvedConfigPath, null);
  return {
    path: resolvedConfigPath,
    exists: config !== null,
    value: config ?? {}
  };
}

function readManifest(targetDir) {
  return readJson(path.join(targetDir, manifestRelativePath), {
    version: 1,
    packageName: getPackageName(),
    adapters: {}
  });
}

function writeManifest(targetDir, manifest) {
  const manifestPath = path.join(targetDir, manifestRelativePath);
  const hasAdapters = Object.keys(manifest.adapters ?? {}).length > 0;

  if (!hasAdapters) {
    fs.rmSync(manifestPath, { force: true });
    removeEmptyParents(path.dirname(manifestPath), targetDir);
    return;
  }

  writeJson(manifestPath, manifest);
}

function resolveAdapterSelection(options, config, manifest) {
  const configAdapters = config.adapters ?? {};
  const defaults = {
    claude: configAdapters.claude?.enabled ?? true,
    opencode: configAdapters.opencode?.enabled ?? true
  };

  if (options.command === "uninstall" && options.tool === "all") {
    return {
      claude: true,
      opencode: true
    };
  }

  if (options.tool === "claude") {
    return { claude: true, opencode: false };
  }

  if (options.tool === "opencode") {
    return { claude: false, opencode: true };
  }

  return defaults;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: sourceRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeTextIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return true;
}

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyIfMissing(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function getPackageName() {
  const packageJson = readJson(packageJsonPath, {});
  return typeof packageJson.name === "string" && packageJson.name.length > 0
    ? packageJson.name
    : "hybrid-framework";
}

function isSelfInstall(targetDir) {
  return path.resolve(targetDir) === sourceRoot;
}

function resolveScaffoldSelection(options, config) {
  const scaffoldConfig = config.scaffold ?? {};
  const defaults = {
    plans: options.command === "init",
    vault: options.command === "init"
  };

  return {
    plans: scaffoldConfig.plans ?? defaults.plans,
    vault: scaffoldConfig.vault ?? defaults.vault
  };
}

const DEFAULT_INDEX_CONFIG = {
  enabled: true,
  code: {
    enabled: true,
    roots: ["src"],
    extensions: [".ts"],
    exclude: ["node_modules/", "dist/"]
  },
  semanticTopK: 5,
  maxChunkChars: 2000,
  embeddingBatchSize: 100,
  timeoutMs: 15000,
  charBudget: 3000,
  planningCharBudget: 1500
};

function seedIndexConfig(config) {
  const existing = config.value;
  if (existing.index) {
    return;
  }

  const merged = { ...existing, index: DEFAULT_INDEX_CONFIG };
  writeJson(config.path, merged);
  log(`Seeded index config in ${path.basename(config.path)}`);
}

function buildPackageRelativePath(targetDir, packageName, segments) {
  if (isSelfInstall(targetDir)) {
    return segments.join("/");
  }

  return ["node_modules", packageName, ...segments].join("/");
}

function buildClaudeCommand(platform, eventName, targetDir, packageName) {
  const packageRelativePath = buildPackageRelativePath(targetDir, packageName, ["dist", "src", "bin", "hf-claude-hook.js"]);
  if (platform === "windows") {
    return `node "%CLAUDE_PROJECT_DIR%\\\\${packageRelativePath.replaceAll("/", "\\\\")}" ${eventName}`;
  }

  return `node "$CLAUDE_PROJECT_DIR/${packageRelativePath}" ${eventName}`;
}

export function buildClaudeHooks(platform, targetDir = sourceRoot, packageName = getPackageName()) {
  const command = (eventName) => ({
    type: "command",
    command: buildClaudeCommand(platform, eventName, targetDir, packageName)
  });

  return {
    SessionStart: [
      {
        matcher: "startup|resume|clear|compact",
        hooks: [command("SessionStart")]
      }
    ],
    UserPromptSubmit: [
      {
        hooks: [command("UserPromptSubmit")]
      }
    ],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [command("PreToolUse")]
      }
    ],
    PreCompact: [
      {
        hooks: [command("PreCompact")]
      }
    ],
    Stop: [
      {
        hooks: [command("Stop")]
      }
    ],
    SubagentStart: [
      {
        hooks: [command("SubagentStart")]
      }
    ],
    SubagentStop: [
      {
        hooks: [command("SubagentStop")]
      }
    ]
  };
}

function mergeHookGroups(existingGroups, desiredGroups) {
  const groups = Array.isArray(existingGroups) ? [...existingGroups] : [];

  for (const desiredGroup of desiredGroups) {
    const matcher = desiredGroup.matcher ?? null;
    const existingIndex = groups.findIndex((group) => (group.matcher ?? null) === matcher);

    if (existingIndex === -1) {
      groups.push(desiredGroup);
      continue;
    }

    const existingGroup = groups[existingIndex];
    const existingHooks = Array.isArray(existingGroup.hooks) ? [...existingGroup.hooks] : [];

    for (const desiredHook of desiredGroup.hooks) {
      const duplicate = existingHooks.some((hook) => hook.type === desiredHook.type && hook.command === desiredHook.command);
      if (!duplicate) {
        existingHooks.push(desiredHook);
      }
    }

    groups[existingIndex] = {
      ...existingGroup,
      ...(matcher ? { matcher } : {}),
      hooks: existingHooks
    };
  }

  return groups;
}

function removeHookGroups(existingGroups, commandsToRemove) {
  if (!Array.isArray(existingGroups)) {
    return [];
  }

  return existingGroups
    .map((group) => {
      const hooks = Array.isArray(group.hooks)
        ? group.hooks.filter(
            (hook) => !(hook?.type === "command" && typeof hook.command === "string" && commandsToRemove.has(hook.command))
          )
        : [];

      if (hooks.length === 0) {
        return null;
      }

      return {
        ...group,
        hooks
      };
    })
    .filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isObjectEmpty(value) {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function removeEmptyParents(startPath, stopPath) {
  let currentPath = startPath;
  while (path.resolve(currentPath).startsWith(path.resolve(stopPath))) {
    if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) {
      return;
    }

    if (fs.readdirSync(currentPath).length > 0) {
      return;
    }

    fs.rmdirSync(currentPath);

    if (path.resolve(currentPath) === path.resolve(stopPath)) {
      return;
    }

    currentPath = path.dirname(currentPath);
  }
}

function removeManifestEntries(targetDir, entries) {
  const sortedEntries = [...entries].sort((left, right) => right.length - left.length);
  for (const entry of sortedEntries) {
    const entryPath = path.join(targetDir, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
    removeEmptyParents(path.dirname(entryPath), targetDir);
  }
}

function pruneEmptyDirectories(targetDir, entries) {
  const sortedEntries = [...entries].sort((left, right) => right.length - left.length);
  for (const entry of sortedEntries) {
    const entryPath = path.join(targetDir, entry);
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isDirectory()) {
      continue;
    }

    if (fs.readdirSync(entryPath).length === 0) {
      fs.rmdirSync(entryPath);
      removeEmptyParents(path.dirname(entryPath), targetDir);
    }
  }
}

function listFilesRecursively(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(fullPath);
    }
  }

  return files;
}

function scaffoldPlans(targetDir) {
  const plansRoot = path.join(targetDir, "plans");
  fs.mkdirSync(path.join(plansRoot, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(plansRoot, "runtime"), { recursive: true });

  copyIfMissing(path.join(sourceRoot, "plans", "README.md"), path.join(plansRoot, "README.md"));
  writeTextIfMissing(path.join(plansRoot, "evidence", ".gitkeep"), "");
  writeTextIfMissing(path.join(plansRoot, "runtime", ".gitkeep"), "");
}

function scaffoldVault(targetDir) {
  const vaultRoot = path.join(targetDir, "vault");
  fs.mkdirSync(path.join(vaultRoot, "plans"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "shared"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "templates"), { recursive: true });

  copyIfMissing(path.join(sourceRoot, "vault", "README.md"), path.join(vaultRoot, "README.md"));
  writeTextIfMissing(path.join(vaultRoot, "plans", ".gitkeep"), "");

  const templateNames = [
    "plan-context.md",
    "plan-discoveries.md",
    "plan-decisions.md",
    "plan-references.md",
    "shared-architecture.md",
    "shared-patterns.md",
    "shared-decisions.md"
  ];

  for (const templateName of templateNames) {
    copyIfMissing(
      path.join(sourceRoot, "vault", "templates", templateName),
      path.join(vaultRoot, "templates", templateName)
    );
  }

  copyIfMissing(
    path.join(sourceRoot, "vault", "templates", "shared-architecture.md"),
    path.join(vaultRoot, "shared", "architecture.md")
  );
  copyIfMissing(
    path.join(sourceRoot, "vault", "templates", "shared-patterns.md"),
    path.join(vaultRoot, "shared", "patterns.md")
  );
  copyIfMissing(
    path.join(sourceRoot, "vault", "templates", "shared-decisions.md"),
    path.join(vaultRoot, "shared", "decisions.md")
  );
}

function scaffoldProject(targetDir, scaffold) {
  if (scaffold.plans) {
    scaffoldPlans(targetDir);
  }

  if (scaffold.vault) {
    scaffoldVault(targetDir);
  }

  if (scaffold.plans || scaffold.vault) {
    log("Project scaffolding ready.");
  }
}

function resolveAssetSyncTool(adapters) {
  if (adapters.claude && adapters.opencode) {
    return "all";
  }

  if (adapters.claude) {
    return "claude";
  }

  if (adapters.opencode) {
    return "opencode";
  }

  return null;
}

function runAssetSync(options, adapters) {
  const tool = resolveAssetSyncTool(adapters);
  if (!tool) {
    return;
  }

  const args = [
    path.join("scripts", "sync-opencode-assets.mjs"),
    "--source-root",
    sourceRoot,
    "--target-root",
    options.targetDir,
    "--tool",
    tool
  ];

  if (options.configPath) {
    args.push("--config", options.configPath);
  }

  run("node", args);
}

function collectGeneratedAssetState(targetDir, directories) {
  const generatedPaths = [];
  const managedDirectories = [];

  for (const relativeDir of directories) {
    const absoluteDir = path.join(targetDir, relativeDir);
    if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
      continue;
    }

    managedDirectories.push(relativeDir);
    generatedPaths.push(...listFilesRecursively(absoluteDir).map((filePath) => toProjectRelative(targetDir, filePath)));
  }

  return {
    generatedPaths: [...new Set(generatedPaths)],
    managedDirectories
  };
}

function installClaude(platform, targetDir, packageName) {
  const settingsPath = path.join(targetDir, ".claude", "settings.local.json");
  const current = readJson(settingsPath, {});
  const desiredHooks = buildClaudeHooks(platform, targetDir, packageName);
  const next = {
    ...current,
    hooks: {
      ...(current.hooks ?? {})
    }
  };

  for (const [eventName, groups] of Object.entries(desiredHooks)) {
    next.hooks[eventName] = mergeHookGroups(next.hooks[eventName], groups);
  }

  writeJson(settingsPath, next);
  log(`Claude hooks installed into ${path.relative(targetDir, settingsPath)}`);

  const assetState = collectGeneratedAssetState(targetDir, [".claude/agents", ".claude/skills"]);

  return {
    commands: Object.values(desiredHooks)
      .flat()
      .flatMap((group) => group.hooks.map((hook) => hook.command)),
    settingsPath: toProjectRelative(targetDir, settingsPath),
    generatedPaths: assetState.generatedPaths,
    managedDirectories: assetState.managedDirectories
  };
}

function uninstallClaude(targetDir, claudeState) {
  if (!claudeState) {
    return false;
  }

  const settingsRelativePath = typeof claudeState.settingsPath === "string"
    ? claudeState.settingsPath
    : ".claude/settings.local.json";
  const settingsPath = path.join(targetDir, settingsRelativePath);
  const generatedPaths = Array.isArray(claudeState.generatedPaths)
    ? claudeState.generatedPaths.filter((entry) => entry !== settingsRelativePath)
    : [];
  removeManifestEntries(targetDir, generatedPaths);
  const managedDirectories = Array.isArray(claudeState.managedDirectories) ? claudeState.managedDirectories : [];
  pruneEmptyDirectories(targetDir, managedDirectories);
  const current = readJson(settingsPath, null);
  if (!current) {
    return false;
  }

  const commandsToRemove = new Set(Array.isArray(claudeState.commands) ? claudeState.commands : []);
  const next = { ...current };
  const nextHooks = { ...(current.hooks ?? {}) };

  for (const eventName of Object.keys(nextHooks)) {
    const groups = removeHookGroups(nextHooks[eventName], commandsToRemove);
    if (groups.length === 0) {
      delete nextHooks[eventName];
      continue;
    }
    nextHooks[eventName] = groups;
  }

  if (isObjectEmpty(nextHooks)) {
    delete next.hooks;
  } else {
    next.hooks = nextHooks;
  }

  if (isObjectEmpty(next)) {
    fs.rmSync(settingsPath, { force: true });
    removeEmptyParents(path.dirname(settingsPath), targetDir);
  } else {
    writeJson(settingsPath, next);
  }

  log(`Claude hooks removed from ${path.relative(targetDir, settingsPath)}`);
  return true;
}

function buildOpenCodeRegistry(targetDir, packageName) {
  if (isSelfInstall(targetDir)) {
    return readJson(path.join(sourceRoot, ".opencode", "registry.json"), {});
  }

  const packagePrefix = `../node_modules/${packageName}`;
  return {
    version: "2.0.0",
    canonicalRoots: {
      agents: `${packagePrefix}/agents`,
      subagents: `${packagePrefix}/subagents`,
      skills: `${packagePrefix}/skills`
    },
    assets: [
      { id: "agent-planner", type: "agent", path: `${packagePrefix}/agents/hf-planner.md` },
      { id: "agent-builder", type: "agent", path: `${packagePrefix}/agents/hf-builder.md` },
      { id: "subagent-coder", type: "agent", path: `${packagePrefix}/subagents/hf-coder.md` },
      { id: "subagent-plan-reviewer", type: "agent", path: `${packagePrefix}/subagents/hf-plan-reviewer.md` },
      { id: "subagent-reviewer", type: "agent", path: `${packagePrefix}/subagents/hf-reviewer.md` },
      { id: "skill-local-context", type: "skill", path: `${packagePrefix}/skills/local-context/SKILL.md` },
      { id: "skill-milestone-tracking", type: "skill", path: `${packagePrefix}/skills/milestone-tracking/SKILL.md` },
      { id: "skill-plan-synthesis", type: "skill", path: `${packagePrefix}/skills/plan-synthesis/SKILL.md` },
      { id: "skill-verification-before-completion", type: "skill", path: `${packagePrefix}/skills/verification-before-completion/SKILL.md` }
    ]
  };
}

export function buildOpenCodePluginSource(targetDir = sourceRoot, packageName = getPackageName()) {
  const packageRelativePath = buildPackageRelativePath(targetDir, packageName, ["dist", "src", "opencode", "plugin.js"]);
  return `export { HybridRuntimePlugin } from "../../${packageRelativePath}";\n`;
}

function installOpenCode(targetDir, packageName) {
  const opencodeRoot = path.join(targetDir, ".opencode");
  const pluginPath = path.join(opencodeRoot, "plugins", "hybrid-runtime.js");
  const pluginSource = buildOpenCodePluginSource(targetDir, packageName);
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(pluginPath, pluginSource, "utf8");
  writeJson(path.join(opencodeRoot, "registry.json"), buildOpenCodeRegistry(targetDir, packageName));

  copyIfPresent(path.join(sourceRoot, ".opencode", "README.md"), path.join(opencodeRoot, "README.md"));

  const copiedPackageJson = copyIfPresent(
    path.join(sourceRoot, ".opencode", "package.json"),
    path.join(opencodeRoot, "package.json")
  );

  if (!copiedPackageJson) {
    writeJson(path.join(opencodeRoot, "package.json"), {
      private: true,
      dependencies: {
        "@opencode-ai/plugin": "1.2.24"
      }
    });
  }

  log(`OpenCode plugin installed at ${path.relative(targetDir, pluginPath)}`);

  const assetState = collectGeneratedAssetState(targetDir, [".opencode/agents", ".opencode/skills"]);

  const generatedPaths = [
    toProjectRelative(targetDir, pluginPath),
    toProjectRelative(targetDir, path.join(opencodeRoot, "registry.json")),
    toProjectRelative(targetDir, path.join(opencodeRoot, "package.json"))
  ];

  if (fs.existsSync(path.join(opencodeRoot, "README.md"))) {
    generatedPaths.push(toProjectRelative(targetDir, path.join(opencodeRoot, "README.md")));
  }

  generatedPaths.push(...assetState.generatedPaths);

  return {
    generatedPaths: [...new Set(generatedPaths)],
    managedDirectories: [
      ".opencode/plugins",
      ...assetState.managedDirectories
    ]
  };
}

function uninstallOpenCode(targetDir, opencodeState) {
  if (!opencodeState) {
    return false;
  }

  const generatedPaths = Array.isArray(opencodeState.generatedPaths) ? opencodeState.generatedPaths : [];
  removeManifestEntries(targetDir, generatedPaths);
  const managedDirectories = Array.isArray(opencodeState.managedDirectories) ? opencodeState.managedDirectories : [];
  pruneEmptyDirectories(targetDir, managedDirectories);
  log("OpenCode generated files removed.");
  return true;
}

function executeInstall(commandLabel, options, packageName, adapters, manifest) {
  const nextManifest = {
    version: 1,
    packageName,
    adapters: {
      ...(manifest.adapters ?? {})
    }
  };

  runAssetSync(options, adapters);

  if (adapters.claude) {
    nextManifest.adapters.claude = installClaude(options.platform, options.targetDir, packageName);
  }

  if (adapters.opencode) {
    nextManifest.adapters.opencode = installOpenCode(options.targetDir, packageName);
  }

  writeManifest(options.targetDir, nextManifest);
  log(`Hybrid runtime ${commandLabel} complete.`);
}

function executeUninstall(options, adapters, manifest) {
  const nextManifest = {
    ...manifest,
    adapters: {
      ...(manifest.adapters ?? {})
    }
  };

  if (adapters.claude) {
    uninstallClaude(options.targetDir, manifest.adapters?.claude);
    delete nextManifest.adapters.claude;
  }

  if (adapters.opencode) {
    uninstallOpenCode(options.targetDir, manifest.adapters?.opencode);
    delete nextManifest.adapters.opencode;
  }

  writeManifest(options.targetDir, nextManifest);
  log("Hybrid runtime uninstall complete.");
}

export function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  ensureTargetDir(options.targetDir);

  const packageName = getPackageName();
  const config = loadProjectConfig(options);
  const manifest = readManifest(options.targetDir);
  const adapters = resolveAdapterSelection(options, config.value, manifest);
  const scaffold = resolveScaffoldSelection(options, config.value);

  const shouldScaffold = options.command === "init" && (scaffold.plans || scaffold.vault);

  if (!adapters.claude && !adapters.opencode && options.command !== "uninstall" && !shouldScaffold) {
    log(`No adapters are enabled for ${options.command}.`);
    if (config.exists) {
      log(`Config checked: ${path.relative(options.targetDir, config.path)}`);
    }
    return;
  }

  if ((options.command === "install" || options.command === "init") && !options.skipBuild && (adapters.claude || adapters.opencode)) {
    run("npm", ["install"]);
    run("npm", ["run", "build"]);
  }

  if (options.command === "install") {
    executeInstall("install", options, packageName, adapters, manifest);
    return;
  }

  if (options.command === "sync") {
    executeInstall("sync", options, packageName, adapters, manifest);
    return;
  }

  if (options.command === "uninstall") {
    executeUninstall(options, adapters, manifest);
    return;
  }

  if (options.command === "init") {
    seedIndexConfig(config);
    scaffoldProject(options.targetDir, scaffold);
    executeInstall("install", options, packageName, adapters, manifest);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

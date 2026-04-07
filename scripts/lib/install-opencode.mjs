import fs from "node:fs";
import path from "node:path";

import {
  buildPackageRelativePath,
  collectGeneratedAssetState,
  copyIfPresent,
  getPackageName,
  isSelfInstall,
  log,
  pruneEmptyDirectories,
  readJson,
  removeManifestEntries,
  run,
  sourceRoot,
  toProjectRelative,
  writeJson
} from "./install-helpers.mjs";

const OPENCODE_DIR = ".opencode";
const PACKAGE_JSON = "package.json";
const REGISTRY_JSON = "registry.json";

function buildOpenCodeRegistry(targetDir, packageName) {
  if (isSelfInstall(targetDir)) {
    return readJson(path.join(sourceRoot, OPENCODE_DIR, REGISTRY_JSON), {});
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

function buildOpenCodePluginSource(targetDir = sourceRoot, packageName = getPackageName()) {
  const packageRelativePath = buildPackageRelativePath(targetDir, packageName, ["dist", "src", "opencode", "plugin.js"]);
  return `export { HybridRuntimePlugin } from "../../${packageRelativePath}";\n`;
}

function installOpenCode(targetDir, packageName) {
  const opencodeRoot = path.join(targetDir, OPENCODE_DIR);
  const pluginPath = path.join(opencodeRoot, "plugins", "hybrid-runtime.js");
  const pluginSource = buildOpenCodePluginSource(targetDir, packageName);
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(pluginPath, pluginSource, "utf8");
  writeJson(path.join(opencodeRoot, REGISTRY_JSON), buildOpenCodeRegistry(targetDir, packageName));

  copyIfPresent(path.join(sourceRoot, OPENCODE_DIR, "README.md"), path.join(opencodeRoot, "README.md"));

  const copiedPackageJson = copyIfPresent(
    path.join(sourceRoot, OPENCODE_DIR, PACKAGE_JSON),
    path.join(opencodeRoot, PACKAGE_JSON)
  );

  if (!copiedPackageJson) {
    writeJson(path.join(opencodeRoot, PACKAGE_JSON), {
      private: true,
      dependencies: {
        "@opencode-ai/plugin": "1.2.24"
      }
    });
  }

  log(`OpenCode plugin installed at ${path.relative(targetDir, pluginPath)}`);

  const assetState = collectGeneratedAssetState(targetDir, [`${OPENCODE_DIR}/agents`, `${OPENCODE_DIR}/skills`]);

  const generatedPaths = [
    toProjectRelative(targetDir, pluginPath),
    toProjectRelative(targetDir, path.join(opencodeRoot, REGISTRY_JSON)),
    toProjectRelative(targetDir, path.join(opencodeRoot, PACKAGE_JSON))
  ];

  if (fs.existsSync(path.join(opencodeRoot, "README.md"))) {
    generatedPaths.push(toProjectRelative(targetDir, path.join(opencodeRoot, "README.md")));
  }

  generatedPaths.push(...assetState.generatedPaths);

  return {
    generatedPaths: [...new Set(generatedPaths)],
    managedDirectories: [
      `${OPENCODE_DIR}/plugins`,
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

export {
  buildOpenCodePluginSource,
  buildOpenCodeRegistry,
  installOpenCode,
  resolveAssetSyncTool,
  runAssetSync,
  uninstallOpenCode
};

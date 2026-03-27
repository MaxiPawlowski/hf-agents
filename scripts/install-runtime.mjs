#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import {
  ensureTargetDir,
  getPackageName,
  isInstalledPackage,
  loadProjectConfig,
  log,
  parseArgs,
  printHelp,
  readManifest,
  resolveAdapterSelection,
  resolveScaffoldSelection,
  run,
  scaffoldProject,
  seedIndexConfig,
  writeManifest
} from "./lib/install-helpers.mjs";
import { buildClaudeHooks, installClaude, uninstallClaude } from "./lib/install-claude.mjs";
import { buildOpenCodePluginSource, installOpenCode, runAssetSync, uninstallOpenCode } from "./lib/install-opencode.mjs";

const scriptPath = fileURLToPath(import.meta.url);

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

function runMain(forcedTool = null) {
  if (forcedTool !== null && !["claude", "opencode"].includes(forcedTool)) {
    throw new Error(`Unsupported forced tool: ${forcedTool}`);
  }

  const options = parseArgs(process.argv.slice(2), { forcedTool });

  if (options.help) {
    printHelp(forcedTool);
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

  if (
    (options.command === "install" || options.command === "init") &&
    !options.skipBuild &&
    !isInstalledPackage() &&
    (adapters.claude || adapters.opencode)
  ) {
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

function main() { runMain(); }
function mainForTool(tool) { runMain(tool); }

export { buildClaudeHooks, buildOpenCodePluginSource, main, mainForTool };

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

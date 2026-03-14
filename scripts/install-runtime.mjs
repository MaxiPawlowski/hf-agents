#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), "..");
const packageJsonPath = path.join(sourceRoot, "package.json");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv) {
  const options = {
    tool: "all",
    skipBuild: false,
    platform: process.platform === "win32" ? "windows" : "linux",
    targetDir: sourceRoot
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

    if (arg === "--skip-build") {
      options.skipBuild = true;
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

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
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

  run("node", [
    path.join("scripts", "sync-opencode-assets.mjs"),
    "--source-root",
    sourceRoot,
    "--target-root",
    targetDir
  ]);
  log(`OpenCode plugin installed at ${path.relative(targetDir, pluginPath)}`);
}

export function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageName = getPackageName();

  if (!options.skipBuild) {
    run("npm", ["install"]);
    run("npm", ["run", "build"]);
  }

  if (options.tool === "all" || options.tool === "claude") {
    installClaude(options.platform, options.targetDir, packageName);
  }

  if (options.tool === "all" || options.tool === "opencode") {
    installOpenCode(options.targetDir, packageName);
  }

  log("Hybrid runtime install complete.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

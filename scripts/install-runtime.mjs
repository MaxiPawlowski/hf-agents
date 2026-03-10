#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv) {
  const options = {
    tool: "all",
    skipBuild: false,
    platform: process.platform === "win32" ? "windows" : "linux"
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
    cwd: repoRoot,
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

function buildClaudeCommand(platform, eventName) {
  if (platform === "windows") {
    return `node "%CLAUDE_PROJECT_DIR%\\\\dist\\\\src\\\\bin\\\\hf-claude-hook.js" ${eventName}`;
  }

  return `node "$CLAUDE_PROJECT_DIR/dist/src/bin/hf-claude-hook.js" ${eventName}`;
}

export function buildClaudeHooks(platform) {
  const command = (eventName) => ({
    type: "command",
    command: buildClaudeCommand(platform, eventName)
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

function installClaude(platform) {
  const settingsPath = path.join(repoRoot, ".claude", "settings.local.json");
  const current = readJson(settingsPath, {});
  const desiredHooks = buildClaudeHooks(platform);
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
  log(`Claude hooks installed into ${path.relative(repoRoot, settingsPath)}`);
}

export function buildOpenCodePluginSource() {
  return "export { HybridRuntimePlugin } from \"../../dist/src/opencode/plugin.js\";\n";
}

function installOpenCode() {
  const pluginPath = path.join(repoRoot, ".opencode", "plugins", "hybrid-runtime.js");
  const pluginSource = buildOpenCodePluginSource();
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(pluginPath, pluginSource, "utf8");
  run("node", [path.join("scripts", "sync-opencode-assets.mjs")]);
  log(`OpenCode plugin installed at ${path.relative(repoRoot, pluginPath)}`);
}

export function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.skipBuild) {
    run("npm", ["install"]);
    run("npm", ["run", "build"]);
  }

  if (options.tool === "all" || options.tool === "claude") {
    installClaude(options.platform);
  }

  if (options.tool === "all" || options.tool === "opencode") {
    installOpenCode();
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

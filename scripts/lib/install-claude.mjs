import fs from "node:fs";
import path from "node:path";

import {
  buildPackageRelativePath,
  collectGeneratedAssetState,
  getPackageName,
  isObjectEmpty,
  log,
  pruneEmptyDirectories,
  readJson,
  removeEmptyParents,
  removeManifestEntries,
  sourceRoot,
  toProjectRelative,
  writeJson
} from "./install-helpers.mjs";

function buildClaudeCommand(platform, eventName, targetDir, packageName) {
  const packageRelativePath = buildPackageRelativePath(targetDir, packageName, ["dist", "src", "bin", "hf-claude-hook.js"]);
  return `node "$CLAUDE_PROJECT_DIR/${packageRelativePath}" ${eventName}`;
}

function buildClaudeHooks(platform, targetDir = sourceRoot, packageName = getPackageName()) {
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

function buildMcpServerArgs(platform, targetDir, packageName) {
  const packageRelativePath = buildPackageRelativePath(targetDir, packageName, ["dist", "src", "bin", "hf-mcp-server.js"]);
  return [packageRelativePath];
}

function installMcpConfig(platform, targetDir, packageName) {
  const mcpPath = path.join(targetDir, ".mcp.json");
  const current = readJson(mcpPath, {});
  const args = buildMcpServerArgs(platform, targetDir, packageName);
  const next = {
    ...current,
    mcpServers: {
      ...(current.mcpServers ?? {}),
      "hf-search": {
        type: "stdio",
        command: "node",
        args
      }
    }
  };

  writeJson(mcpPath, next);
  log(`MCP config installed into ${path.relative(targetDir, mcpPath)}`);
  return toProjectRelative(targetDir, mcpPath);
}

function uninstallMcpConfig(targetDir, mcpRelativePath) {
  const mcpPath = path.join(targetDir, mcpRelativePath ?? ".mcp.json");
  const current = readJson(mcpPath, null);
  if (!current) {
    return;
  }

  const next = { ...current };
  if (next.mcpServers && typeof next.mcpServers === "object") {
    const { "hf-search": _removed, ...remainingServers } = next.mcpServers;
    if (Object.keys(remainingServers).length === 0) {
      delete next.mcpServers;
    } else {
      next.mcpServers = remainingServers;
    }
  }

  if (isObjectEmpty(next)) {
    fs.rmSync(mcpPath, { force: true });
    log(`MCP config removed: ${path.relative(targetDir, mcpPath)}`);
  } else {
    writeJson(mcpPath, next);
    log(`MCP config updated (hf-search removed): ${path.relative(targetDir, mcpPath)}`);
  }
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

  const mcpRelativePath = installMcpConfig(platform, targetDir, packageName);
  const assetState = collectGeneratedAssetState(targetDir, [".claude/agents", ".claude/skills"]);

  return {
    commands: Object.values(desiredHooks)
      .flat()
      .flatMap((group) => group.hooks.map((hook) => hook.command)),
    settingsPath: toProjectRelative(targetDir, settingsPath),
    mcpConfigPath: mcpRelativePath,
    generatedPaths: assetState.generatedPaths,
    managedDirectories: assetState.managedDirectories
  };
}

function uninstallClaude(targetDir, claudeState) {
  if (!claudeState) {
    return false;
  }

  const mcpConfigPath = typeof claudeState.mcpConfigPath === "string"
    ? claudeState.mcpConfigPath
    : ".mcp.json";
  uninstallMcpConfig(targetDir, mcpConfigPath);

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

export {
  buildClaudeCommand,
  buildClaudeHooks,
  buildMcpServerArgs,
  installClaude,
  installMcpConfig,
  mergeHookGroups,
  removeHookGroups,
  uninstallClaude,
  uninstallMcpConfig
};

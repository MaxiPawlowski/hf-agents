/**
 * Framework plugin for OpenCode
 *
 * - Keeps a small toggle model in plugin memory
 * - Always persists toggle changes to settings/framework-settings.json
 * - Interpolates markdown placeholders at runtime
 * - Exposes toggle_set/toggle_get tools
 * - Supports per-toggle slash commands
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_BY_DIRECTORY = new Map();

const TOGGLE_KEYS = ["use_worktree", "require_tests", "require_verification", "task_artifacts"];

const COMMAND_TOGGLE_MAP = {
  "toggle-worktree": "use_worktree",
  "toggle-tests": "require_tests",
  "toggle-verification": "require_verification",
  "toggle-artifacts": "task_artifacts",
  "hf-toggle-worktree": "use_worktree",
  "hf-toggle-tests": "require_tests",
  "hf-toggle-verification": "require_verification",
  "hf-toggle-artifacts": "task_artifacts"
};

const STATUS_COMMANDS = new Set(["toggle-status", "hf-toggle-status"]);

const TOGGLE_RULE_TEXT = {
  use_worktree: "Enable worktree-aware and managed git execution decisions.",
  require_tests: "Require test evidence before ready state.",
  require_verification: "Require approval, verification, and reviewer signoff before completion.",
  task_artifacts: "Maintain task lifecycle artifacts during execution."
};

const TOGGLE_DESCRIPTION_MAP = {
  "toggle-worktree": {
    key: "use_worktree",
    label: "Toggle worktree gate on or off"
  },
  "toggle-tests": {
    key: "require_tests",
    label: "Toggle required tests gate on or off"
  },
  "toggle-verification": {
    key: "require_verification",
    label: "Toggle verification gate on or off"
  },
  "toggle-artifacts": {
    key: "task_artifacts",
    label: "Toggle task artifacts gate on or off"
  }
};

const SETTINGS_TOGGLE_KEYS = {
  use_worktree: ["useWorktreesByDefault", "manageGitByDefault"],
  require_tests: ["requireTests"],
  require_verification: ["requireApprovalGates", "requireVerification", "requireCodeReview"],
  task_artifacts: ["enableTaskArtifacts"]
};

const stripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return content;
  return match[2];
};

const safeRead = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

const defaultToggles = () => ({
  use_worktree: false,
  require_tests: false,
  require_verification: false,
  task_artifacts: false
});

const settingsPathFor = (directory) => path.join(directory, "settings", "framework-settings.json");

const readSettingsFile = (directory) => {
  const settingsPath = settingsPathFor(directory);
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    const raw = safeRead(settingsPath);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const fromSettingsFile = (directory) => {
  const raw = readSettingsFile(directory);
  const toggles = { ...defaultToggles() };
  const source = raw && typeof raw === "object" ? raw.toggles || {} : {};

  toggles.use_worktree = Boolean(source.useWorktreesByDefault || source.manageGitByDefault);
  toggles.require_tests = Boolean(source.requireTests);
  toggles.require_verification = Boolean(
    source.requireApprovalGates || source.requireVerification || source.requireCodeReview
  );
  toggles.task_artifacts = Boolean(source.enableTaskArtifacts);

  return toggles;
};

const persistState = (directory) => {
  const settingsPath = settingsPathFor(directory);
  const settingsDir = path.dirname(settingsPath);
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  const state = getState(directory);
  const existing = readSettingsFile(directory);
  const nextToggles = { ...(existing.toggles || {}) };

  for (const [pluginKey, settingsKeys] of Object.entries(SETTINGS_TOGGLE_KEYS)) {
    for (const settingsKey of settingsKeys) {
      nextToggles[settingsKey] = Boolean(state[pluginKey]);
    }
  }

  const nextSettings = {
    ...existing,
    toggles: nextToggles
  };

  fs.writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
};

const getState = (directory) => {
  const key = path.resolve(directory);
  if (!STATE_BY_DIRECTORY.has(key)) {
    STATE_BY_DIRECTORY.set(key, fromSettingsFile(key));
  }
  return STATE_BY_DIRECTORY.get(key);
};

const setToggle = (directory, toggleKey, value) => {
  const state = getState(directory);
  state[toggleKey] = value;
  persistState(directory);
  syncToggleCommandDescriptions(directory, state);
};

const commandPathFor = (directory, commandName) =>
  path.join(directory, ".opencode", "commands", `${commandName}.md`);

const withFrontmatterDescription = (content, description) => {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatterMatch) {
    return content;
  }
  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split("\n");
  const rendered = JSON.stringify(description);
  const out = [];
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^description\s*:/.test(line)) {
      out.push(line);
      continue;
    }

    out.push(`description: ${rendered}`);
    replaced = true;

    // If previous description used block scalar style, drop its continuation lines.
    const value = line.replace(/^description\s*:\s*/, "").trim();
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i++;
      }
    }
  }

  if (!replaced) {
    out.push(`description: ${rendered}`);
  }

  const nextFrontmatter = out.join("\n");
  if (nextFrontmatter === frontmatter) {
    return content;
  }
  return `${content.slice(0, frontmatterMatch.index)}---\n${nextFrontmatter}\n---\n${content.slice(frontmatterMatch.index + frontmatterMatch[0].length)}`;
};

const toggleSummary = (toggles) =>
  [
    `W=${toggles.use_worktree ? "ON" : "OFF"}`,
    `T=${toggles.require_tests ? "ON" : "OFF"}`,
    `V=${toggles.require_verification ? "ON" : "OFF"}`,
    `A=${toggles.task_artifacts ? "ON" : "OFF"}`
  ].join(", ");

const syncToggleCommandDescriptions = (directory, toggles) => {
  for (const [commandName, meta] of Object.entries(TOGGLE_DESCRIPTION_MAP)) {
    const commandPath = commandPathFor(directory, commandName);
    if (!fs.existsSync(commandPath)) {
      continue;
    }
    const current = safeRead(commandPath);
    const stateText = toggles[meta.key] ? "ON" : "OFF";
    const description = `HF: [${stateText}] ${meta.label}.`;
    const next = withFrontmatterDescription(current, description);
    if (next !== current) {
      fs.writeFileSync(commandPath, next, "utf8");
    }
  }

  const statusCommandPath = commandPathFor(directory, "toggle-status");
  if (fs.existsSync(statusCommandPath)) {
    const current = safeRead(statusCommandPath);
    const description = `HF: [${toggleSummary(toggles)}] Show current runtime toggle states.`;
    const next = withFrontmatterDescription(current, description);
    if (next !== current) {
      fs.writeFileSync(statusCommandPath, next, "utf8");
    }
  }
};

const interpolateText = (text, toggles) =>
  text.replace(/\{\{(toggle|rule)\.([a-z0-9_]+)\}\}/g, (_full, kind, key) => {
    if (!TOGGLE_KEYS.includes(key)) {
      return "";
    }
    if (kind === "toggle") {
      return toggles[key] ? "ON" : "OFF";
    }
    return toggles[key] ? TOGGLE_RULE_TEXT[key] : "";
  });

const parseDotenvLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) {
    return null;
  }
  const key = match[1];
  let value = match[2] ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    const inlineComment = value.indexOf(" #");
    if (inlineComment >= 0) {
      value = value.slice(0, inlineComment).trimEnd();
    }
  }
  return { key, value };
};

const loadDotenvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = safeRead(filePath);
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotenvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
};

const parseToggleArg = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const token = normalized.split(/\s+/)[0] || "";
  if (["on", "true", "1", "enable", "enabled"].includes(token)) return true;
  if (["off", "false", "0", "disable", "disabled"].includes(token)) return false;
  return null;
};

const statusText = (toggles) =>
  `Toggle status: ${TOGGLE_KEYS.map((key) => `${key}=${toggles[key] ? "ON" : "OFF"}`).join(", ")}`;

const isCommandOutput = (value) =>
  typeof value === "object" && value !== null && "parts" in value && Array.isArray(value.parts);

const z = tool.schema;
const toggleEnum = z.enum(TOGGLE_KEYS);

export const FrameworkBootstrapPlugin = async (input) => {
  const homeDir = os.homedir();
  const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(homeDir, ".config/opencode");
  const dotenvCandidates = [
    process.env.OPENCODE_DOTENV_PATH,
    path.join(configDir, ".env"),
    path.join(process.cwd(), ".env")
  ].filter(Boolean);
  for (const dotenvPath of dotenvCandidates) {
    loadDotenvFile(path.resolve(String(dotenvPath)));
  }

  const runtimePrefPath = path.resolve(__dirname, "../context/project/runtime-preferences.md");
  const coreDelegationPath = path.resolve(__dirname, "../skills/core-delegation/SKILL.md");
  const runtimePreferences = safeRead(runtimePrefPath);
  const coreDelegationBody = stripFrontmatter(safeRead(coreDelegationPath));
  syncToggleCommandDescriptions(input.directory, getState(input.directory));

  const bootstrap = `<FRAMEWORK_IMPORTANT>
You are running inside the framework runtime.

This repository is markdown-first for OpenCode behavior. Prefer .opencode markdown configuration over hardcoded assumptions.

Skills location:
- Project: .opencode/skills/
- User: ${configDir}/skills/

Canonical defaults and toggle behavior live in:
- .opencode/context/project/runtime-preferences.md

Canonical delegation workflow lives in:
- .opencode/skills/core-delegation/SKILL.md

Runtime preferences context:
${runtimePreferences}

Core delegation reference:
${coreDelegationBody}
</FRAMEWORK_IMPORTANT>`;

  const disposeCurrentInstance = async () => {
    try {
      await input.client.instance.dispose({ directory: input.directory });
    } catch {
      // Ignore dispose failures.
    }
  };

  return {
    event: async () => {},
    tool: {
      toggle_set: tool({
        description: "Set an individual runtime toggle state and persist it",
        args: {
          key: toggleEnum,
          enabled: z.boolean()
        },
        execute: async (args) => {
          setToggle(input.directory, args.key, args.enabled);
          await disposeCurrentInstance();
          return `Toggle Updated: ${args.key}=${args.enabled ? "ON" : "OFF"}`;
        }
      }),
      toggle_get: tool({
        description: "Get runtime toggle state",
        args: {
          key: toggleEnum.optional()
        },
        execute: async (args) => {
          const toggles = getState(input.directory);
          if (args.key) {
            return `${args.key}=${toggles[args.key] ? "ON" : "OFF"}`;
          }
          return statusText(toggles);
        }
      })
    },
    "command.execute.before": async (cmd, output) => {
      const command = String(cmd.command || "").replace(/^\/+/, "").toLowerCase();
      if (!isCommandOutput(output)) {
        return;
      }

      if (STATUS_COMMANDS.has(command)) {
        output.parts.push({ type: "text", text: `Toggle Status: ${statusText(getState(input.directory)).replace(/^Toggle status:\s*/i, "")}` });
        return;
      }

      const toggleKey = COMMAND_TOGGLE_MAP[command];
      if (!toggleKey) {
        return;
      }
      const parsedValue = parseToggleArg(cmd.arguments);
      if (parsedValue === null) {
        output.parts.push({ type: "text", text: `Usage: /${command} <on|off>` });
        return;
      }
      setToggle(input.directory, toggleKey, parsedValue);
      output.parts.push({ type: "text", text: `Toggle Updated: ${toggleKey}=${parsedValue ? "ON" : "OFF"}` });
      await disposeCurrentInstance();
      return;
    },
    "tool.execute.after": async (ctx, output) => {
      if (ctx.tool !== "skill") {
        return;
      }
      if (typeof output.output !== "string") {
        return;
      }
      const toggles = getState(input.directory);
      output.output = interpolateText(output.output, toggles);
    },
    "experimental.chat.system.transform": async (_ctx, output) => {
      const toggles = getState(input.directory);
      output.system = (output.system || []).map((entry) => interpolateText(entry, toggles));
      (output.system ||= []).push(interpolateText(bootstrap, toggles));
    }
  };
};

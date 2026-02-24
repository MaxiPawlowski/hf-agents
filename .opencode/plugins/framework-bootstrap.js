/**
 * Framework plugin for OpenCode
 *
 * Goals:
 * - Lightweight and context-efficient bootstrap
 * - Toggle persistence to settings/framework-settings.json
 * - Runtime interpolation for markdown placeholders
 * - Toggle tools + lightweight slash command support
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_BY_DIRECTORY = new Map();
const ACTIVE_AGENT_BY_SESSION = new Map();

// IMPORTANT: resolve framework root from plugin install location.
// This allows installs under .opencode, .opencode.local, or any other namespace.
const FRAMEWORK_ROOT = path.resolve(__dirname, "..");
const FRAMEWORK_NAME = path.basename(FRAMEWORK_ROOT);

const TOGGLE_KEYS = [
  "use_worktree",
  "require_tests",
  "require_verification",
  "task_artifacts",
];

const COMMAND_TOGGLE_MAP = {
  "toggle-worktree": "use_worktree",
  "toggle-tests": "require_tests",
  "toggle-verification": "require_verification",
  "toggle-artifacts": "task_artifacts",
};

const TOGGLE_RULE_TEXT = {
  use_worktree: "Enable worktree-aware and managed git execution decisions.",
  require_tests: "Require test evidence before ready state.",
  require_verification:
    "Require approval, verification, and reviewer signoff before completion.",
  task_artifacts: "Maintain task lifecycle artifacts during execution.",
};

const SETTINGS_TOGGLE_KEYS = {
  use_worktree: ["useWorktreesByDefault", "manageGitByDefault"],
  require_tests: ["requireTests"],
  require_verification: [
    "requireApprovalGates",
    "requireVerification",
    "requireCodeReview",
  ],
  task_artifacts: ["enableTaskArtifacts"],
};

const safeRead = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

const defaultToggles = () => ({
  use_worktree: false,
  require_tests: false,
  require_verification: false,
  task_artifacts: false,
});

const settingsPathFor = (directory) =>
  path.join(directory, "settings", "framework-settings.json");

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

  toggles.use_worktree = Boolean(
    source.useWorktreesByDefault || source.manageGitByDefault,
  );
  toggles.require_tests = Boolean(source.requireTests);
  toggles.require_verification = Boolean(
    source.requireApprovalGates ||
    source.requireVerification ||
    source.requireCodeReview,
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

  for (const [pluginKey, settingsKeys] of Object.entries(
    SETTINGS_TOGGLE_KEYS,
  )) {
    for (const settingsKey of settingsKeys) {
      nextToggles[settingsKey] = Boolean(state[pluginKey]);
    }
  }

  const nextSettings = {
    ...existing,
    toggles: nextToggles,
  };

  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(nextSettings, null, 2)}\n`,
    "utf8",
  );
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
};

const cleanupInterpolatedMarkdown = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  const cleaned = [];
  let inFence = false;
  let fenceToken = "";
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceToken = token[0];
      } else if (token[0] === fenceToken) {
        inFence = false;
        fenceToken = "";
      }
      cleaned.push(line.replace(/\s+$/g, ""));
      continue;
    }

    const trimmed = line.trim();
    if (
      !inFence &&
      (trimmed === "-" || trimmed === "*" || /^\d+\.$/.test(trimmed))
    ) {
      cleaned.push("");
      continue;
    }
    if (trimmed === "") {
      // Preserve indentation for whitespace-only lines (e.g., inside indented code blocks).
      cleaned.push(line);
      continue;
    }
    cleaned.push(line.replace(/\s+$/g, ""));
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n");
};

const hasInterpolationTokens = (text) =>
  /\{\{\s*(?:toggle|rule)\./i.test(String(text || ""));

const pruneToggleStateLines = (text, toggles) => {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Drop lines that only exist to report OFF state.
    // Example: "- Toggle state `require_verification`: OFF"
    const toggleStateMatch = trimmed.match(
      /toggle\s+state\s+`([^`]+)`\s*:\s*(on|off)\b/i,
    );
    if (toggleStateMatch) {
      const key = toggleStateMatch[1];
      const state = toggleStateMatch[2].toLowerCase();
      if (TOGGLE_KEYS.includes(key) && state === "off" && !toggles[key]) {
        continue;
      }
    }

    // Example: "Gate state: `require_tests=OFF`"
    const gateStateMatch = trimmed.match(
      /gate\s+state\s*:\s*`\s*([a-z0-9_]+)\s*=\s*(on|off)\s*`/i,
    );
    if (gateStateMatch) {
      const key = gateStateMatch[1];
      const state = gateStateMatch[2].toLowerCase();
      if (TOGGLE_KEYS.includes(key) && state === "off" && !toggles[key]) {
        continue;
      }
    }

    out.push(line);
  }

  return out.join("\n");
};

const interpolateText = (text, toggles) =>
  cleanupInterpolatedMarkdown(
    pruneToggleStateLines(
      String(text || "").replace(
        /\{\{(toggle|rule)\.([a-z0-9_]+)\}\}/g,
        (_full, kind, key) => {
          if (!TOGGLE_KEYS.includes(key)) {
            return "";
          }
          if (kind === "toggle") {
            return toggles[key] ? "ON" : "OFF";
          }
          return toggles[key] ? TOGGLE_RULE_TEXT[key] : "";
        },
      ),
      toggles,
    ),
  );

const parseToggleArg = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const token = normalized.split(/\s+/)[0] || "";
  if (["on", "true", "1", "enable", "enabled"].includes(token)) return true;
  if (["off", "false", "0", "disable", "disabled"].includes(token))
    return false;
  return null;
};

const statusText = (toggles) =>
  `Toggle status: ${TOGGLE_KEYS.map((key) => `${key}=${toggles[key] ? "ON" : "OFF"}`).join(", ")}`;

const enabledToggleKeys = (toggles) =>
  TOGGLE_KEYS.filter((key) => Boolean(toggles && toggles[key]));

const buildBootstrap = (toggles) => {
  const enabled = enabledToggleKeys(toggles);
  const enabledText = enabled.length ? enabled.join(", ") : "none";
  return `<FRAMEWORK_IMPORTANT>
You are running inside the Hybrid Framework runtime.

Framework root: ${FRAMEWORK_ROOT}
Runtime toggles enabled: ${enabledText}

Key references (do not inline full docs):
- ${FRAMEWORK_NAME}/context/project/runtime-preferences.md
- ${FRAMEWORK_NAME}/skills/core-delegation/SKILL.md
</FRAMEWORK_IMPORTANT>`;
};

// Gate instructions, injected only when the gate is ON and only for the active agent.
// Values are plain markdown fragments (no status headers).
const GATE_INJECTIONS_BY_AGENT = {
  "hf-core-agent": {
    use_worktree:
      "- Use worktree-aware workspace strategy when relevant.\n- Avoid destructive git commands unless explicitly requested.",
    require_tests:
      "- Do not claim ready/done without fresh test evidence.\n- Include the exact command(s) run and key results.",
    require_verification:
      "- Do not claim ready/done without verification evidence.\n- Include explicit evidence pointers (commands + results) in the final report.",
    task_artifacts:
      "- Maintain lifecycle artifacts in .tmp/task-lifecycle.json for multi-step/delegated work.\n- Report lifecycle status snapshot and next-ready task(s) at completion.",
  },
  "hf-task-planner": {
    require_tests: "- Plan includes explicit test verify commands and evidence expectations.",
    require_verification: "- Plan includes verification/review evidence expectations.",
    task_artifacts: "- Plan includes a lifecycle artifact step (TaskManager / task loop).",
  },
  "hf-coder": {
    require_tests: "- Track what tests must be run for this change; do not claim done without results.",
    require_verification: "- Track verification evidence requirements for completion reporting.",
    task_artifacts: "- Keep lifecycle artifact state consistent with execution progress.",
  },
  "hf-tester": {
    require_tests: "- Provide fresh, scoped test evidence (commands + results).",
  },
  "hf-build-validator": {
    require_verification: "- Provide fresh build/type evidence (commands + results).",
  },
  "hf-reviewer": {
    require_verification: "- Do not approve without checking required evidence is present and current.",
  },
  "hf-task-manager": {
    task_artifacts: "- Maintain .tmp/task-lifecycle.json lifecycle state and dependency validity.",
  },
};

const injectAgentGateBehavior = (systemEntries, toggles, agentName) => {
  if (!agentName) return systemEntries;
  const byGate = GATE_INJECTIONS_BY_AGENT[agentName];
  if (!byGate) return systemEntries;
  const next = Array.isArray(systemEntries) ? [...systemEntries] : [];
  for (const key of TOGGLE_KEYS) {
    if (!toggles[key]) continue;
    const text = byGate[key];
    if (!text) continue;
    if (next.includes(text)) continue;
    next.push(text);
  }
  return next;
};

// Optional per-agent behavior injection (keeps agent markdown clean).
// Keys are agent names (frontmatter `name:`). Values are system blocks.
const AGENT_INJECTIONS = {
  // Example:
  // "hf-core-agent": "<FRAMEWORK_AGENT>...custom...</FRAMEWORK_AGENT>",
};

const agentNameFromMessages = (messages) => {
  if (!Array.isArray(messages) || !messages.length) return null;
  // Prefer the most recent message with a string `info.agent`.
  for (let i = messages.length - 1; i >= 0; i--) {
    const info =
      messages[i] && typeof messages[i] === "object" ? messages[i].info : null;
    const agent = info && typeof info === "object" ? info.agent : null;
    if (typeof agent === "string" && agent.trim()) return agent.trim();
  }
  return null;
};

const sessionIDFromMessages = (messages) => {
  if (!Array.isArray(messages) || !messages.length) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const info =
      messages[i] && typeof messages[i] === "object" ? messages[i].info : null;
    const sessionID = info && typeof info === "object" ? info.sessionID : null;
    if (typeof sessionID === "string" && sessionID.trim())
      return sessionID.trim();
  }
  return null;
};

const recordActiveAgent = (sessionID, agentName) => {
  if (!sessionID || typeof sessionID !== "string") return;
  if (!agentName || typeof agentName !== "string") return;
  ACTIVE_AGENT_BY_SESSION.set(sessionID, agentName);
  // Best-effort bound to avoid unbounded growth.
  if (ACTIVE_AGENT_BY_SESSION.size > 200) {
    const firstKey = ACTIVE_AGENT_BY_SESSION.keys().next().value;
    if (firstKey) ACTIVE_AGENT_BY_SESSION.delete(firstKey);
  }
};

const injectAgentBehavior = (systemEntries, sessionID) => {
  const agent = sessionID ? ACTIVE_AGENT_BY_SESSION.get(sessionID) : null;
  if (!agent) return systemEntries;
  const injection = AGENT_INJECTIONS[agent];
  if (!injection) return systemEntries;
  const next = Array.isArray(systemEntries) ? [...systemEntries] : [];
  if (!next.includes(injection)) {
    next.push(injection);
  }
  return next;
};

const isCommandOutput = (value) =>
  typeof value === "object" &&
  value !== null &&
  "parts" in value &&
  Array.isArray(value.parts);

const z = tool.schema;
const toggleEnum = z.enum(TOGGLE_KEYS);

export const FrameworkBootstrapPlugin = async (input) => {
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
          enabled: z.boolean(),
        },
        execute: async (args) => {
          setToggle(input.directory, args.key, args.enabled);
          await disposeCurrentInstance();
          return `Toggle Updated: ${args.key}=${args.enabled ? "ON" : "OFF"}`;
        },
      }),
      toggle_get: tool({
        description: "Get runtime toggle state",
        args: {
          key: toggleEnum.optional(),
        },
        execute: async (args) => {
          const toggles = getState(input.directory);
          if (args.key) {
            return `${args.key}=${toggles[args.key] ? "ON" : "OFF"}`;
          }
          return statusText(toggles);
        },
      }),
    },
    "command.execute.before": async (cmd, output) => {
      const command = String(cmd.command || "")
        .replace(/^\/+/, "")
        .toLowerCase();
      if (!isCommandOutput(output)) {
        return;
      }

      if (command === "toggle-status") {
        output.parts.push({
          type: "text",
          text: `Toggle Status: ${statusText(getState(input.directory)).replace(/^Toggle status:\s*/i, "")}`,
        });
        return;
      }

      const toggleKey = COMMAND_TOGGLE_MAP[command];
      if (!toggleKey) {
        return;
      }
      const parsedValue = parseToggleArg(cmd.arguments);
      if (parsedValue === null) {
        output.parts.push({
          type: "text",
          text: `Usage: /${command} <on|off>`,
        });
        return;
      }
      setToggle(input.directory, toggleKey, parsedValue);
      output.parts.push({
        type: "text",
        text: `Toggle Updated: ${toggleKey}=${parsedValue ? "ON" : "OFF"}`,
      });
      await disposeCurrentInstance();
      return;
    },
    "tool.execute.after": async (ctx, output) => {
      if (typeof output.output !== "string") {
        return;
      }
      if (!hasInterpolationTokens(output.output)) {
        return;
      }
      const toggles = getState(input.directory);
      output.output = interpolateText(output.output, toggles);
    },
    "experimental.chat.messages.transform": async (_ctx, output) => {
      try {
        const sessionID = sessionIDFromMessages(output.messages);
        const agentName = agentNameFromMessages(output.messages);
        if (sessionID && agentName) recordActiveAgent(sessionID, agentName);
      } catch {
        // Ignore message transform failures.
      }
    },
    "experimental.chat.system.transform": async (_ctx, output) => {
      const toggles = getState(input.directory);
      output.system = (output.system || []).map((entry) =>
        interpolateText(entry, toggles),
      );
      (output.system ||= []).push(
        interpolateText(buildBootstrap(toggles), toggles),
      );
      const sessionID = _ctx && _ctx.sessionID;
      const agentName = sessionID
        ? ACTIVE_AGENT_BY_SESSION.get(sessionID)
        : null;
      output.system = injectAgentGateBehavior(
        output.system,
        toggles,
        agentName,
      );
      output.system = injectAgentBehavior(output.system, sessionID);
    },
  };
};

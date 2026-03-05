/**
 * Framework plugin for OpenCode — entry point.
 *
 * Goals:
 * - Lightweight and context-efficient bootstrap
 * - Toggle persistence to settings/framework-settings.json
 * - Runtime interpolation for markdown placeholders
 * - Toggle tools + lightweight slash command support
 */

import { tool } from "@opencode-ai/plugin";

import { TOGGLE_KEYS, COMMAND_TOGGLE_MAP } from "./lib/config.js";
import { getState, setToggle } from "./lib/state.js";
import {
  hasInterpolationTokens,
  interpolateText,
} from "./lib/interpolation.js";
import {
  agentNameFromMessages,
  sessionIDFromMessages,
  recordActiveAgent,
} from "./lib/session.js";
import {
  isCommandOutput,
  parseToggleArg,
  statusText,
  formatToggleStatusLine,
  formatToggleUpdatedAndStatus,
  buildBootstrap,
  updateToggleCommandDescriptions,
} from "./lib/commands.js";

const z = tool.schema;
const toggleEnum = z.enum(TOGGLE_KEYS);

export const FrameworkBootstrapPlugin = async (input) => {
  const log = (level, message, extra = {}) =>
    input.client.app.log({
      body: { service: "hybrid-framework", level, message, extra },
    });

  await log("info", "Plugin initialized", {
    directory: input.directory,
    toggles: getState(input.directory),
  });

  const disposeCurrentInstance = async () => {
    try {
      await input.client.instance.dispose({ directory: input.directory });
    } catch {
      // Ignore dispose failures.
    }
  };

  const updateCommandDescriptions = () => {
    try {
      updateToggleCommandDescriptions(getState(input.directory));
    } catch {
      // Ignore description update failures.
    }
  };

  return {
    event: async () => {},

    tool: {
      toggle_set: tool({
        description: "Set an individual runtime toggle state and persist it",
        args: { key: toggleEnum, enabled: z.boolean() },
        execute: async (args) => {
          setToggle(input.directory, args.key, args.enabled);
          updateCommandDescriptions();
          await log("info", "Toggle updated via tool", {
            key: args.key,
            enabled: args.enabled,
            allToggles: getState(input.directory),
          });
          await disposeCurrentInstance();
          return `Toggle Updated: ${args.key}=${args.enabled ? "ON" : "OFF"}`;
        },
      }),

      toggle_get: tool({
        description: "Get runtime toggle state",
        args: { key: toggleEnum.optional() },
        execute: async (args) => {
          const toggles = getState(input.directory);
          if (args.key)
            return `${args.key}=${toggles[args.key] ? "ON" : "OFF"}`;
          return statusText(toggles);
        },
      }),
    },

    "command.execute.before": async (cmd, output) => {
      const command = String(cmd.command ?? "")
        .replace(/^\/+/, "")
        .toLowerCase();
      if (!isCommandOutput(output)) return;

      if (command === "toggle-status") {
        output.parts.splice(0, output.parts.length, {
          type: "text",
          text: formatToggleStatusLine(getState(input.directory)),
          synthetic: true,
        });
        return;
      }

      const toggleKey = COMMAND_TOGGLE_MAP[command];
      if (!toggleKey) return;

      const parsedValue = parseToggleArg(cmd.arguments);
      if (parsedValue === null) {
        output.parts.push({
          type: "text",
          text: `Usage: /${command} <on|off>`,
        });
        return;
      }

      setToggle(input.directory, toggleKey, parsedValue);
      await log("info", "Toggle updated via command", {
        command,
        key: toggleKey,
        enabled: parsedValue,
        allToggles: getState(input.directory),
      });
      updateCommandDescriptions();
      output.parts.splice(0, output.parts.length, {
        type: "text",
        text: formatToggleUpdatedAndStatus(
          toggleKey,
          parsedValue,
          getState(input.directory),
        ),
        synthetic: true,
      });
      await disposeCurrentInstance();
    },

    "tool.execute.after": async (ctx, output) => {
      const toolName = String(ctx?.tool ?? "").toLowerCase();
      if (toolName === "read") {
        return;
      }

      if (typeof output.output !== "string") return;
      if (!hasInterpolationTokens(output.output)) return;
      output.output = interpolateText(output.output, getState(input.directory));
    },

    "experimental.chat.messages.transform": async (_ctx, output) => {
      const toggles = getState(input.directory);

      try {
        const sessionID = sessionIDFromMessages(output.messages);
        const agentName = agentNameFromMessages(output.messages);
        if (sessionID && agentName) recordActiveAgent(sessionID, agentName);
      } catch {
        // Ignore message transform failures.
      }

      // Interpolate user/assistant messages, but avoid synthetic parts (tool echoes
      // and read outputs) to prevent corrupting file contents during edit flows.
      try {
        let totalText = 0;
        let skippedSynthetic = 0;
        let interpolated = 0;
        for (const msg of output.messages ?? []) {
          for (const part of msg.parts ?? []) {
            if (!part || part.type !== "text") continue;
            totalText++;
            if (part.synthetic) {
              skippedSynthetic++;
              continue;
            }
            if (part.ignored) continue;
            if (typeof part.text !== "string") continue;
            if (!hasInterpolationTokens(part.text)) continue;
            part.text = interpolateText(part.text, toggles);
            interpolated++;
          }
        }
      } catch {
        // Ignore interpolation failures.
      }
    },

    "experimental.chat.system.transform": async (_ctx, output) => {
      const toggles = getState(input.directory);

      const systemEntries = output.system ?? [];
      const entriesWithTokens = systemEntries.filter(
        (e) => typeof e === "string" && hasInterpolationTokens(e),
      ).length;

      output.system = systemEntries.map((entry) =>
        hasInterpolationTokens(entry) ? interpolateText(entry, toggles) : entry,
      );

      const alreadyHasBootstrap = output.system.some(
        (e) => typeof e === "string" && e.includes("<FRAMEWORK_IMPORTANT>"),
      );

      const bootstrap = interpolateText(buildBootstrap(toggles), toggles);
      if (!alreadyHasBootstrap) {
        output.system.push(bootstrap);
      }

      await log("info", "System prompt interpolated", {
        toggles,
        entriesWithTokens,
        bootstrapInjected: !alreadyHasBootstrap,
      });
    },
  };
};

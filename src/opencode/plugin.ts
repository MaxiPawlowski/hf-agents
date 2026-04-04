import { hfLog } from "../runtime/logger.js";
import {
  type OpenCodePluginContext,
  type OpenCodeHook
} from "./plugin-utils.js";
import {
  createSessionManager,
  type HybridRuntimeHooksResult
} from "./plugin-session.js";
import { createInternalHooks, toOpenCodeHooks } from "./plugin-hooks.js";
import { createPluginTools } from "./plugin-tools.js";

export type { OpenCodePluginContext } from "./plugin-utils.js";
export type { HybridRuntimeHooksResult } from "./plugin-session.js";

export function createHybridRuntimeHooks(context: OpenCodePluginContext): HybridRuntimeHooksResult {
  const manager = createSessionManager(context);
  const hooks = createInternalHooks(context, manager);
  const tools = createPluginTools(context, manager);
  return { hooks, tools, planBindings: manager.planBindings, sessionRuntimes: manager.sessionRuntimes, getRuntime: manager.getRuntime };
}

export async function HybridRuntimePlugin(input: {
  directory?: string;
  worktree?: string;
  client?: unknown;
  [key: string]: unknown;
}): Promise<Record<string, unknown>> {
  hfLog({ tag: "plugin", msg: "HybridRuntimePlugin: initializing", data: { directory: input.directory } });

  const context: OpenCodePluginContext = {};
  if (input.directory) context.cwd = input.directory;

  // Wrap the OpenCode SDK client to match the internal prompt interface.
  const sdkClient = input.client as {
    session?: {
      prompt?: (opts: Record<string, unknown>) => Promise<unknown>;
      promptAsync?: (opts: Record<string, unknown>) => Promise<unknown>;
    };
  } | undefined;

  if (sdkClient?.session) {
    const sessionApi = sdkClient.session;
    context.client = {
      session: {
        prompt: async (opts: { sessionID: string; parts: Array<{ type: "text"; text: string }> }) => {
          const promptFn = sessionApi.promptAsync ?? sessionApi.prompt;
          if (!promptFn) return;
          return promptFn.call(sessionApi, {
            path: { id: opts.sessionID },
            body: { parts: opts.parts }
          });
        }
      }
    };
  }

  const { hooks: internalHooks, tools } = createHybridRuntimeHooks(context);
  return toOpenCodeHooks(internalHooks as Record<string, OpenCodeHook>, tools);
}

export default HybridRuntimePlugin;

import {
  applyOpenCodeDecision,
  ingestTurnOutcome,
  isDestructiveCommand,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import { HybridLoopRuntime, isManagedPlanUnavailable, resolveManagedPlanPath } from "../runtime/runtime.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import { hfLog, hfLogTimed } from "../runtime/logger.js";
import type { ContinueDecision, RuntimeEvent } from "../runtime/types.js";

export interface OpenCodePluginContext {
  cwd?: string;
  session?: {
    id?: string;
  };
  client?: {
    prompt?: (message: string, sessionId?: string) => Promise<unknown>;
    session?: {
      prompt?: (input: { sessionID: string; parts: Array<{ type: "text"; text: string }> }) => Promise<unknown>;
    };
  };
}

type HookInput = Record<string, unknown> | undefined;
type OpenCodeHook = (input?: HookInput, output?: HookInput) => Promise<unknown>;

function extractSessionId(input?: HookInput, output?: HookInput, context?: OpenCodePluginContext): string | undefined {
  const fromInput = input?.sessionID ?? input?.sessionId ?? input?.id;
  const fromOutput = output?.sessionID ?? output?.sessionId ?? output?.id;
  const fromNested = (input?.session as { id?: string } | undefined)?.id;
  return [fromInput, fromOutput, fromNested, context?.session?.id]
    .map((value) => (typeof value === "string" && value.length > 0 ? value : undefined))
    .find(Boolean);
}

function extractCommand(input?: HookInput, output?: HookInput): string {
  const outputArgs = output?.args as { command?: string } | undefined;
  const inputTool = input?.tool_input as { command?: string } | undefined;

  if (typeof outputArgs?.command === "string") {
    return outputArgs.command;
  }

  if (typeof inputTool?.command === "string") {
    return inputTool.command;
  }

  if (typeof input?.command === "string") {
    return input.command;
  }

  return "";
}

function toPayload(input?: HookInput, output?: HookInput): Record<string, unknown> {
  return {
    ...(input ?? {}),
    ...(output ? { output } : {})
  };
}

const HYDRATION_TIMEOUT_MS = 4_000;
const HOOK_DEADLINE_MS = 3_000;

function withHookDeadline<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), HOOK_DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer!));
}

async function hydrateRuntime(context: OpenCodePluginContext): Promise<HybridLoopRuntime> {
  const done = hfLogTimed({ tag: "plugin", msg: "hydrateRuntime" });
  const runtime = new HybridLoopRuntime();
  const cwd = context.cwd ?? process.cwd();

  let planPath: string | null = null;
  try {
    planPath = await resolveManagedPlanPath(cwd);
    hfLog({ tag: "plugin", msg: "resolved plan", data: { planPath } });
  } catch (error) {
    if (!isManagedPlanUnavailable(error)) {
      throw error;
    }
    hfLog({ tag: "plugin", msg: "no managed plan, using planless" });
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Runtime hydration timed out")), HYDRATION_TIMEOUT_MS);
  });

  try {
    const hydration = planPath
      ? runtime.hydrate(planPath)
      : runtime.hydratePlanless(cwd);
    await Promise.race([hydration, timeout]);
  } finally {
    clearTimeout(timer!);
  }

  done({ planless: runtime.isPlanless() });
  return runtime;
}

async function recordOpenCodeEvent(
  runtime: HybridLoopRuntime,
  eventType: string,
  input: HookInput,
  output: HookInput,
  context: OpenCodePluginContext
): Promise<HybridLoopRuntime> {
  const sessionId = extractSessionId(input, output, context);
  const event: RuntimeEvent = {
    vendor: "opencode",
    type: `opencode.${eventType}`,
    timestamp: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    payload: toPayload(input, output)
  };
  await runtime.recordEvent(event);
  return runtime;
}

async function ingestOpenCodeOutcome(runtime: HybridLoopRuntime, input: HookInput, output: HookInput, sessionId?: string): Promise<{
  ingested: boolean;
  observed: boolean;
}> {
  const detection = detectTurnOutcomeInPayload({ input, output }, "opencode hook payload");
  return ingestTurnOutcome(runtime, {
    vendor: "opencode",
    source: detection.source,
    result: detection.result,
    ...(sessionId ? { sessionId } : {}),
    countMissingAsAttempt: true
  });
}

async function promptContinuation(
  decision: ContinueDecision,
  context: OpenCodePluginContext,
  sessionId?: string
): Promise<void> {
  if (decision.action !== "continue" || !decision.resume_prompt) {
    return;
  }

  if (context.client?.prompt) {
    await context.client.prompt(decision.resume_prompt, sessionId);
    return;
  }

  if (context.client?.session?.prompt && sessionId) {
    await context.client.session.prompt({
      sessionID: sessionId,
      parts: [{ type: "text", text: decision.resume_prompt }]
    });
  }
}

export function createHybridRuntimeHooks(context: OpenCodePluginContext): Record<string, OpenCodeHook> {
  let runtimePromise: Promise<HybridLoopRuntime | null> | null = null;

  const getRuntime = async (): Promise<HybridLoopRuntime | null> => {
    if (!runtimePromise) {
      hfLog({ tag: "plugin", msg: "getRuntime: first call, starting hydration" });
      runtimePromise = hydrateRuntime(context).catch((error) => {
        if (error instanceof Error && error.message === "Runtime hydration timed out") {
          hfLog({ tag: "plugin", msg: "getRuntime: hydration timed out" });
          return null;
        }
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise.catch((error) => {
      hfLog({ tag: "plugin", msg: "getRuntime: error", data: { error: String(error) } });
      runtimePromise = null;
      throw error;
    });
  };

  return {
    "tool.execute.before": async (input?: HookInput, output?: HookInput) => {
      hfLog({ tag: "plugin", msg: "hook: tool.execute.before" });
      const command = extractCommand(input, output);
      if (isDestructiveCommand(command)) {
        throw new Error("Hybrid runtime guardrail blocked a destructive command.");
      }
      // Fire-and-forget: event recording must not block tool execution
      getRuntime().then((runtime) => {
        if (runtime) {
          recordOpenCodeEvent(runtime, "tool.execute.before", input, output, context).catch(() => { });
        }
      }).catch(() => { });
      return null;
    },
    "session.created": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.created" });
        const runtime = await getRuntime();
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.created: no runtime" });
          return {};
        }
        await recordOpenCodeEvent(runtime, "session.created", input, output, context);
        const decision = await runtime.decideNext();
        done({ action: decision.action });
        return { additionalContext: decision.resume_prompt };
      })(), {});
    },
    "session.status": async () => {
      return withHookDeadline((async () => {
        const runtime = await getRuntime();
        if (!runtime) {
          return { enabled: false, reason: "hydration_timeout" };
        }
        const status = runtime.getStatus();
        return { ...status, planless: runtime.isPlanless() };
      })(), { enabled: false, reason: "hook_deadline" });
    },
    "session.compacted": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.compacted" });
        const runtime = await getRuntime();
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.compacted: no runtime" });
          return {};
        }
        await recordOpenCodeEvent(runtime, "session.compacted", input, output, context);
        await recordCompactionArchive(runtime, "opencode", "opencode.pre_compact_archive");
        const decision = await runtime.decideNext();
        done({ action: decision.action });
        return { additionalContext: decision.resume_prompt };
      })(), {});
    },
    "session.idle": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.idle" });
        const runtime = await getRuntime();
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.idle: no runtime" });
          return null;
        }
        const sessionId = extractSessionId(input, output, context);

        if (runtime.isPlanless()) {
          await recordOpenCodeEvent(runtime, "session.idle", input, output, context);
          const decision = await runtime.decideNext();
          done({ action: decision.action, planless: true });
          return decision;
        }

        await ingestOpenCodeOutcome(runtime, input, output, sessionId);
        const decision = await runtime.decideNext();
        const status = runtime.getStatus();

        done({ action: decision.action, loopState: status.loopState });
        return applyOpenCodeDecision(decision, {
          autoContinue: status.autoContinue,
          deliverPrompt: async (prompt) => promptContinuation({ ...decision, resume_prompt: prompt }, context, sessionId)
        });
      })(), null);
    },
    "subagent.started": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const runtime = await getRuntime();
        if (!runtime) {
          return null;
        }
        await recordOpenCodeEvent(runtime, "subagent.started", input, output, context);
        const subagentId = String(input?.subagent_id ?? input?.id ?? "unknown");
        const subagentName = String(input?.subagent_name ?? input?.name ?? "unnamed");
        await recordSubagentLifecycle(runtime, {
          id: subagentId,
          name: subagentName,
          status: "running"
        });
        return null;
      })(), null);
    },
    "subagent.completed": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const runtime = await getRuntime();
        if (!runtime) {
          return null;
        }
        await recordOpenCodeEvent(runtime, "subagent.completed", input, output, context);
        const subagentId = String(input?.subagent_id ?? input?.id ?? "unknown");
        const subagentName = String(input?.subagent_name ?? input?.name ?? "unnamed");
        const failed = input?.error !== undefined;
        await recordSubagentLifecycle(runtime, {
          id: subagentId,
          name: subagentName,
          status: failed ? "failed" : "completed"
        });
        return null;
      })(), null);
    }
  };
}

/**
 * Wrap internal hooks into the OpenCode-compatible Hooks shape.
 *
 * OpenCode recognises a fixed set of hook keys:
 *   - "tool.execute.before"  (filter – can block / modify)
 *   - "experimental.session.compacting"  (filter – inject compaction context)
 *   - "event"  (observer – receives all lifecycle events, void return)
 *
 * Session events such as session.created, session.idle, session.compacted etc.
 * are EVENT TYPES that arrive through the "event" hook – they are NOT valid
 * top-level hook names.  Registering them as top-level keys caused OpenCode to
 * silently ignore them.
 */
function toOpenCodeHooks(
  internalHooks: Record<string, OpenCodeHook>,
  context: OpenCodePluginContext
): Record<string, unknown> {
  return {
    /* ── filter hook – unchanged ─────────────────────────────────── */
    "tool.execute.before": internalHooks["tool.execute.before"],

    /* ── compaction hook – inject runtime context before compaction  */
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string }
    ) => {
      const done = hfLogTimed({ tag: "plugin", msg: "hook: experimental.session.compacting" });
      try {
        const result = await withHookDeadline(
          (async () => {
            return internalHooks["session.compacted"]?.({ sessionID: input.sessionID });
          })(),
          undefined
        );
        const additionalContext = (result as { additionalContext?: string } | undefined)?.additionalContext;
        if (additionalContext) {
          output.context.push(additionalContext);
        }
        done({ injected: !!additionalContext });
      } catch {
        done({ error: true });
      }
    },

    /* ── event observer – dispatches lifecycle events to internal hooks  */
    event: async (eventInput: { event: { type: string; properties?: Record<string, unknown> } }) => {
      const { event } = eventInput;
      hfLog({ tag: "plugin", msg: `event: ${event.type}`, ...(event.properties ? { data: event.properties } : {}) });

      try {
        const props = (event.properties ?? {}) as HookInput;

        switch (event.type) {
          case "session.created":
            await internalHooks["session.created"]?.(props);
            break;

          case "session.idle":
            await internalHooks["session.idle"]?.(props);
            break;

          case "session.compacted":
            // Post-compaction notification – context injection already
            // handled by experimental.session.compacting above.
            break;

          case "session.status":
            // Informational only – can't return data from event hook.
            break;

          default:
            // Catch subagent and other events.
            if (event.type.startsWith("subagent.")) {
              const hookName = event.type as string;
              await internalHooks[hookName]?.(props);
            }
            break;
        }
      } catch (err) {
        hfLog({ tag: "plugin", msg: `event handler error: ${event.type}`, data: { error: String(err) } });
      }
    }
  };
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

  const internalHooks = createHybridRuntimeHooks(context);
  return toOpenCodeHooks(internalHooks, context);
}

export default HybridRuntimePlugin;

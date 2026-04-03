import {
  isDestructiveCommand,
  isProtectedConfigEdit,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { hfLog, hfLogTimed } from "../runtime/logger.js";
import {
  type HookInput,
  type OpenCodeHook,
  type OpenCodePluginContext,
  extractSessionId,
  extractCommand,
  extractFilePath,
  recordOpenCodeEvent,
  ingestOpenCodeOutcome,
  promptContinuation,
  applyOpenCodeDecision,
  withHookDeadline
} from "./plugin-utils.js";
import type { SessionManager } from "./plugin-session.js";
import { isString } from "../runtime/utils.js";

type HookDeps = {
  context: OpenCodePluginContext;
  getRuntime: (sessionId: string) => Promise<HybridLoopRuntime | null>;
  getFlags: (sessionId: string) => { interrupted: boolean; activeAgentIsHf: boolean };
};

function makeMessageUpdatedHook(deps: HookDeps): OpenCodeHook {
  const { context, getFlags } = deps;
  return async (input?: HookInput) => {
    hfLog({ tag: "plugin", msg: "hook: message.updated" });
    const info = (input as { info?: Record<string, unknown> } | undefined)?.info;
    if (!info) {
      hfLog({ tag: "plugin", msg: "message.updated: missing info field — skipping flag update" });
      return null;
    }
    const infoSessionId = isString(info.sessionID) && info.sessionID.length > 0
      ? info.sessionID : undefined;
    const sessionId = infoSessionId ?? context.session?.id;
    if (!sessionId) {
      hfLog({ tag: "plugin", msg: "message.updated: no sessionId — skipping flag update" });
      return null;
    }
    const flags = getFlags(sessionId);
    const agent = isString(info.agent) ? info.agent : "";
    flags.activeAgentIsHf = agent.startsWith("hf-");
    if (info.role === "assistant") {
      const error = info.error as { name?: string } | undefined;
      if (error?.name === "MessageAbortedError") {
        flags.interrupted = true;
        hfLog({ tag: "plugin", msg: "message.updated: MessageAbortedError detected — interrupt flagged", data: { sessionId } });
      }
    }
    hfLog({ tag: "plugin", msg: "message.updated: flags updated", data: { sessionId, activeAgentIsHf: flags.activeAgentIsHf, interrupted: flags.interrupted } });
    return null;
  };
}

function makeToolExecuteBeforeHook(deps: HookDeps): OpenCodeHook {
  const { context, getRuntime } = deps;
  return async (input?: HookInput, output?: HookInput) => {
    hfLog({ tag: "plugin", msg: "hook: tool.execute.before" });
    const command = extractCommand(input, output);
    if (isDestructiveCommand(command)) {
      throw new Error("Hybrid runtime guardrail blocked a destructive command.");
    }
    const filePath = extractFilePath(input, output);
    if (filePath && isProtectedConfigEdit(filePath)) {
      throw new Error(`Hybrid runtime guardrail blocked an edit to protected config file: ${filePath}. Set HF_ALLOW_CONFIG_EDIT=1 to allow intentional changes.`);
    }
    const sessionId = extractSessionId(input, output, context);
    if (sessionId) {
      getRuntime(sessionId).then((runtime) => {
        if (runtime) {
          recordOpenCodeEvent(runtime, { eventType: "tool.execute.before", input, output, context }).catch(() => { });
        }
      }).catch(() => { });
    }
    return null;
  };
}

function createMessageAndToolHooks(deps: HookDeps): Record<string, OpenCodeHook> {
  return {
    "message.updated": makeMessageUpdatedHook(deps),
    "tool.execute.before": makeToolExecuteBeforeHook(deps)
  };
}

function makeSessionCompactedHook(deps: HookDeps): OpenCodeHook {
  const { context, getRuntime, getFlags } = deps;
  return async (input?: HookInput, output?: HookInput) => {
    return withHookDeadline((async () => {
      const done = hfLogTimed({ tag: "plugin", msg: "hook: session.compacted" });
      const sessionId = extractSessionId(input, output, context);
      if (!sessionId) { done({ skipped: true }); return {}; }
      const flags = getFlags(sessionId);
      if (!flags.activeAgentIsHf) {
        hfLog({ tag: "plugin", msg: "session.compacted: non-hf agent — skipping", data: { sessionId } });
        done({ skipped: true }); return {};
      }
      const runtime = await getRuntime(sessionId);
      if (!runtime) {
        hfLog({ tag: "plugin", msg: "session.compacted: no runtime (no plan binding)", data: { sessionId } });
        return {};
      }
      await recordOpenCodeEvent(runtime, { eventType: "session.compacted", input, output, context });
      await recordCompactionArchive(runtime, { vendor: "opencode", eventType: "opencode.pre_compact_archive" });
      const decision = await runtime.decideNext();
      done({ action: decision.action });
      return { additionalContext: decision.resume_prompt };
    })(), {});
  };
}

function makeSessionIdleHook(deps: HookDeps): OpenCodeHook {
  const { context, getRuntime, getFlags } = deps;
  return async (input?: HookInput, output?: HookInput) => {
    return withHookDeadline((async () => {
      const done = hfLogTimed({ tag: "plugin", msg: "hook: session.idle" });
      const sessionId = extractSessionId(input, output, context);
      if (!sessionId) { done({ skipped: "no-session" }); return null; }
      const flags = getFlags(sessionId);
      if (flags.interrupted) {
        flags.interrupted = false;
        done({ skipped: "interrupted" });
        return { action: "allow_stop", reason: "User interrupted generation (ESC). Skipping auto-continue." };
      }
      if (!flags.activeAgentIsHf) { done({ skipped: "non-hf" }); return null; }
      const runtime = await getRuntime(sessionId);
      if (!runtime) {
        hfLog({ tag: "plugin", msg: "session.idle: no runtime (no plan binding)", data: { sessionId } });
        return null;
      }
      if (runtime.isPlanless()) {
        await recordOpenCodeEvent(runtime, { eventType: "session.idle", input, output, context });
        const planlessDecision = await runtime.decideNext();
        done({ action: planlessDecision.action, planless: true });
        return planlessDecision;
      }
      await ingestOpenCodeOutcome(runtime, { input, output, sessionId });
      const decision = await runtime.decideNext();
      const status = runtime.getStatus();
      done({ action: decision.action, loopState: status.loopState });
      return applyOpenCodeDecision(decision, {
        autoContinue: status.autoContinue,
        deliverPrompt: async (prompt) => promptContinuation({ ...decision, resume_prompt: prompt }, context, sessionId)
      });
    })(), null);
  };
}

function createSessionHooks(deps: HookDeps): Record<string, OpenCodeHook> {
  const { context, getRuntime } = deps;
  return {
    "session.created": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.created" });
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) {
          hfLog({ tag: "plugin", msg: "session.created: no sessionId — skipping" });
          return {};
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.created: no runtime (no plan binding)", data: { sessionId } });
          done({ skipped: "no-binding" });
          return {};
        }
        await recordOpenCodeEvent(runtime, { eventType: "session.created", input, output, context });
        const decision = await runtime.decideNext();
        done({ action: decision.action });
        return { additionalContext: decision.resume_prompt };
      })(), {});
    },
    "session.status": async () => ({ enabled: false, reason: "no_active_session" }),
    "session.compacted": makeSessionCompactedHook(deps),
    "session.idle": makeSessionIdleHook(deps)
  };
}

function createSubagentHooks(deps: HookDeps): Record<string, OpenCodeHook> {
  const { context, getRuntime, getFlags } = deps;
  return {
    "subagent.started": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) return null;
        const flags = getFlags(sessionId);
        if (!flags.activeAgentIsHf) {
          hfLog({ tag: "plugin", msg: "subagent.started: non-hf agent — skipping", data: { sessionId } });
          return null;
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) return null;
        await recordOpenCodeEvent(runtime, { eventType: "subagent.started", input, output, context });
        await recordSubagentLifecycle(runtime, {
          id: String(input?.subagent_id ?? input?.id ?? "unknown"),
          name: String(input?.subagent_name ?? input?.name ?? "unnamed"),
          status: "running"
        });
        return null;
      })(), null);
    },
    "subagent.completed": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) return null;
        const flags = getFlags(sessionId);
        if (!flags.activeAgentIsHf) {
          hfLog({ tag: "plugin", msg: "subagent.completed: non-hf agent — skipping", data: { sessionId } });
          return null;
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) return null;
        await recordOpenCodeEvent(runtime, { eventType: "subagent.completed", input, output, context });
        await recordSubagentLifecycle(runtime, {
          id: String(input?.subagent_id ?? input?.id ?? "unknown"),
          name: String(input?.subagent_name ?? input?.name ?? "unnamed"),
          status: input?.error !== undefined ? "failed" : "completed"
        });
        return null;
      })(), null);
    }
  };
}

export function createInternalHooks(context: OpenCodePluginContext, manager: SessionManager): Record<string, OpenCodeHook> {
  const deps: HookDeps = { context, getRuntime: manager.getRuntime, getFlags: manager.getFlags };
  return {
    ...createMessageAndToolHooks(deps),
    ...createSessionHooks(deps),
    ...createSubagentHooks(deps)
  };
}

function createCompactionHook(internalHooks: Record<string, OpenCodeHook>) {
  return async (
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
  };
}

function createEventDispatcher(internalHooks: Record<string, OpenCodeHook>) {
  return async (eventInput: { event: { type: string; properties?: Record<string, unknown> } }) => {
    const { event } = eventInput;
    hfLog({ tag: "plugin", msg: `event: ${event.type}`, ...(event.properties ? { data: event.properties } : {}) });

    try {
      const props = (event.properties ?? {}) as HookInput;

      switch (event.type) {
        case "message.updated": {
          const info = event.properties?.info;
          await internalHooks["message.updated"]?.({ info });
          break;
        }

        case "session.created":
          await internalHooks["session.created"]?.(props);
          break;

        case "session.idle":
          await internalHooks["session.idle"]?.(props);
          break;

        case "session.compacted":
          break;

        case "session.status":
          break;

        default:
          if (event.type.startsWith("subagent.")) {
            const hookName = event.type as string;
            await internalHooks[hookName]?.(props);
          }
          break;
      }
    } catch (err) {
      hfLog({ tag: "plugin", msg: `event handler error: ${event.type}`, data: { error: String(err) } });
    }
  };
}

export function toOpenCodeHooks(
  internalHooks: Record<string, OpenCodeHook>,
  tools: Record<string, unknown>
): Record<string, unknown> {
  return {
    "tool.execute.before": internalHooks["tool.execute.before"],
    tool: tools,
    "experimental.session.compacting": createCompactionHook(internalHooks),
    event: createEventDispatcher(internalHooks)
  };
}

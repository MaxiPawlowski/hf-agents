import {
  hydrateRuntimeWithTimeout,
  ingestTurnOutcome,
  isDestructiveCommand,
  isProtectedConfigEdit,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import { hfLog, hfLogTimed } from "../runtime/logger.js";
import type { ContinueDecision, RuntimeEvent } from "../runtime/types.js";

export function mapDecisionToClaudeStopResponse(decision: ContinueDecision): Record<string, unknown> {
  switch (decision.action) {
    case "continue":
      return {
        decision: "block",
        reason: `${decision.reason} Continue with: ${decision.resume_prompt ?? "follow the current milestone"}`
      };
    case "allow_stop":
    case "pause":
    case "escalate":
    case "complete":
    case "max_turns":
      return {
        decision: "allow",
        reason: decision.reason
      };
  }
}

const HOOK_TIMEOUT_MS = 4_000;

export interface ClaudeHookInput {
  session_id?: string;
  tool_name?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  tool_input?: {
    command?: string;
    file_path?: string;
    filePath?: string;
  };
}

export function toRuntimeEvent(eventName: string, input: ClaudeHookInput): RuntimeEvent {
  const payload = input.metadata ?? (input.tool_name ? { tool_name: input.tool_name } : undefined);

  return {
    vendor: "claude",
    type: `claude.${eventName}`,
    timestamp: new Date().toISOString(),
    ...(input.session_id ? { sessionId: input.session_id } : {}),
    ...(payload ? { payload } : {})
  };
}

function handlePreToolUse(
  eventName: string,
  input: ClaudeHookInput
): Record<string, unknown> | null {
  if (input.tool_name === "Bash") {
    const command = String(input.tool_input?.command ?? input.metadata?.command ?? "");
    if (isDestructiveCommand(command)) {
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: "Hybrid runtime guardrail blocked a destructive command."
        }
      };
    }
  }
  const writeEditTools = new Set(["Write", "Edit", "MultiEdit", "FileEdit"]);
  if (writeEditTools.has(input.tool_name ?? "")) {
    const filePath = String(input.tool_input?.file_path ?? input.metadata?.file_path ?? "");
    if (filePath && isProtectedConfigEdit(filePath)) {
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: `Hybrid runtime guardrail blocked an edit to protected config file: ${filePath}. Set HF_ALLOW_CONFIG_EDIT=1 to allow intentional changes.`
        }
      };
    }
  }
  return null;
}

async function handleSessionOrPrompt(
  runtime: HybridLoopRuntime,
  eventName: string
): Promise<Record<string, unknown>> {
  const decision = await runtime.decideNext();
  hfLog({ tag: "claude-hook", msg: `${eventName} decision`, data: { action: decision.action } });
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: decision.resume_prompt
    }
  };
}

async function handlePreCompact(
  runtime: HybridLoopRuntime,
  eventName: string,
  input: ClaudeHookInput
): Promise<Record<string, unknown>> {
  const decision = await runtime.decideNext();
  await recordCompactionArchive(runtime, {
    vendor: "claude",
    eventType: "claude.pre_compact_archive",
    ...(input.session_id ? { sessionId: input.session_id } : {})
  });
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: decision.resume_prompt
    }
  };
}

function resolveSubagentStatus(
  eventName: string,
  input: ClaudeHookInput
): "running" | "completed" | "failed" {
  if (eventName === "SubagentStart") {
    return "running";
  }
  if (input.metadata?.error !== undefined) {
    return "failed";
  }
  return "completed";
}

async function handleSubagentEvent(
  runtime: HybridLoopRuntime,
  eventName: string,
  input: ClaudeHookInput
): Promise<Record<string, unknown>> {
  const subagentId = String(input.metadata?.subagent_id ?? input.session_id ?? "unknown");
  const subagentName = String(input.metadata?.subagent_name ?? input.tool_name ?? "unnamed");
  await recordSubagentLifecycle(runtime, {
    id: subagentId,
    name: subagentName,
    status: resolveSubagentStatus(eventName, input)
  });
  return { decision: "allow" };
}

async function handleStop(
  runtime: HybridLoopRuntime,
  eventName: string,
  input: ClaudeHookInput
): Promise<Record<string, unknown>> {
  if (runtime.isPlanless()) {
    await runtime.recordEvent(toRuntimeEvent(eventName, input));
    const decision = await runtime.decideNext();
    return mapDecisionToClaudeStopResponse(decision);
  }

  const detection = detectTurnOutcomeInPayload(input, "claude hook input");
  await ingestTurnOutcome(runtime, {
    vendor: "claude",
    source: detection.source,
    result: detection.result,
    ...(input.session_id ? { sessionId: input.session_id } : {}),
    countMissingAsAttempt: true
  });

  const decision = await runtime.decideNext();
  return mapDecisionToClaudeStopResponse(decision);
}

async function hydrateOrTimeout(
  opts: { cwd: string; explicitPlanPath?: string },
  eventName: string
): Promise<HybridLoopRuntime | null> {
  try {
    return await hydrateRuntimeWithTimeout({
      cwd: opts.cwd,
      timeoutMs: HOOK_TIMEOUT_MS,
      timeoutMessage: "Hook hydration timed out",
      tag: "claude-hook",
      ...(opts.explicitPlanPath ? { explicitPlanPath: opts.explicitPlanPath } : {})
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "Hook hydration timed out")) {
      throw error;
    }
    hfLog({ tag: "claude-hook", msg: "hydration timed out", data: { eventName } });
    return null;
  }
}

export async function handleClaudeHook(
  eventName: string,
  input: ClaudeHookInput,
  opts: { cwd: string; explicitPlanPath?: string }
): Promise<Record<string, unknown>> {
  const hookDone = hfLogTimed({ tag: "claude-hook", msg: `handleClaudeHook(${eventName})` });

  if (eventName === "PostToolUse" || eventName === "Notification") {
    hookDone({ shortCircuit: true });
    return { decision: "allow" };
  }

  if (eventName === "PreToolUse") {
    const denied = handlePreToolUse(eventName, input);
    if (denied) { hookDone({ blocked: true }); return denied; }
    hookDone({ shortCircuit: true });
    return { decision: "allow" };
  }

  const runtime = await hydrateOrTimeout(opts, eventName);
  if (!runtime) {
    const isContextEvent = eventName === "SessionStart" || eventName === "UserPromptSubmit" || eventName === "PreCompact";
    return isContextEvent ? { hookSpecificOutput: { hookEventName: eventName } } : { decision: "allow" };
  }

  if (eventName !== "Stop") {
    await runtime.recordEvent(toRuntimeEvent(eventName, input));
  }

  if (eventName === "SessionStart" || eventName === "UserPromptSubmit") {
    const result = await handleSessionOrPrompt(runtime, eventName);
    hookDone({ action: eventName });
    return result;
  }
  if (eventName === "PreCompact") {
    const result = await handlePreCompact(runtime, eventName, input);
    hookDone({ action: eventName });
    return result;
  }
  if (eventName === "SubagentStart" || eventName === "SubagentStop") {
    return handleSubagentEvent(runtime, eventName, input);
  }
  if (eventName === "Stop") {
    const result = await handleStop(runtime, eventName, input);
    hookDone({ action: (result as Record<string, unknown>).decision });
    return result;
  }

  hookDone({ fallthrough: true });
  return { decision: "allow" };
}

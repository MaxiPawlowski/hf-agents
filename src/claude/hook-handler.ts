import {
  ingestTurnOutcome,
  isDestructiveCommand,
  mapDecisionToClaudeStopResponse,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import { HybridLoopRuntime, isManagedPlanUnavailable, resolveManagedPlanPath } from "../runtime/runtime.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import { hfLog, hfLogTimed } from "../runtime/logger.js";
import type { RuntimeEvent } from "../runtime/types.js";

const HOOK_TIMEOUT_MS = 4_000;

export interface ClaudeHookInput {
  session_id?: string;
  tool_name?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  tool_input?: {
    command?: string;
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

export async function handleClaudeHook(
  eventName: string,
  input: ClaudeHookInput,
  cwd: string,
  explicitPlanPath?: string
): Promise<Record<string, unknown>> {
  const hookDone = hfLogTimed({ tag: "claude-hook", msg: `handleClaudeHook(${eventName})` });

  if (eventName === "PostToolUse" || eventName === "Notification") {
    hookDone({ shortCircuit: true });
    return { decision: "allow" };
  }

  if (eventName === "PreToolUse") {
    if (input.tool_name === "Bash") {
      const command = String(input.tool_input?.command ?? input.metadata?.command ?? "");
      if (isDestructiveCommand(command)) {
        hookDone({ blocked: true });
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            permissionDecision: "deny",
            permissionDecisionReason: "Hybrid runtime guardrail blocked a destructive command."
          }
        };
      }
    }
    // All PreToolUse calls return immediately — no hydration needed
    hookDone({ shortCircuit: true });
    return { decision: "allow" };
  }

  const runtime = new HybridLoopRuntime();
  let planPath: string | null = null;
  try {
    planPath = await resolveManagedPlanPath(cwd, explicitPlanPath);
    hfLog({ tag: "claude-hook", msg: "resolved plan", data: { planPath } });
  } catch (error) {
    if (!isManagedPlanUnavailable(error)) {
      throw error;
    }
    hfLog({ tag: "claude-hook", msg: "no managed plan, using planless" });
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Hook hydration timed out")), HOOK_TIMEOUT_MS);
  });
  try {
    const hydration = planPath
      ? runtime.hydrate(planPath)
      : runtime.hydratePlanless(cwd);
    await Promise.race([hydration, timeout]);
  } catch (error) {
    if (!(error instanceof Error && error.message === "Hook hydration timed out")) {
      throw error;
    }

    hfLog({ tag: "claude-hook", msg: "hydration timed out", data: { eventName } });

    if (eventName === "SessionStart" || eventName === "UserPromptSubmit" || eventName === "PreCompact") {
      return {
        hookSpecificOutput: {
          hookEventName: eventName
        }
      };
    }

    return { decision: "allow" };
  } finally {
    clearTimeout(timer!);
  }
  if (eventName !== "Stop") {
    await runtime.recordEvent(toRuntimeEvent(eventName, input));
  }

  if (eventName === "SessionStart" || eventName === "UserPromptSubmit") {
    const decision = await runtime.decideNext();
    hfLog({ tag: "claude-hook", msg: `${eventName} decision`, data: { action: decision.action } });
    hookDone({ action: decision.action });
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: decision.resume_prompt
      }
    };
  }

  if (eventName === "PreCompact") {
    const decision = await runtime.decideNext();
    await recordCompactionArchive(runtime, "claude", "claude.pre_compact_archive", input.session_id);
    hookDone({ action: decision.action });
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: decision.resume_prompt
      }
    };
  }

  if (eventName === "SubagentStart") {
    const subagentId = String(input.metadata?.subagent_id ?? input.session_id ?? "unknown");
    const subagentName = String(input.metadata?.subagent_name ?? input.tool_name ?? "unnamed");
    await recordSubagentLifecycle(runtime, {
      id: subagentId,
      name: subagentName,
      status: "running"
    });
    return { decision: "allow" };
  }

  if (eventName === "SubagentStop") {
    const subagentId = String(input.metadata?.subagent_id ?? input.session_id ?? "unknown");
    const subagentName = String(input.metadata?.subagent_name ?? input.tool_name ?? "unnamed");
    const failed = input.metadata?.error !== undefined;
    await recordSubagentLifecycle(runtime, {
      id: subagentId,
      name: subagentName,
      status: failed ? "failed" : "completed"
    });
    return { decision: "allow" };
  }

  if (eventName === "Stop") {
    if (runtime.isPlanless()) {
      await runtime.recordEvent(toRuntimeEvent(eventName, input));
      const decision = await runtime.decideNext();
      hookDone({ action: decision.action, planless: true });
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
    hookDone({ action: decision.action });
    return mapDecisionToClaudeStopResponse(decision);
  }

  hookDone({ fallthrough: true });
  return {
    decision: "allow"
  };
}

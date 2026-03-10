import {
  ingestTurnOutcome,
  isDestructiveCommand,
  mapDecisionToClaudeStopResponse,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import { HybridLoopRuntime, resolveManagedPlanPath } from "../runtime/runtime.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import type { RuntimeEvent } from "../runtime/types.js";

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
  if (eventName === "PostToolUse" || eventName === "Notification") {
    return { decision: "allow" };
  }

  if (eventName === "PreToolUse" && input.tool_name === "Bash") {
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

  const runtime = new HybridLoopRuntime();
  const resolvedPlanPath = await resolveManagedPlanPath(cwd, explicitPlanPath);

  await runtime.hydrate(resolvedPlanPath);
  if (eventName !== "Stop") {
    await runtime.recordEvent(toRuntimeEvent(eventName, input));
  }

  if (eventName === "SessionStart" || eventName === "UserPromptSubmit") {
    const decision = runtime.decideNext();
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: decision.resume_prompt
      }
    };
  }

  if (eventName === "PreCompact") {
    const decision = runtime.decideNext();
    await recordCompactionArchive(runtime, "claude", "claude.pre_compact_archive", input.session_id);
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
    const detection = detectTurnOutcomeInPayload(input, "claude hook input");
    await ingestTurnOutcome(runtime, {
      vendor: "claude",
      source: detection.source,
      result: detection.result,
      ...(input.session_id ? { sessionId: input.session_id } : {}),
      countMissingAsAttempt: true
    });

    return mapDecisionToClaudeStopResponse(runtime.decideNext());
  }

  return {
    decision: "allow"
  };
}

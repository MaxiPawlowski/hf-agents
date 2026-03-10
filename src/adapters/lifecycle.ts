import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { buildTurnOutcomeIngestionEvent, type TurnOutcomeTrailerParseResult } from "../runtime/turn-outcome-trailer.js";
import type { ContinueDecision, RuntimeVendor } from "../runtime/types.js";

export const DESTRUCTIVE_COMMAND_PATTERN = /git reset --hard|git checkout --|rm -rf/i;

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERN.test(command);
}

export async function recordCompactionArchive(
  runtime: HybridLoopRuntime,
  vendor: RuntimeVendor,
  eventType: string,
  sessionId?: string
): Promise<void> {
  await runtime.recordEvent({
    vendor,
    type: eventType,
    timestamp: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    payload: {
      reason: "context_compaction",
      status_snapshot: runtime.getStatus() as unknown as Record<string, unknown>
    }
  });
}

export async function recordSubagentLifecycle(
  runtime: HybridLoopRuntime,
  params: {
    id: string;
    name: string;
    status: "running" | "completed" | "failed";
  }
): Promise<void> {
  const existing = runtime.getStatus().subagents.find((subagent) => subagent.id === params.id);
  const now = new Date().toISOString();

  await runtime.recordSubagent({
    id: params.id,
    name: params.name,
    startedAt: params.status === "running" ? now : existing?.startedAt ?? now,
    ...(params.status === "running" ? {} : { completedAt: now }),
    status: params.status
  });
}

export async function ingestTurnOutcome(
  runtime: HybridLoopRuntime,
  params: {
    vendor: RuntimeVendor;
    source: string;
    result: TurnOutcomeTrailerParseResult;
    sessionId?: string;
    countMissingAsAttempt: boolean;
  }
): Promise<{ ingested: boolean; observed: boolean }> {
  if (params.result.kind === "valid") {
    await runtime.recordEvent({
      vendor: params.vendor,
      type: "turn_outcome.accepted",
      timestamp: new Date().toISOString(),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      payload: {
        source: params.source,
        state: params.result.outcome.state,
        summary: params.result.outcome.summary
      }
    });
    await runtime.evaluateTurn(params.result.outcome);
    return { ingested: true, observed: true };
  }

  await runtime.recordOutcomeIngestionIssue(buildTurnOutcomeIngestionEvent({
    vendor: params.vendor,
    source: params.source,
    result: params.result,
    ...(params.sessionId ? { sessionId: params.sessionId } : {})
  }));

  if (params.result.kind === "missing" && params.countMissingAsAttempt) {
    await runtime.noteStopWithoutOutcome();
  }

  return {
    ingested: false,
    observed: params.result.kind === "invalid"
  };
}

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

export async function applyOpenCodeDecision(
  decision: ContinueDecision,
  params: {
    autoContinue: boolean;
    deliverPrompt?: (prompt: string) => Promise<void>;
  }
): Promise<ContinueDecision> {
  if (decision.action === "continue" && params.autoContinue && decision.resume_prompt && params.deliverPrompt) {
    await params.deliverPrompt(decision.resume_prompt);
  }

  return decision;
}

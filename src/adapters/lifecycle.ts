import { HybridLoopRuntime, isManagedPlanUnavailable, resolveManagedPlanPath } from "../runtime/runtime.js";
import { buildTurnOutcomeIngestionEvent, type TurnOutcomeTrailerParseResult } from "../runtime/turn-outcome-trailer.js";
import type { RuntimeVendor } from "../runtime/types.js";
import { setEmbeddingIpcRoot } from "../runtime/vault-embeddings.js";
import { hfLog } from "../runtime/logger.js";
import { withDeadline } from "../runtime/utils.js";

export const DESTRUCTIVE_COMMAND_PATTERN = /git reset --hard|git checkout --|rm -rf/i;

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERN.test(command);
}

export const PROTECTED_CONFIG_FILES = [
  ".oxlintrc.json",
  "sonar-project.properties",
  ".husky/pre-commit"
] as const;

export function isProtectedConfigEdit(filePath: string): boolean {
  if (process.env.HF_ALLOW_CONFIG_EDIT === "1") {
    return false;
  }
  const normalized = filePath.replace(/\\/g, "/");
  return PROTECTED_CONFIG_FILES.some((f) => normalized === f || normalized.endsWith(`/${f}`));
}

// oxlint-disable max-params -- runtime, vendor, eventType, sessionId are distinct; collapsing to an object would require a breaking API change
export async function recordCompactionArchive(
  runtime: HybridLoopRuntime,
  vendor: RuntimeVendor,
  eventType: string,
  sessionId?: string
): Promise<void> {
// oxlint-enable max-params
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

export async function hydrateRuntimeWithTimeout(opts: {
  cwd: string;
  timeoutMs: number;
  timeoutMessage: string;
  tag: string;
  explicitPlanPath?: string;
}): Promise<HybridLoopRuntime> {
  const runtime = new HybridLoopRuntime();
  if (opts.tag === "claude-hook") {
    setEmbeddingIpcRoot(opts.cwd);
  }
  let planPath: string | null = null;
  try {
    planPath = await resolveManagedPlanPath(opts.cwd, opts.explicitPlanPath);
    hfLog({ tag: opts.tag, msg: "resolved plan", data: { planPath } });
  } catch (error) {
    if (!isManagedPlanUnavailable(error)) {
      throw error;
    }
    hfLog({ tag: opts.tag, msg: "no managed plan, using planless" });
  }

  const hydration = planPath
    ? runtime.hydrate(planPath)
    : runtime.hydratePlanless(opts.cwd);
  await withDeadline(hydration, opts.timeoutMs, () => {
    throw new Error(opts.timeoutMessage);
  });

  return runtime;
}

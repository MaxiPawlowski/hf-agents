import path from "node:path";
import { promises as fs } from "node:fs";

import { parsePlan } from "./plan-doc.js";

/**
 * Re-parse the plan only if the file has been modified since last parse.
 * Returns the cached plan if mtime is unchanged.
 */
async function reParsePlanIfChanged(current: ParsedPlan): Promise<ParsedPlan> {
  const stats = await fs.stat(current.path);
  if (stats.mtimeMs === current.mtimeMs) return current;
  return parsePlan(current.path);
}
import { appendEvent, ensureRuntimeDir, ensurePlanlessRuntimeDir, getPlanlessVaultPaths, getRepoRoot, getVaultPaths, loadIndexConfig, readStatus, readVaultContext, writeResumePrompt, writeStatus } from "./persistence.js";
import { buildPlanlessResumePrompt, buildResumePrompt } from "./prompt.js";
import { warmupEmbeddingModel } from "./vault-embeddings.js";
import { hfLog, hfLogTimed } from "./logger.js";
import {
  REPEATED_BLOCKER_THRESHOLD,
  VERIFICATION_FAILURE_THRESHOLD,
  NO_PROGRESS_THRESHOLD,
  type ContinueDecision,
  type IndexConfig,
  type LoopRuntime,
  type ParsedPlan,
  type RuntimeEvent,
  type RuntimeStatus,
  type SubagentRef,
  type TurnOutcome,
  type VaultContext,
  type VaultSearchResult,
} from "./types.js";
import {
  type UnifiedIndexState,
  type VaultIndexState,
  type QueryIndexOpts,
  queryIndexItems,
  refreshVaultIndex,
} from "./runtime-vault.js";
import {
  applyLoopState,
  applyOutcomePhase,
  applyOutcomeCounters,
  computeDecision,
  detectRecoveryTrigger,
  isExplicitBuilderApprovalEvent,
} from "./runtime-decisions.js";

export { REPEATED_BLOCKER_THRESHOLD, VERIFICATION_FAILURE_THRESHOLD, NO_PROGRESS_THRESHOLD };
export type { DecisionInput } from "./runtime-decisions.js";
export { computeDecision } from "./runtime-decisions.js";

/** Default max turns for planless mode. */
const DEFAULT_PLANLESS_MAX_TURNS = 50;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStatus(plan: ParsedPlan): RuntimeStatus {
  return {
    version: 1,
    planPath: plan.path,
    planSlug: plan.slug,
    planMtimeMs: plan.mtimeMs,
    loopState: plan.completed ? "complete" : "idle",
    phase: plan.approved ? "execution" : "planning",
    currentMilestone: plan.currentMilestone,
    counters: {
      totalAttempts: 0,
      totalTurns: 0,
      maxTotalTurns: plan.config.maxTotalTurns,
      noProgress: 0,
      repeatedBlocker: 0,
      verificationFailures: 0,
      turnsSinceLastOutcome: 0
    },
    sessions: {},
    subagents: [],
    awaitingBuilderApproval: false,
    autoContinue: plan.config.autoContinue,
    updatedAt: nowIso()
  };
}

export function isManagedPlanUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.startsWith("No plan specified.")
    || error.message.startsWith("Plan doc does not contain a ## Milestones section");
}

export class HybridLoopRuntime implements LoopRuntime {
  private plan: ParsedPlan | null = null;
  private status: RuntimeStatus | null = null;
  private vault: VaultContext | null = null;
  private unifiedIndex: UnifiedIndexState | null = null;
  private vaultSearchResults: VaultSearchResult[] | null = null;
  private planlessCwd: string | null = null;
  private indexConfig: IndexConfig | null = null;
  private promptDirty = true;

  private buildVaultIndexSnapshot(): VaultIndexState {
    return {
      unifiedIndex: this.unifiedIndex,
      vaultSearchResults: this.vaultSearchResults,
      plan: this.plan,
      planlessCwd: this.planlessCwd,
      vault: this.vault,
      indexConfig: this.indexConfig,
      lastIndexError: this.status?.lastIndexError,
    };
  }

  private applyVaultIndexSnapshot(snapshot: VaultIndexState): void {
    this.unifiedIndex = snapshot.unifiedIndex;
    this.vaultSearchResults = snapshot.vaultSearchResults;
    if (this.status) {
      if (snapshot.lastIndexError !== undefined) {
        this.status.lastIndexError = snapshot.lastIndexError;
      } else {
        delete this.status.lastIndexError;
      }
    }
  }

  private async doRefreshVaultIndex(): Promise<void> {
    const snapshot = this.buildVaultIndexSnapshot();
    await refreshVaultIndex(snapshot);
    this.applyVaultIndexSnapshot(snapshot);
  }

  public async hydrate(planRef: string): Promise<RuntimeStatus> {
    const done = hfLogTimed({ tag: "runtime", msg: "hydrate", data: { planRef } });
    const plan = await parsePlan(planRef);
    const runtimePaths = await ensureRuntimeDir(plan);
    const existing = await readStatus(runtimePaths);
    this.plan = plan;
    // Vault context is loaded lazily in decideNext() to keep hydration fast.
    this.vault = null;
    this.unifiedIndex = null;
    this.vaultSearchResults = null;
    this.promptDirty = true;
    const defaults = defaultStatus(plan);
    const baseStatus = existing ?? defaults;

    this.status = {
      ...baseStatus,
      planPath: plan.path,
      planSlug: plan.slug,
      planMtimeMs: plan.mtimeMs,
      phase: plan.approved ? "execution" : "planning",
      currentMilestone: plan.currentMilestone,
      loopState: plan.completed ? "complete" : baseStatus.loopState,
      // Sync config from plan doc on every hydration so edits take effect
      counters: {
        ...defaults.counters,
        ...baseStatus.counters,
        totalAttempts: baseStatus.counters.totalAttempts,
        maxTotalTurns: plan.config.maxTotalTurns
      },
      subagents: baseStatus.subagents ?? [],
      awaitingBuilderApproval: plan.approved ? baseStatus.awaitingBuilderApproval ?? false : false,
      autoContinue: plan.config.autoContinue,
      updatedAt: nowIso()
    };

    await this.writeState();

    // Load index config from hybrid-framework.json (or use defaults).
    const repoRoot = getRepoRoot(plan);
    this.indexConfig = await loadIndexConfig(repoRoot);

    // Start loading the ONNX embedding model in the background so it's
    // warm by the time decideNext() actually needs it for vault indexing.
    if (this.indexConfig.enabled) {
      warmupEmbeddingModel();
    }

    done({ plan: plan.slug, phase: this.status.phase });
    return this.status;
  }

  public async hydratePlanless(cwd: string): Promise<RuntimeStatus> {
    this.planlessCwd = cwd;
    this.plan = null;
    this.vault = null;
    this.unifiedIndex = null;
    this.vaultSearchResults = null;

    this.indexConfig = await loadIndexConfig(cwd);

    const runtimePaths = await ensurePlanlessRuntimeDir(cwd);
    const existing = await readStatus(runtimePaths);

    this.status = existing ?? {
      version: 1,
      planPath: "",
      planSlug: "_planless",
      planMtimeMs: 0,
      loopState: "idle",
      phase: "execution",
      currentMilestone: null,
      counters: {
        totalAttempts: 0,
        totalTurns: 0,
        maxTotalTurns: DEFAULT_PLANLESS_MAX_TURNS,
        noProgress: 0,
        repeatedBlocker: 0,
        verificationFailures: 0,
        turnsSinceLastOutcome: 0
      },
      sessions: {},
      subagents: [],
      awaitingBuilderApproval: false,
      autoContinue: false,
      updatedAt: nowIso()
    };

    await writeStatus(runtimePaths, this.status);
    return this.status;
  }

  public isPlanless(): boolean {
    return this.planlessCwd !== null;
  }

  public async recordEvent(event: RuntimeEvent): Promise<RuntimeStatus> {
    const status = this.requireStatus();
    const runtimePaths = this.planlessCwd
      ? await ensurePlanlessRuntimeDir(this.planlessCwd)
      : await ensureRuntimeDir(this.requirePlan());
    const recoveryTrigger = detectRecoveryTrigger(event);

    if (event.sessionId) {
      status.sessions[event.vendor] = { id: event.sessionId, updatedAt: event.timestamp };
    }
    if (recoveryTrigger) {
      const sourceTrigger = status.recovery?.trigger === "resume"
        ? status.recovery.sourceTrigger
        : status.recovery?.trigger;
      status.recovery = {
        trigger: recoveryTrigger,
        ...(recoveryTrigger === "resume" && sourceTrigger
          ? { sourceTrigger }
          : {}),
        vendor: event.vendor,
        eventType: event.type,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        pendingOutcome: status.recovery?.pendingOutcome ?? false,
        at: event.timestamp
      };
      this.promptDirty = true;
    }
    if (status.awaitingBuilderApproval && isExplicitBuilderApprovalEvent(event.type)) {
      status.awaitingBuilderApproval = false;
      status.lastOutcome = null;
      this.promptDirty = true;
    }
    status.updatedAt = nowIso();
    if (status.loopState === "idle") {
      status.loopState = "running";
    }

    await appendEvent(runtimePaths, event);
    await this.writeState();

    return status;
  }

  public async recordOutcomeIngestionIssue(event: RuntimeEvent): Promise<void> {
    await this.recordEvent(event);
  }

  public async evaluateTurn(outcome: TurnOutcome): Promise<RuntimeStatus> {
    const done = hfLogTimed({ tag: "runtime", msg: "evaluateTurn", data: { state: outcome.state } });
    const status = this.requireStatus();
    const previousPhase = status.phase;
    const plan = await reParsePlanIfChanged(this.requirePlan());
    this.plan = plan;
    // Invalidate vault — will be reloaded lazily in decideNext().
    this.resetVaultState();
    this.promptDirty = true;
    const now = nowIso();

    applyOutcomePhase({ status, plan, outcome, previousPhase, now });
    applyOutcomeCounters(status, outcome, now);
    applyLoopState(plan, status, outcome);

    await this.writeState();
    done({ loopState: status.loopState });
    return status;
  }

  public async recordSubagent(ref: SubagentRef): Promise<RuntimeStatus> {
    const status = this.requireStatus();

    const existing = status.subagents.findIndex((s) => s.id === ref.id);
    if (existing >= 0) {
      const previous = status.subagents[existing];
      if (!previous) {
        throw new Error(`Subagent index ${existing} disappeared during update.`);
      }
      status.subagents[existing] = {
        ...previous,
        ...ref,
        startedAt: ref.startedAt || previous.startedAt,
        ...(ref.completedAt ?? previous.completedAt
          ? { completedAt: ref.completedAt ?? previous.completedAt }
          : {})
      };
    } else {
      status.subagents.push(ref);
    }
    status.updatedAt = nowIso();

    await this.writeState();
    return status;
  }

  public async noteStopWithoutOutcome(): Promise<RuntimeStatus> {
    hfLog({ tag: "runtime", msg: "noteStopWithoutOutcome" });
    const status = this.requireStatus();
    const plan = await reParsePlanIfChanged(this.requirePlan());
    this.plan = plan;
    // Invalidate vault — will be reloaded lazily in decideNext().
    this.resetVaultState();
    this.promptDirty = true;

    status.planMtimeMs = plan.mtimeMs;
    status.phase = plan.approved ? "execution" : "planning";
    status.currentMilestone = plan.currentMilestone;
    status.counters.totalAttempts += 1;
    status.counters.turnsSinceLastOutcome += 1;
    if (status.recovery) {
      status.recovery.pendingOutcome = true;
    }
    status.updatedAt = nowIso();

    applyLoopState(plan, status);

    await this.writeState();
    return status;
  }

  public async decideNext(): Promise<ContinueDecision> {
    const status = this.requireStatus();

    if (this.planlessCwd) {
      return this.buildPlanlessDecision();
    }

    const plan = this.requirePlan();
    return this.buildPlannedDecision(plan, status);
  }

  private async buildPlanlessDecision(): Promise<ContinueDecision> {
    hfLog({ tag: "runtime", msg: "decideNext planless" });
    try {
      await this.doRefreshVaultIndex();
    } catch (error) {
      hfLog({ tag: "runtime", msg: "vault index failed (planless)", data: { error: (error as Error).message } });
      this.resetVaultState();
    }

    // Load vault shared context for planless compaction recovery
    if (!this.vault && this.planlessCwd) {
      try {
        const vaultPaths = getPlanlessVaultPaths(this.planlessCwd);
        this.vault = await readVaultContext(vaultPaths);
      } catch (error) {
        hfLog({ tag: "runtime", msg: "vault load failed (planless)", data: { error: (error as Error).message } });
        this.vault = null;
      }
    }

    return {
      action: "allow_stop",
      reason: "No active plan. The runtime is providing guardrails only.",
      resume_prompt: buildPlanlessResumePrompt(this.vault, this.vaultSearchResults, {
        planningCharBudget: this.indexConfig?.planningCharBudget,
      })
    };
  }

  private async buildPlannedDecision(plan: ParsedPlan, status: RuntimeStatus): Promise<ContinueDecision> {
    // Lazy vault loading — only when we actually need a resume prompt
    if (!this.vault) {
      const vaultDone = hfLogTimed({ tag: "runtime", msg: "lazy vault load" });
      try {
        this.vault = await readVaultContext(getVaultPaths(plan));
        await this.doRefreshVaultIndex();
      } catch (error) {
        hfLog({ tag: "runtime", msg: "vault load failed", data: { error: (error as Error).message } });
        this.vault = null;
        this.resetVaultState();
      }
      // Persist the enriched resume prompt now that vault is loaded
      this.promptDirty = true;
      await this.writeState();
      vaultDone({ hasVault: this.vault !== null, hasIndex: this.unifiedIndex !== null });
    }

    const resume_prompt = buildResumePrompt(plan, status, {
      vault: this.vault,
      vaultSearchResults: this.vaultSearchResults,
      budgets: {
        charBudget: this.indexConfig?.charBudget,
        planningCharBudget: this.indexConfig?.planningCharBudget,
      },
    });

    if (status.awaitingBuilderApproval) {
      return {
        action: "allow_stop",
        reason: "The plan is approved. Wait for explicit human approval before starting `hf-builder`.",
        resume_prompt
      };
    }

    const decision = computeDecision({
      approved: plan.approved,
      completed: plan.completed,
      currentMilestone: plan.currentMilestone,
      milestoneCount: plan.milestones.length,
      loopState: status.loopState,
      counters: status.counters,
      lastOutcome: status.lastOutcome,
    });

    return { ...decision, resume_prompt };
  }

  public async writeState(): Promise<void> {
    const status = this.requireStatus();

    if (this.planlessCwd) {
      const runtimePaths = await ensurePlanlessRuntimeDir(this.planlessCwd);
      await writeStatus(runtimePaths, status);
      return;
    }

    const plan = this.requirePlan();
    const runtimePaths = await ensureRuntimeDir(plan);

    if (this.promptDirty) {
      const prompt = buildResumePrompt(plan, status, {
        vault: this.vault,
        vaultSearchResults: this.vaultSearchResults,
        budgets: {
          charBudget: this.indexConfig?.charBudget,
          planningCharBudget: this.indexConfig?.planningCharBudget,
        },
      });
      this.promptDirty = false;

      await Promise.all([
        writeStatus(runtimePaths, status),
        writeResumePrompt(runtimePaths, prompt)
      ]);
    } else {
      await writeStatus(runtimePaths, status);
    }
  }

  public getStatus(): RuntimeStatus {
    return this.requireStatus();
  }

  public getPlan(): ParsedPlan | null {
    return this.plan;
  }

  public getIndexConfig(): IndexConfig | null {
    return this.indexConfig;
  }

  /**
   * Query the in-memory unified index (vault + code) with an arbitrary string.
   * Returns the top-K most relevant chunks, or null if the index cannot be
   * loaded or if embedding fails.
   *
   * If the index has not been built yet for this session, triggers a one-time
   * `refreshVaultIndex()` so callers (e.g. planners, subagents) that run before
   * the first `decideNext()` turn still get results. Safe to call from outside
   * the runtime (e.g., from an OpenCode tool handler).
   */
  public async queryIndex(query: string, topK?: number, sourceFilter?: "vault" | "code"): Promise<VaultSearchResult[] | null> {
    if (!this.unifiedIndex) {
      try {
        await this.doRefreshVaultIndex();
      } catch (error) {
        hfLog({ tag: "runtime", msg: "queryIndex: on-demand index build failed", data: { error: (error as Error).message } });
        return null;
      }
    }

    if (!this.unifiedIndex) {
      return null;
    }

    const opts: QueryIndexOpts = {
      query,
      ...(topK !== undefined ? { topK } : {}),
      ...(sourceFilter !== undefined ? { sourceFilter } : {}),
    };
    return queryIndexItems({ unifiedIndex: this.unifiedIndex, indexConfig: this.indexConfig }, opts);
  }

  private resetVaultState(): void {
    this.vault = null;
    this.unifiedIndex = null;
    this.vaultSearchResults = null;
  }

  private requirePlan(): ParsedPlan {
    if (!this.plan) {
      throw new Error("Runtime has not been hydrated with a plan path.");
    }
    return this.plan;
  }

  private requireStatus(): RuntimeStatus {
    if (!this.status) {
      throw new Error("Runtime has not been hydrated with a plan path.");
    }
    return this.status;
  }
}

export async function resolveManagedPlanPath(cwd: string, explicitPlanPath?: string): Promise<string> {
  if (explicitPlanPath) {
    return path.resolve(cwd, explicitPlanPath);
  }

  throw new Error(
    "No plan specified. Use hf_plan_start tool (OpenCode) or --plan flag (CLI) to target a specific plan."
  );
}

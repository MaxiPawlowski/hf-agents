// oxlint-disable max-lines -- runtime.ts is a central orchestration class; splitting would fragment cohesive state management
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
import { DEFAULT_INDEX_CONFIG, appendEvent, ensureRuntimeDir, ensurePlanlessRuntimeDir, getPlanlessVaultPaths, getRepoRoot, getVaultPaths, loadIndexConfig, readStatus, readVaultContext, writeResumePrompt, writeStatus } from "./persistence.js";
import { buildPlanlessResumePrompt, buildResumePrompt } from "./prompt.js";
import { buildUnifiedIndex } from "./unified-index-pipeline.js";
import { queryItems, type UnifiedIndex as StoredUnifiedIndex } from "./unified-store.js";
import { embed, warmupEmbeddingModel } from "./vault-embeddings.js";
import { hfLog, hfLogTimed } from "./logger.js";
import {
  REPEATED_BLOCKER_THRESHOLD,
  VERIFICATION_FAILURE_THRESHOLD,
  NO_PROGRESS_THRESHOLD,
  type ContinueDecision,
  type IndexConfig,
  type LoopRuntime,
  type ParsedPlan,
  type RuntimeRecoveryState,
  type RuntimeEvent,
  type RuntimeStatus,
  type SubagentRef,
  type TurnOutcome,
  type VaultContext,
  type VaultSearchResult,
} from "./types.js";

export { REPEATED_BLOCKER_THRESHOLD, VERIFICATION_FAILURE_THRESHOLD, NO_PROGRESS_THRESHOLD };
/** Default max turns for planless mode. */
const DEFAULT_PLANLESS_MAX_TURNS = 50;

function nowIso(): string {
  return new Date().toISOString();
}


type UnifiedIndexState = {
  index: StoredUnifiedIndex;
  vectors: Float32Array;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

function isExplicitBuilderApprovalEvent(eventType: string): boolean {
  return eventType === "claude.SessionStart"
    || eventType === "claude.UserPromptSubmit"
    || eventType === "opencode.session.created";
}

function blockerSignature(outcome: TurnOutcome): string | null {
  if (outcome.state !== "blocked" || !outcome.blocker) {
    return null;
  }
  return outcome.blocker.signature ?? outcome.blocker.message.trim().toLowerCase();
}

function isProgressState(outcome: TurnOutcome): boolean {
  return outcome.state === "progress"
    || outcome.state === "needs_review"
    || outcome.state === "milestone_complete"
    || outcome.state === "plan_complete";
}

function hasVerificationFailure(outcome: TurnOutcome): boolean {
  return outcome.tests_run.some((test) => test.result === "fail");
}

function applyLoopState(plan: ParsedPlan, status: RuntimeStatus, outcome?: TurnOutcome): void {
  if (plan.completed || outcome?.state === "plan_complete") {
    status.loopState = "complete";
  } else if (status.counters.totalAttempts >= status.counters.maxTotalTurns) {
    status.loopState = "paused";
  } else if (status.counters.repeatedBlocker >= REPEATED_BLOCKER_THRESHOLD) {
    status.loopState = "escalated";
  } else if (status.counters.noProgress >= NO_PROGRESS_THRESHOLD || status.counters.verificationFailures >= VERIFICATION_FAILURE_THRESHOLD) {
    status.loopState = "paused";
  } else {
    status.loopState = "running";
  }
}

function detectRecoveryTrigger(event: RuntimeEvent): RuntimeRecoveryState["trigger"] | null {
  if (event.type === "claude.Stop") {
    return "stop";
  }

  if (event.type === "opencode.session.idle") {
    return "idle";
  }

  if (event.type === "claude.PreCompact" || event.type === "opencode.session.compacted") {
    return "compact";
  }

  if (event.type === "claude.SessionStart" || event.type === "opencode.session.created") {
    return "resume";
  }

  if (event.type.startsWith("turn_outcome.")) {
    return event.vendor === "claude" ? "stop" : "idle";
  }

  return null;
}

export interface DecisionInput {
  approved: boolean;
  completed: boolean;
  currentMilestone: ParsedPlan["currentMilestone"];
  milestoneCount: number;
  loopState: RuntimeStatus["loopState"];
  counters: RuntimeStatus["counters"];
  lastOutcome?: TurnOutcome | null | undefined;
}

/**
 * Pure decision function extracted from decideNext() for independent testability.
 * Returns the action and reason without any side effects.
 */
export function computeDecision(input: DecisionInput): Omit<ContinueDecision, "resume_prompt"> {
  const { approved, completed, currentMilestone, counters, lastOutcome } = input;

  // Planning phase
  if (!approved) {
    if (counters.totalAttempts >= counters.maxTotalTurns) {
      return { action: "max_turns", reason: `Hard attempt limit reached during planning review (${counters.totalAttempts}/${counters.maxTotalTurns}). Stop the loop and escalate the unresolved planning gap.` };
    }
    if (counters.repeatedBlocker >= REPEATED_BLOCKER_THRESHOLD) {
      return { action: "escalate", reason: "The planning-review loop has repeated the same blocker three times without reaching approval." };
    }
    if (counters.noProgress >= NO_PROGRESS_THRESHOLD) {
      return { action: "pause", reason: "The planning-review loop recorded three turns without progress. Pause and resolve the missing planning input." };
    }
    if (lastOutcome?.state === "milestone_complete" || lastOutcome?.state === "plan_complete") {
      return { action: "allow_stop", reason: "The plan is approved and ready to hand off to the builder." };
    }
    if (lastOutcome?.state === "blocked") {
      return { action: "allow_stop", reason: "Planning phase does not auto-continue. A blocker was recorded but the threshold has not been reached. The user may resume manually." };
    }
    return { action: "allow_stop", reason: "Planning phase does not auto-continue. The user may manually continue or the planner will resume on next user input." };
  }

  // Execution phase
  if (completed || input.loopState === "complete") {
    return { action: "complete", reason: "All milestones are checked and the plan has been marked complete." };
  }
  if (!currentMilestone && !completed) {
    return { action: "continue", reason: "All milestones are checked, but final verification evidence is still required before plan completion." };
  }
  if (counters.totalAttempts >= counters.maxTotalTurns) {
    return { action: "max_turns", reason: `Hard attempt limit reached (${counters.totalAttempts}/${counters.maxTotalTurns}). Stop the loop to prevent runaway execution.` };
  }
  if (counters.repeatedBlocker >= REPEATED_BLOCKER_THRESHOLD) {
    return { action: "escalate", reason: "The same blocker has repeated three times without progress." };
  }
  if (counters.verificationFailures >= VERIFICATION_FAILURE_THRESHOLD) {
    return { action: "pause", reason: "Verification failed twice. Pause the loop until the failure is addressed." };
  }
  if (counters.noProgress >= NO_PROGRESS_THRESHOLD) {
    return { action: "pause", reason: "No progress was recorded for three turns." };
  }
  if (lastOutcome?.state === "milestone_complete") {
    return { action: "allow_stop", reason: "The latest milestone was reported complete. The builder may stop or move to the next milestone." };
  }
  if (lastOutcome?.state === "blocked") {
    return { action: "continue", reason: "A blocker was recorded, but the loop threshold has not been reached yet." };
  }
  return { action: "continue", reason: "The current milestone is still active and the loop is healthy." };
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

  // oxlint-disable max-lines-per-function -- evaluateTurn orchestrates outcome ingestion, plan re-parse, status update, and event recording; cannot be split without breaking transactional state
  public async evaluateTurn(outcome: TurnOutcome): Promise<RuntimeStatus> {
  // oxlint-enable max-lines-per-function
    const done = hfLogTimed({ tag: "runtime", msg: "evaluateTurn", data: { state: outcome.state } });
    const status = this.requireStatus();
    const previousPhase = status.phase;
    const plan = await reParsePlanIfChanged(this.requirePlan());
    this.plan = plan;
    // Invalidate vault — will be reloaded lazily in decideNext().
    this.resetVaultState();
    this.promptDirty = true;
    const now = nowIso();

    status.planMtimeMs = plan.mtimeMs;
    status.phase = plan.approved ? "execution" : "planning";
    status.currentMilestone = plan.currentMilestone;
    if (previousPhase === "planning" && plan.approved && !plan.completed) {
      status.awaitingBuilderApproval = true;
    } else if (plan.approved) {
      status.awaitingBuilderApproval = status.awaitingBuilderApproval ?? false;
    } else {
      status.awaitingBuilderApproval = false;
    }
    status.counters.totalAttempts += 1;
    status.counters.totalTurns += 1;
    status.counters.turnsSinceLastOutcome = 0;
    delete status.recovery;
    status.lastOutcome = outcome;
    status.lastTurnEvaluatedAt = now;
    status.recommendedNextAction = outcome.next_action;
    status.updatedAt = now;

    if (isProgressState(outcome)) {
      status.counters.noProgress = 0;
      status.counters.repeatedBlocker = 0;
      status.lastProgressAt = now;
    } else {
      status.counters.noProgress += 1;
    }

    const signature = blockerSignature(outcome);
    if (signature) {
      const isSameBlocker = status.lastBlocker?.signature === signature;
      status.counters.repeatedBlocker = isSameBlocker ? status.counters.repeatedBlocker + 1 : 1;
      status.lastBlocker = {
        signature,
        message: outcome.blocker?.message ?? outcome.summary,
        at: now
      };
    } else if (isProgressState(outcome)) {
      delete status.lastBlocker;
    }

    if (hasVerificationFailure(outcome)) {
      status.counters.verificationFailures += 1;
      status.lastVerification = {
        status: "fail",
        summary: outcome.tests_run
          .filter((test) => test.result === "fail")
          .map((test) => `${test.command}: ${test.summary ?? "failed"}`)
          .join("; "),
        at: now
      };
    } else if (outcome.tests_run.length > 0) {
      status.lastVerification = {
        status: "pass",
        summary: outcome.tests_run
          .filter((test) => test.result === "pass")
          .map((test) => `${test.command}: ${test.summary ?? "passed"}`)
          .join("; "),
        at: now
      };
      status.counters.verificationFailures = 0;
    }

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

  // oxlint-disable max-lines-per-function -- decideNext builds the full continuation decision from plan+vault+status; cannot be split without losing context
  public async decideNext(): Promise<ContinueDecision> {
  // oxlint-enable max-lines-per-function
    const status = this.requireStatus();

    if (this.planlessCwd) {
      hfLog({ tag: "runtime", msg: "decideNext planless" });
      try {
        await this.refreshVaultIndex();
      } catch (error) {
        hfLog({ tag: "runtime", msg: "vault index failed (planless)", data: { error: (error as Error).message } });
        this.resetVaultState();
      }

      // Load vault shared context for planless compaction recovery
      if (!this.vault) {
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

    const plan = this.requirePlan();

    // Lazy vault loading — only when we actually need a resume prompt
    if (!this.vault) {
      const vaultDone = hfLogTimed({ tag: "runtime", msg: "lazy vault load" });
      try {
        this.vault = await readVaultContext(getVaultPaths(plan));
        await this.refreshVaultIndex();
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

    const resume_prompt = buildResumePrompt(plan, status, this.vault, this.vaultSearchResults, {
      charBudget: this.indexConfig?.charBudget,
      planningCharBudget: this.indexConfig?.planningCharBudget,
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
      const prompt = buildResumePrompt(plan, status, this.vault, this.vaultSearchResults, {
        charBudget: this.indexConfig?.charBudget,
        planningCharBudget: this.indexConfig?.planningCharBudget,
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
        await this.refreshVaultIndex();
      } catch (error) {
        hfLog({ tag: "runtime", msg: "queryIndex: on-demand index build failed", data: { error: (error as Error).message } });
        return null;
      }
    }

    if (!this.unifiedIndex) {
      return null;
    }

    let queryVector: number[];
    try {
      queryVector = await embed(query);
    } catch (error) {
      const msg = (error as Error).message;
      hfLog({ tag: "runtime", msg: "queryIndex: embed failed", data: { error: msg } });
      return null;
    }

    const results = queryItems(
      this.unifiedIndex.index,
      this.unifiedIndex.vectors,
      queryVector,
      topK ?? this.indexConfig?.semanticTopK ?? 5,
      sourceFilter,
    );

    return results.map((result) => ({
      score: result.score,
      text: result.text,
      metadata: {
        sourcePath: result.metadata.sourcePath as string ?? "",
        sectionTitle: result.metadata.sectionTitle as string ?? "",
        documentTitle: result.metadata.documentTitle as string ?? "",
        kind: result.metadata.kind === "code" ? "code" as const : "vault" as const
      }
    }));
  }

  private resetVaultState(): void {
    this.vault = null;
    this.unifiedIndex = null;
    this.vaultSearchResults = null;
  }

  // oxlint-disable max-lines-per-function -- refreshVaultIndex orchestrates scanning, embedding, and persisting the unified index; cannot be split without losing incremental state
  private async refreshVaultIndex(): Promise<void> {
  // oxlint-enable max-lines-per-function
    const plan = this.plan;
    const planlessCwd = this.planlessCwd;
    const vaultPaths = plan ? getVaultPaths(plan) : null;
    const cfg = this.indexConfig;
    const status = this.status;

    this.unifiedIndex = null;

    if (cfg && !cfg.enabled) {
      if (status) delete status.lastIndexError;
      return;
    }

    try {
      this.unifiedIndex = await withTimeout(
        buildUnifiedIndex({
          repoRoot: getRepoRoot(plan ?? undefined, planlessCwd ?? undefined),
          ...(vaultPaths && this.vault ? { vaultPaths, vaultContext: this.vault } : {}),
          codeConfig: cfg?.code.enabled !== false
            ? {
              roots: cfg?.code.roots ?? ["src"],
              extensions: cfg?.code.extensions,
              exclude: cfg?.code.exclude,
            }
            : undefined,
          embeddingBatchSize: cfg?.embeddingBatchSize,
          maxChunkChars: cfg?.maxChunkChars,
        }),
        cfg?.timeoutMs ?? DEFAULT_INDEX_CONFIG.timeoutMs,
        null
      );
    } catch (error) {
      const msg = (error as Error).message;
      hfLog({ tag: "runtime", msg: "unified index build failed", data: { error: msg } });
      if (status) status.lastIndexError = `index build: ${msg}`;
      this.unifiedIndex = null;
    }

    if (this.unifiedIndex) {
      if (status) delete status.lastIndexError;
    }

    if (this.unifiedIndex && plan?.currentMilestone) {
      try {
        this.vaultSearchResults = await withTimeout(
          this.retrieveUnifiedChunks(plan.currentMilestone.text),
          cfg?.timeoutMs ?? DEFAULT_INDEX_CONFIG.timeoutMs,
          null
        );
      } catch (error) {
        const msg = (error as Error).message;
        hfLog({ tag: "runtime", msg: "vault search failed", data: { error: msg } });
        if (status) status.lastIndexError = `vault search: ${msg}`;
        this.vaultSearchResults = null;
      }
      return;
    }

    if (this.unifiedIndex && plan?.status === "planning" && !plan.currentMilestone && plan.userIntent) {
      try {
        this.vaultSearchResults = await withTimeout(
          this.retrieveUnifiedChunks(plan.userIntent, cfg?.planningSemanticTopK ?? 5),
          cfg?.timeoutMs ?? DEFAULT_INDEX_CONFIG.timeoutMs,
          null
        );
      } catch (error) {
        const msg = (error as Error).message;
        hfLog({ tag: "runtime", msg: "vault search failed (planning)", data: { error: msg } });
        if (status) status.lastIndexError = `vault search: ${msg}`;
        this.vaultSearchResults = null;
      }
      return;
    }

    this.vaultSearchResults = null;
  }

  private async retrieveUnifiedChunks(queryText: string, topK?: number): Promise<VaultSearchResult[] | null> {
    return this.queryIndex(queryText, topK);
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

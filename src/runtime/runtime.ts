import path from "node:path";
import { promises as fs } from "node:fs";

import { parsePlan } from "./plan-doc.js";
import { appendEvent, ensureRuntimeDir, readStatus, writeResumePrompt, writeStatus } from "./persistence.js";
import { buildResumePrompt } from "./prompt.js";
import type {
  ContinueDecision,
  LoopRuntime,
  ParsedPlan,
  RuntimeRecoveryState,
  RuntimeEvent,
  RuntimeStatus,
  SubagentRef,
  TurnOutcome
} from "./types.js";

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
    autoContinue: plan.config.autoContinue,
    updatedAt: nowIso()
  };
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
  } else if (status.counters.repeatedBlocker >= 3) {
    status.loopState = "escalated";
  } else if (status.counters.noProgress >= 3 || status.counters.verificationFailures >= 2) {
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

export class HybridLoopRuntime implements LoopRuntime {
  private plan: ParsedPlan | null = null;
  private status: RuntimeStatus | null = null;

  public async hydrate(planRef: string): Promise<RuntimeStatus> {
    const plan = await parsePlan(planRef);
    const runtimePaths = await ensureRuntimeDir(plan);
    const existing = await readStatus(runtimePaths);
    const baseStatus = existing ?? defaultStatus(plan);

    this.plan = plan;
    this.status = {
      ...baseStatus,
      planPath: plan.path,
      planSlug: plan.slug,
      planMtimeMs: plan.mtimeMs,
      currentMilestone: plan.currentMilestone,
      loopState: plan.completed ? "complete" : baseStatus.loopState,
      // Sync config from plan doc on every hydration so edits take effect
      counters: {
        ...defaultStatus(plan).counters,
        ...baseStatus.counters,
        totalAttempts: baseStatus.counters.totalAttempts ?? baseStatus.counters.totalTurns,
        maxTotalTurns: plan.config.maxTotalTurns
      },
      subagents: baseStatus.subagents ?? [],
      autoContinue: plan.config.autoContinue,
      updatedAt: nowIso()
    };

    await this.writeState();
    return this.status;
  }

  public async recordEvent(event: RuntimeEvent): Promise<RuntimeStatus> {
    const status = this.requireStatus();
    const plan = this.requirePlan();
    const runtimePaths = await ensureRuntimeDir(plan);
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
    const status = this.requireStatus();
    const plan = await parsePlan(this.requirePlan().path);
    this.plan = plan;

    status.planMtimeMs = plan.mtimeMs;
    status.currentMilestone = plan.currentMilestone;
    status.counters.totalAttempts += 1;
    status.counters.totalTurns += 1;
    status.counters.turnsSinceLastOutcome = 0;
    delete status.recovery;
    status.lastOutcome = outcome;
    status.lastTurnEvaluatedAt = nowIso();
    status.recommendedNextAction = outcome.next_action;
    status.updatedAt = nowIso();

    if (isProgressState(outcome)) {
      status.counters.noProgress = 0;
      status.counters.repeatedBlocker = 0;
      status.lastProgressAt = nowIso();
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
        at: nowIso()
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
        at: nowIso()
      };
    } else if (outcome.tests_run.length > 0) {
      status.lastVerification = {
        status: "pass",
        summary: outcome.tests_run
          .filter((test) => test.result === "pass")
          .map((test) => `${test.command}: ${test.summary ?? "passed"}`)
          .join("; "),
        at: nowIso()
      };
      status.counters.verificationFailures = 0;
    }

    applyLoopState(plan, status, outcome);

    await this.writeState();
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
    const status = this.requireStatus();
    const plan = await parsePlan(this.requirePlan().path);
    this.plan = plan;

    status.planMtimeMs = plan.mtimeMs;
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

  public decideNext(): ContinueDecision {
    const status = this.requireStatus();
    const plan = this.requirePlan();

    if (plan.completed || status.loopState === "complete") {
      return {
        action: "complete",
        reason: "All milestones are checked and the plan has been marked complete.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (!plan.currentMilestone && !plan.completed) {
      return {
        action: "continue",
        reason: "All milestones are checked, but final verification evidence is still required before plan completion.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (status.counters.totalAttempts >= status.counters.maxTotalTurns) {
      return {
        action: "max_turns",
        reason: `Hard attempt limit reached (${status.counters.totalAttempts}/${status.counters.maxTotalTurns}). Stop the loop to prevent runaway execution.`,
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (status.counters.repeatedBlocker >= 3) {
      return {
        action: "escalate",
        reason: "The same blocker has repeated three times without progress.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (status.counters.verificationFailures >= 2) {
      return {
        action: "pause",
        reason: "Verification failed twice. Pause the loop until the failure is addressed.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (status.counters.noProgress >= 3) {
      return {
        action: "pause",
        reason: "No progress was recorded for three turns.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (status.lastOutcome?.state === "milestone_complete") {
      return {
        action: "allow_stop",
        reason: "The latest milestone was reported complete. The builder may stop or move to the next milestone.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    if (status.lastOutcome?.state === "blocked") {
      return {
        action: "continue",
        reason: "A blocker was recorded, but the loop threshold has not been reached yet.",
        resume_prompt: buildResumePrompt(plan, status)
      };
    }

    return {
      action: "continue",
      reason: "The current milestone is still active and the loop is healthy.",
      resume_prompt: buildResumePrompt(plan, status)
    };
  }

  public async writeState(): Promise<void> {
    const plan = this.requirePlan();
    const status = this.requireStatus();
    const runtimePaths = await ensureRuntimeDir(plan);
    const prompt = buildResumePrompt(plan, status);

    await writeStatus(runtimePaths, status);
    await writeResumePrompt(runtimePaths, prompt);
  }

  public getStatus(): RuntimeStatus {
    return this.requireStatus();
  }

  public getPlan(): ParsedPlan {
    return this.requirePlan();
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

  if (process.env.HF_PLAN_PATH) {
    return path.resolve(cwd, process.env.HF_PLAN_PATH);
  }

  const plansDir = path.join(cwd, "plans");
  const entries = await fs.readdir(plansDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /-plan\.md$/i.test(entry.name))
      .map(async (entry) => {
        const candidatePath = path.join(plansDir, entry.name);
        const stats = await fs.stat(candidatePath);
        return { candidatePath, mtimeMs: stats.mtimeMs };
      })
  );

  if (candidates.length === 0) {
    throw new Error("No plan doc found. Set HF_PLAN_PATH or pass an explicit plan path.");
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const latestCandidate = candidates[0];
  if (!latestCandidate) {
    throw new Error("No plan doc found after candidate sort.");
  }
  return latestCandidate.candidatePath;
}

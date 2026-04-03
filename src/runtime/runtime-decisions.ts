import {
  REPEATED_BLOCKER_THRESHOLD,
  VERIFICATION_FAILURE_THRESHOLD,
  NO_PROGRESS_THRESHOLD,
  type ContinueDecision,
  type ParsedPlan,
  type RuntimeRecoveryState,
  type RuntimeEvent,
  type RuntimeStatus,
  type TurnOutcome,
} from "./types.js";

export { REPEATED_BLOCKER_THRESHOLD, VERIFICATION_FAILURE_THRESHOLD, NO_PROGRESS_THRESHOLD };

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

export function isExplicitBuilderApprovalEvent(eventType: string): boolean {
  return eventType === "claude.SessionStart"
    || eventType === "claude.UserPromptSubmit"
    || eventType === "opencode.session.created";
}

export function detectRecoveryTrigger(event: RuntimeEvent): RuntimeRecoveryState["trigger"] | null {
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

export function applyLoopState(plan: ParsedPlan, status: RuntimeStatus, outcome?: TurnOutcome): void {
  if (plan.completed || outcome?.state === "plan_complete") {
    status.loopState = "complete";
  } else if (status.counters.totalAttempts >= status.counters.maxTotalTurns) {
    status.loopState = "paused";
  } else if (status.counters.repeatedBlocker >= REPEATED_BLOCKER_THRESHOLD) {
    status.loopState = "escalated";
  } else if (
    status.counters.noProgress >= NO_PROGRESS_THRESHOLD
    || status.counters.verificationFailures >= VERIFICATION_FAILURE_THRESHOLD
  ) {
    status.loopState = "paused";
  } else {
    status.loopState = "running";
  }
}

export type OutcomePhaseOpts = {
  status: RuntimeStatus;
  plan: ParsedPlan;
  outcome: TurnOutcome;
  previousPhase: string;
  now: string;
};

export function applyOutcomePhase(opts: OutcomePhaseOpts): void {
  const { status, plan, outcome, previousPhase, now } = opts;
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
}

export function applyOutcomeCounters(status: RuntimeStatus, outcome: TurnOutcome, now: string): void {
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
    return computePlanningDecision(counters, lastOutcome);
  }

  // Execution phase
  return computeExecutionDecision({ completed, loopState: input.loopState, currentMilestone, counters, lastOutcome });
}

function computePlanningDecision(
  counters: RuntimeStatus["counters"],
  lastOutcome?: TurnOutcome | null,
): Omit<ContinueDecision, "resume_prompt"> {
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

type ExecutionDecisionOpts = {
  completed: boolean;
  loopState: RuntimeStatus["loopState"];
  currentMilestone: DecisionInput["currentMilestone"];
  counters: RuntimeStatus["counters"];
  lastOutcome?: TurnOutcome | null | undefined;
};

function computeExecutionDecision(
  opts: ExecutionDecisionOpts,
): Omit<ContinueDecision, "resume_prompt"> {
  const { completed, loopState, currentMilestone, counters, lastOutcome } = opts;
  if (completed || loopState === "complete") {
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

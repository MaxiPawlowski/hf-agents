import { TURN_OUTCOME_TRAILER_FORMAT } from "./turn-outcome-trailer.js";
import type { ParsedPlan, RuntimeStatus } from "./types.js";

function formatRecoveryContext(status: RuntimeStatus): string[] {
  if (!status.recovery) {
    return [];
  }

  const lines: string[] = ["## Recovery"];
  const vendorSession = status.recovery.sessionId
    ? ` in ${status.recovery.vendor} session ${status.recovery.sessionId}`
    : ` in ${status.recovery.vendor}`;

  if (status.recovery.trigger === "resume") {
    const source = status.recovery.sourceTrigger ?? "prior loop handoff";
    lines.push(`Resumed after ${source}${vendorSession}.`);
  } else if (status.recovery.trigger === "compact") {
    lines.push(`Prepared recovery context before compaction${vendorSession}.`);
  } else {
    lines.push(`Last loop handoff came from ${status.recovery.trigger}${vendorSession}.`);
  }

  if (status.recovery.pendingOutcome) {
    lines.push(`The last stop/idle ended without a TurnOutcome trailer and already counts toward the hard limit (${status.counters.totalAttempts}/${status.counters.maxTotalTurns}).`);
    lines.push("Emit the canonical turn_outcome trailer before stopping again.");
  }

  lines.push("");
  return lines;
}

function formatRuntimeState(status: RuntimeStatus): string[] {
  if (status.loopState !== "paused" && status.loopState !== "escalated") {
    return [];
  }

  const lines = [`## Runtime state: ${status.loopState}`];

  if (status.counters.repeatedBlocker >= 3) {
    lines.push("Runtime ownership: the same blocker has repeated three times without progress.");
  } else if (status.counters.verificationFailures >= 2) {
    lines.push("Runtime ownership: verification has failed twice and needs attention before continuing.");
  } else if (status.counters.noProgress >= 3) {
    lines.push("Runtime ownership: three turns completed without progress.");
  } else if (status.counters.totalAttempts >= status.counters.maxTotalTurns) {
    lines.push("Runtime ownership: the hard attempt limit has been reached.");
  }

  lines.push("React to this runtime state instead of inventing local retry counters.");
  lines.push("");
  return lines;
}

export function buildResumePrompt(plan: ParsedPlan, status: RuntimeStatus): string {
  const currentMilestone = plan.currentMilestone;

  if (!currentMilestone && plan.completed) {
    return `Plan ${plan.slug} is complete. Verify the completed milestones and stop.`;
  }

  if (!currentMilestone) {
    return [
      `Continue the managed Hybrid Framework loop for plan ${plan.path}.`,
      "",
      "## Progress",
      `Milestones: ${plan.milestones.length}/${plan.milestones.length} complete.`,
      `Plan status: ${plan.status}.`,
      "",
      "## Final verification",
      "All milestones are checked, but final verification evidence still needs to be attached before the plan can move to `status: complete`.",
      "",
      "## Instructions",
      "Run the narrowest final verification needed for the completed work, attach fresh evidence under the last completed milestone, then update the plan status only if verification passes.",
      "Emit a final turn_outcome trailer as the last block of your response:",
      "",
      TURN_OUTCOME_TRAILER_FORMAT
    ].join("\n");
  }

  const completedCount = plan.milestones.filter((m) => m.checked).length;
  const totalCount = plan.milestones.length;

  const lines = [
    `Continue the managed Hybrid Framework loop for plan ${plan.path}.`,
    "",
    "## Progress",
    `Milestones: ${completedCount}/${totalCount} complete.`,
    `Loop attempts: ${status.counters.totalAttempts}/${status.counters.maxTotalTurns}.`,
    `Evaluated outcomes: ${status.counters.totalTurns}.`,
    "",
    "## Current milestone",
    `${currentMilestone.index}. ${currentMilestone.title}`,
    `Full text: ${currentMilestone.text}`,
    ""
  ];

  if (status.lastOutcome) {
    lines.push("## Last turn");
    lines.push(`State: ${status.lastOutcome.state}`);
    lines.push(`Summary: ${status.lastOutcome.summary}`);
    if (status.lastOutcome.files_changed.length > 0) {
      lines.push(`Files changed: ${status.lastOutcome.files_changed.join(", ")}`);
    }
  } else {
    lines.push("## Last turn");
    lines.push("No outcome recorded yet.");
  }
  lines.push("");

  if (status.lastVerification) {
    lines.push(`## Verification: ${status.lastVerification.status}`);
    if (status.lastVerification.summary) {
      lines.push(status.lastVerification.summary);
    }
    lines.push("");
  }

  lines.push(...formatRuntimeState(status));

  if (status.lastBlocker) {
    lines.push("## Active blocker");
    lines.push(`${status.lastBlocker.message} (repeated ${status.counters.repeatedBlocker} times).`);
    lines.push("");
  }

  const recoveryLines = formatRecoveryContext(status);
  if (recoveryLines.length > 0) {
    lines.push(...recoveryLines);
  } else if (status.counters.turnsSinceLastOutcome > 0) {
    lines.push(`## Warning: ${status.counters.turnsSinceLastOutcome} stop(s) without a TurnOutcome trailer.`);
    lines.push(`Raw loop attempts still count toward the hard limit (${status.counters.totalAttempts}/${status.counters.maxTotalTurns}).`);
    lines.push("Emit the canonical turn_outcome trailer before stopping.");
    lines.push("");
  }

  lines.push("## Instructions");
  lines.push(
    status.recommendedNextAction
      ? `Recommended next action: ${status.recommendedNextAction}`
      : "Recommended next action: make the smallest forward progress on the current milestone only."
  );
  lines.push("Keep scope limited to the current unchecked milestone.");
  lines.push("Emit a final turn_outcome trailer as the last block of your response:");
  lines.push("");
  lines.push(TURN_OUTCOME_TRAILER_FORMAT);

  return lines.join("\n");
}

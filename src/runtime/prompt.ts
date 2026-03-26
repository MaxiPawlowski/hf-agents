import { TURN_OUTCOME_TRAILER_FORMAT } from "./turn-outcome-trailer.js";
import {
  REPEATED_BLOCKER_THRESHOLD,
  VERIFICATION_FAILURE_THRESHOLD,
  NO_PROGRESS_THRESHOLD,
  type PlanMilestone,
  type ParsedPlan,
  type RuntimeStatus,
  type VaultContext,
  type VaultDocument,
  type VaultSearchResult,
} from "./types.js";

export const DEFAULT_VAULT_CHAR_BUDGET = 3000;
export const PLANNING_VAULT_CHAR_BUDGET = 1500;
const TRUNCATION_SUFFIX = "[vault content truncated]";

/**
 * Append content blocks to `lines` while tracking a character budget.
 * Returns true if all blocks fit; false if truncation occurred.
 */
function appendWithBudget(
  lines: string[],
  blocks: string[][],
  charBudget: number,
  used: number,
): void {
  for (const block of blocks) {
    const blockText = block.join("\n");
    // +1 accounts for the "\n" separator when joining with previous content
    const cost = blockText.length + 1;

    if (used + cost > charBudget) {
      const remaining = charBudget - used;
      if (remaining <= 0) {
        break;
      }
      const truncated = blockText.slice(0, Math.max(0, remaining - TRUNCATION_SUFFIX.length - 2)).trimEnd();
      if (truncated) {
        lines.push(...truncated.split("\n"));
        lines.push(TRUNCATION_SUFFIX);
        lines.push("");
      }
      break;
    }

    lines.push(...block);
    used += cost;
  }
}

function formatMilestoneContext(milestone: PlanMilestone): string[] {
  const lines: string[] = [];

  if (milestone.context?.scope && milestone.context.scope.length > 0) {
    lines.push(`  - scope: ${milestone.context.scope.map((s) => `\`${s}\``).join(", ")}`);
  }
  if (milestone.context?.conventions) {
    lines.push(`  - conventions: ${milestone.context.conventions}`);
  }
  if (milestone.context?.notes) {
    lines.push(`  - notes: ${milestone.context.notes}`);
  }
  if (milestone.reviewPolicy) {
    lines.push(`  - review: ${milestone.reviewPolicy}`);
  }

  return lines;
}

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

  if (status.counters.repeatedBlocker >= REPEATED_BLOCKER_THRESHOLD) {
    lines.push("Runtime ownership: the same blocker has repeated three times without progress.");
  } else if (status.counters.verificationFailures >= VERIFICATION_FAILURE_THRESHOLD) {
    lines.push("Runtime ownership: verification has failed twice and needs attention before continuing.");
  } else if (status.counters.noProgress >= NO_PROGRESS_THRESHOLD) {
    lines.push("Runtime ownership: three turns completed without progress.");
  } else if (status.counters.totalAttempts >= status.counters.maxTotalTurns) {
    lines.push("Runtime ownership: the hard attempt limit has been reached.");
  }

  lines.push("React to this runtime state instead of inventing local retry counters.");
  lines.push("");
  return lines;
}

/**
 * Format pre-retrieved semantic search results into a vault context section.
 * Each chunk is rendered under a `### <sectionTitle>` sub-header.
 */
export function formatSemanticVaultContext(
  results: VaultSearchResult[],
  charBudget: number = DEFAULT_VAULT_CHAR_BUDGET
): string[] {
  if (results.length === 0) {
    return [];
  }

  const hasCodeResults = results.some((result) => result.metadata.kind === "code");
  const lines = [hasCodeResults ? "## Knowledge context" : "## Vault context"];
  const headerCost = lines[0]!.length + 1;

  const blocks = results.map((result) => {
    const sectionTitle = result.metadata.kind === "code"
      ? `### [code] ${result.metadata.sectionTitle}`
      : `### ${result.metadata.sectionTitle}`;
    return [sectionTitle, result.text, ""];
  });

  appendWithBudget(lines, blocks, charBudget, headerCost);

  return lines.length > 1 ? lines : [];
}

function formatVaultContext(vault: VaultContext | null, charBudget = DEFAULT_VAULT_CHAR_BUDGET): string[] {
  if (!vault) {
    return [];
  }

  const documents = [...vault.plan, ...vault.shared];
  if (documents.length === 0) {
    return [];
  }

  const asResults: VaultSearchResult[] = documents.map((doc) => ({
    score: 1,
    text: doc.content,
    metadata: { sourcePath: doc.path, sectionTitle: doc.title, documentTitle: doc.title },
  }));
  return formatSemanticVaultContext(asResults, charBudget);
}

export interface PromptBudgets {
  charBudget?: number | undefined;
  planningCharBudget?: number | undefined;
}

export function buildResumePrompt(
  plan: ParsedPlan,
  status: RuntimeStatus,
  vault: VaultContext | null = null,
  vaultSearchResults: VaultSearchResult[] | null = null,
  budgets: PromptBudgets = {}
): string {
  const charBudget = budgets.charBudget ?? DEFAULT_VAULT_CHAR_BUDGET;
  const planningBudget = budgets.planningCharBudget ?? PLANNING_VAULT_CHAR_BUDGET;
  const currentMilestone = plan.currentMilestone;

  if (!currentMilestone && plan.completed) {
    return `Plan ${plan.slug} is complete. Verify the completed milestones and stop.`;
  }

  if (status.phase === "planning") {
    const lines = [
      `Continue the managed Hybrid Framework planning-review loop for plan ${plan.path}.`,
      "",
      "## Plan status",
      `Plan status: ${plan.status}.`,
      `Loop attempts: ${status.counters.totalAttempts}/${status.counters.maxTotalTurns}.`,
      `Evaluated outcomes: ${status.counters.totalTurns}.`,
      "",
      "## User intent"
    ];

    if (plan.userIntent) {
      lines.push(plan.userIntent);
    } else {
      lines.push("User intent is missing from the plan doc. Add a dedicated `## User Intent` section before requesting approval.");
    }

    lines.push("");
    lines.push("## Planning gate");
    lines.push("The runtime owns the loop between `hf-planner` and `hf-plan-reviewer` until the plan is approved.");
    lines.push("Expand the request into explicit milestones, then send the full context and draft plan to `hf-plan-reviewer`.");
    lines.push("Do not hand off to `hf-builder` until the reviewer approves the plan.");
    lines.push("");

    if (status.lastOutcome) {
      lines.push("## Last turn");
      lines.push(`State: ${status.lastOutcome.state}`);
      lines.push(`Summary: ${status.lastOutcome.summary}`);
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
    }

    const planningVaultLines = vaultSearchResults && vaultSearchResults.length > 0
      ? formatSemanticVaultContext(vaultSearchResults, planningBudget)
      : formatVaultContext(vault, planningBudget);
    if (planningVaultLines.length > 0) {
      lines.push(...planningVaultLines);
    }

    lines.push("## Instructions");
    lines.push(
      status.recommendedNextAction
        ? `Recommended next action: ${status.recommendedNextAction}`
        : "Recommended next action: revise the draft plan until `hf-plan-reviewer` can approve it."
    );
    lines.push("Keep the full user request, local findings, constraints, and draft plan visible to both planner and reviewer.");
    lines.push("Emit a final turn_outcome trailer as the last block of your response:");
    lines.push("");
    lines.push(TURN_OUTCOME_TRAILER_FORMAT);

    return lines.join("\n");
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
    ...formatMilestoneContext(currentMilestone),
    ""
  ];

  const vaultLines = vaultSearchResults && vaultSearchResults.length > 0
    ? formatSemanticVaultContext(vaultSearchResults, charBudget)
    : formatVaultContext(vault, charBudget);
  if (vaultLines.length > 0) {
    lines.push(...vaultLines);
  }

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

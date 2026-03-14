import { TURN_OUTCOME_TRAILER_FORMAT } from "./turn-outcome-trailer.js";
import { embed } from "./vault-embeddings.js";
import { query } from "./vault-store.js";
import type { PlanMilestone, ParsedPlan, RuntimeStatus, VaultContext, VaultDocument, VaultIndex, VaultSearchResult } from "./types.js";

const DEFAULT_VAULT_CHAR_BUDGET = 3000;
const DEFAULT_SEMANTIC_TOP_K = 5;

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

function formatVaultDocument(document: VaultDocument): string[] {
  return [`### ${document.title}`, document.content, ""];
}

function formatVaultContext(vault: VaultContext | null, charBudget = DEFAULT_VAULT_CHAR_BUDGET): string[] {
  if (!vault) {
    return [];
  }

  const documents = [...vault.plan, ...vault.shared];
  if (documents.length === 0) {
    return [];
  }

  const lines = ["## Vault context"];
  let used = lines.join("\n").length + 2;

  for (const document of documents) {
    const block = formatVaultDocument(document);
    const blockText = block.join("\n");

    if (used + blockText.length > charBudget) {
      const remaining = charBudget - used;
      if (remaining <= 0) {
        break;
      }

      const truncated = blockText.slice(0, Math.max(0, remaining - 18)).trimEnd();
      if (truncated) {
        lines.push(...truncated.split("\n"));
        lines.push("[vault content truncated]");
        lines.push("");
      }
      break;
    }

    lines.push(...block);
    used += blockText.length;
  }

  return lines.length > 1 ? lines : [];
}

/**
 * Embed the query text and retrieve the top-K most relevant vault chunks.
 * Call this before `buildResumePrompt` so the prompt builder stays synchronous.
 */
export async function retrieveVaultChunks(
  index: VaultIndex,
  queryText: string,
  topK: number = DEFAULT_SEMANTIC_TOP_K
): Promise<VaultSearchResult[]> {
  const queryVector = await embed(queryText);
  return query(index, queryVector, topK);
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

  const lines = ["## Vault context"];
  let used = lines.join("\n").length + 2;

  for (const result of results) {
    const block = [`### ${result.metadata.sectionTitle}`, result.text, ""];
    const blockText = block.join("\n");

    if (used + blockText.length > charBudget) {
      const remaining = charBudget - used;
      if (remaining <= 0) {
        break;
      }

      const truncated = blockText.slice(0, Math.max(0, remaining - 18)).trimEnd();
      if (truncated) {
        lines.push(...truncated.split("\n"));
        lines.push("[vault content truncated]");
        lines.push("");
      }
      break;
    }

    lines.push(...block);
    used += blockText.length;
  }

  return lines.length > 1 ? lines : [];
}

export function buildResumePrompt(
  plan: ParsedPlan,
  status: RuntimeStatus,
  vault: VaultContext | null = null,
  vaultSearchResults: VaultSearchResult[] | null = null
): string {
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
    ? formatSemanticVaultContext(vaultSearchResults)
    : formatVaultContext(vault);
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

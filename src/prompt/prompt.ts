import { TURN_OUTCOME_TRAILER_FORMAT } from "./turn-outcome-trailer.js";
import {
  REPEATED_BLOCKER_THRESHOLD,
  VERIFICATION_FAILURE_THRESHOLD,
  NO_PROGRESS_THRESHOLD,
  type PlanMilestone,
  type ParsedPlan,
  type RuntimeStatus,
  type VaultContext,
  type VaultSearchResult,
} from "../runtime/types.js";

export const DEFAULT_VAULT_CHAR_BUDGET = 3000;
export const PLANNING_VAULT_CHAR_BUDGET = 4000;
const TRUNCATION_SUFFIX = "[vault content truncated]";
const INSTRUCTIONS_HEADER = "## Instructions";
const EMIT_TRAILER_INSTRUCTION = "Emit a final turn_outcome trailer as the last block of your response:";
const LAST_TURN_HEADER = "## Last turn";

interface AppendOpts {
  charBudget: number;
  used: number;
}

/**
 * Append content blocks to `lines` while tracking a character budget.
 * Returns true if all blocks fit; false if truncation occurred.
 */
function appendWithBudget(
  lines: string[],
  blocks: string[][],
  opts: AppendOpts,
): void {
  let { used } = opts;
  const { charBudget } = opts;
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
    const scopeList = milestone.context.scope.map((s) => `\`${s}\``).join(", ");
    lines.push(`  - scope: ${scopeList}`);
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

  const hasCodeResults = results.some((result) => result.metadata.kind === "code" || result.metadata.kind === "external");
  const lines = [hasCodeResults ? "## Knowledge context" : "## Vault context"];
  const headerCost = (lines[0]?.length ?? 0) + 1;

  const blocks = results.map((result) => {
    const sectionTitle = (result.metadata.kind === "code" || result.metadata.kind === "external")
      ? `### [${result.metadata.kind}] ${result.metadata.sectionTitle}`
      : `### ${result.metadata.sectionTitle}`;
    return [sectionTitle, result.text, ""];
  });

  appendWithBudget(lines, blocks, { charBudget, used: headerCost });

  return lines.length > 1 ? lines : [];
}

/**
 * Format semantic search results into a numbered list for tool output.
 * No character budget constraint — returns all results.
 */
export function formatToolSearchResults(results: VaultSearchResult[]): string {
  if (results.length === 0) {
    return "No matching results found.";
  }

  const blocks = results.map((result, index) => {
    let kindLabel = "[vault]";
    if (result.metadata.kind === "code") kindLabel = "[code]";
    else if (result.metadata.kind === "external") kindLabel = "[external]";
    const num = index + 1;
    return [
      `${num}. ${kindLabel} ${result.metadata.sectionTitle}`,
      `   Source: ${result.metadata.sourcePath}`,
      `   Score: ${result.score.toFixed(2)}`,
      "",
      `   ${result.text}`
    ].join("\n");
  });

  return `${blocks.join("\n\n")  }\n`;
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

export interface BuildResumePromptOpts {
  vault?: VaultContext | null;
  vaultSearchResults?: VaultSearchResult[] | null;
  budgets?: PromptBudgets;
}

function buildCompletedPlanPrompt(plan: ParsedPlan): string {
  return `Plan ${plan.slug} is complete. Verify the completed milestones and stop.`;
}

function buildPlanningPhasePrompt(
  plan: ParsedPlan,
  status: RuntimeStatus,
  opts: Required<BuildResumePromptOpts>,
): string {
  const { vault, vaultSearchResults, budgets } = opts;
  const planningBudget = budgets.planningCharBudget ?? PLANNING_VAULT_CHAR_BUDGET;

  const lines = buildPlanningPhaseHeader(plan, status);
  lines.push(...buildPlanningPhaseBlocker(status));
  lines.push(...formatRecoveryContext(status));
  lines.push(...buildPlanningPhaseVaultExploration(vault));

  const planningVaultLines = vaultSearchResults && vaultSearchResults.length > 0
    ? formatSemanticVaultContext(vaultSearchResults, planningBudget)
    : formatVaultContext(vault, planningBudget);
  if (planningVaultLines.length > 0) {
    lines.push(...planningVaultLines);
  }

  lines.push(INSTRUCTIONS_HEADER);
  lines.push(
    status.recommendedNextAction
      ? `Recommended next action: ${status.recommendedNextAction}`
      : "Recommended next action: revise the draft plan until `hf-plan-reviewer` can approve it."
  );
  lines.push("Reference vault-persisted findings and the plan doc; avoid re-loading the full context bundle into conversation.");
  lines.push(EMIT_TRAILER_INSTRUCTION);
  lines.push("");
  lines.push(TURN_OUTCOME_TRAILER_FORMAT);

  return lines.join("\n");
}

function buildPlanningPhaseHeader(plan: ParsedPlan, status: RuntimeStatus): string[] {
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
    lines.push(LAST_TURN_HEADER);
    lines.push(`State: ${status.lastOutcome.state}`);
    lines.push(`Summary: ${status.lastOutcome.summary}`);
    lines.push("");
  }

  lines.push(...formatRuntimeState(status));

  return lines;
}

function formatBlockerLines(status: RuntimeStatus): string[] {
  if (!status.lastBlocker) {
    return [];
  }
  return [
    "## Active blocker",
    `${status.lastBlocker.message} (repeated ${status.counters.repeatedBlocker} times).`,
    "",
  ];
}

function buildPlanningPhaseBlocker(status: RuntimeStatus): string[] {
  return formatBlockerLines(status);
}

function buildPlanningPhaseVaultExploration(vault: VaultContext | null): string[] {
  if (!vault || (vault.plan.length === 0 && vault.shared.length === 0)) {
    return [];
  }
  const lines = [
    "## Exploration state",
    "The following vault documents contain findings from prior exploration passes:",
  ];
  for (const doc of vault.plan) {
    lines.push(`- **${doc.title}**: \`${doc.path}\``);
  }
  for (const doc of vault.shared) {
    lines.push(`- **${doc.title}**: \`${doc.path}\``);
  }
  lines.push("");
  return lines;
}

function buildVerificationPrompt(plan: ParsedPlan): string {
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
    INSTRUCTIONS_HEADER,
    "Run the narrowest final verification needed for the completed work, attach fresh evidence under the last completed milestone, then update the plan status only if verification passes.",
    EMIT_TRAILER_INSTRUCTION,
    "",
    TURN_OUTCOME_TRAILER_FORMAT
  ].join("\n");
}

function buildExecutionPhasePrompt(
  plan: ParsedPlan,
  status: RuntimeStatus,
  opts: Required<BuildResumePromptOpts>,
): string {
  const { vault, vaultSearchResults, budgets } = opts;
  const charBudget = budgets.charBudget ?? DEFAULT_VAULT_CHAR_BUDGET;
  const {currentMilestone} = plan;

  if (!currentMilestone) {
    return buildVerificationPrompt(plan);
  }

  const completedCount = plan.milestones.filter((m) => m.checked).length;
  const totalCount = plan.milestones.length;

  const lines = buildExecutionPhaseHeader({ plan, status, currentMilestone, completedCount, totalCount });

  const vaultLines = vaultSearchResults && vaultSearchResults.length > 0
    ? formatSemanticVaultContext(vaultSearchResults, charBudget)
    : formatVaultContext(vault, charBudget);
  if (vaultLines.length > 0) {
    lines.push(...vaultLines);
  }

  lines.push(...buildExecutionPhaseOutcome(status));
  lines.push(...buildExecutionPhaseVerification(status));
  lines.push(...formatRuntimeState(status));
  lines.push(...buildExecutionPhaseBlocker(status));
  lines.push(...buildExecutionPhaseRecovery(status));
  lines.push(...buildExecutionPhaseInstructions(status));

  return lines.join("\n");
}

interface ExecutionPhaseHeaderOpts {
  plan: ParsedPlan;
  status: RuntimeStatus;
  currentMilestone: PlanMilestone;
  completedCount: number;
  totalCount: number;
}

function buildExecutionPhaseHeader(opts: ExecutionPhaseHeaderOpts): string[] {
  const { plan, status, currentMilestone, completedCount, totalCount } = opts;
  return [
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
}

function buildExecutionPhaseOutcome(status: RuntimeStatus): string[] {
  if (status.lastOutcome) {
    const lines = [
      LAST_TURN_HEADER,
      `State: ${status.lastOutcome.state}`,
      `Summary: ${status.lastOutcome.summary}`,
    ];
    if (status.lastOutcome.files_changed.length > 0) {
      lines.push(`Files changed: ${status.lastOutcome.files_changed.join(", ")}`);
    }
    lines.push("");
    return lines;
  }
  return [LAST_TURN_HEADER, "No outcome recorded yet.", ""];
}

function buildExecutionPhaseVerification(status: RuntimeStatus): string[] {
  if (!status.lastVerification) {
    return [];
  }
  const lines = [`## Verification: ${status.lastVerification.status}`];
  if (status.lastVerification.summary) {
    lines.push(status.lastVerification.summary);
  }
  lines.push("");
  return lines;
}

function buildExecutionPhaseBlocker(status: RuntimeStatus): string[] {
  return formatBlockerLines(status);
}

function buildExecutionPhaseRecovery(status: RuntimeStatus): string[] {
  const recoveryLines = formatRecoveryContext(status);
  if (recoveryLines.length > 0) {
    return recoveryLines;
  }
  if (status.counters.turnsSinceLastOutcome > 0) {
    return [
      `## Warning: ${status.counters.turnsSinceLastOutcome} stop(s) without a TurnOutcome trailer.`,
      `Raw loop attempts still count toward the hard limit (${status.counters.totalAttempts}/${status.counters.maxTotalTurns}).`,
      "Emit the canonical turn_outcome trailer before stopping.",
      "",
    ];
  }
  return [];
}

function buildExecutionPhaseInstructions(status: RuntimeStatus): string[] {
  return [
    INSTRUCTIONS_HEADER,
    status.recommendedNextAction
      ? `Recommended next action: ${status.recommendedNextAction}`
      : "Recommended next action: make the smallest forward progress on the current milestone only.",
    "Keep scope limited to the current unchecked milestone.",
    EMIT_TRAILER_INSTRUCTION,
    "",
    TURN_OUTCOME_TRAILER_FORMAT,
  ];
}

export function buildResumePrompt(
  plan: ParsedPlan,
  status: RuntimeStatus,
  opts?: BuildResumePromptOpts,
): string {
  const vault = opts?.vault ?? null;
  const vaultSearchResults = opts?.vaultSearchResults ?? null;
  const budgets = opts?.budgets ?? {};
  const resolvedOpts: Required<BuildResumePromptOpts> = { vault, vaultSearchResults, budgets };

  const {currentMilestone} = plan;

  if (!currentMilestone && plan.completed) {
    return buildCompletedPlanPrompt(plan);
  }

  if (status.phase === "planning") {
    return buildPlanningPhasePrompt(plan, status, resolvedOpts);
  }

  if (!currentMilestone) {
    return buildVerificationPrompt(plan);
  }

  return buildExecutionPhasePrompt(plan, status, resolvedOpts);
}

export function buildPlanlessResumePrompt(
  vault: VaultContext | null,
  vaultSearchResults: VaultSearchResult[] | null = null,
  budgets: PromptBudgets = {}
): string {
  if (!vault || (vault.plan.length === 0 && vault.shared.length === 0)) {
    return "No task is currently active. Wait for an explicit task before taking action.";
  }

  const lines: string[] = [
    "No active plan. The runtime recovered vault context from a prior session.",
    "",
    "## Recovered context"
  ];

  const budget = budgets.planningCharBudget ?? PLANNING_VAULT_CHAR_BUDGET;
  const vaultLines = vaultSearchResults && vaultSearchResults.length > 0
    ? formatSemanticVaultContext(vaultSearchResults, budget)
    : formatVaultContext(vault, budget);
  if (vaultLines.length > 0) {
    lines.push(...vaultLines);
  }

  lines.push("");
  lines.push(INSTRUCTIONS_HEADER);
  lines.push("Review the recovered vault context above. If a planning discussion was in progress, continue from where it left off. If vault context is not relevant to the current task, proceed normally.");

  return lines.join("\n");
}

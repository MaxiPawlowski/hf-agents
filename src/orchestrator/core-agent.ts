import { taskSchema } from "../contracts/index.js";
import type { z } from "zod";
import { routeTaskDetailed } from "../router/delegation-router.js";
import { suggestSkills } from "../skills/skill-engine.js";
import { executeCoreDelegationPath } from "../delegation/execute-core-path.js";
import type { CoreDelegationResult } from "../contracts/index.js";
import type { TaskBundle } from "../contracts/index.js";
// runTaskManager, runContextScout, runTaskPlanner, runCoder, runReviewer removed:
// plan/build phases are now orchestrated by hf-plan-orchestrator and
// hf-build-orchestrator markdown agents. TS runtime is a validation layer only.
import { loadDelegationRules, resolveRuntimeSettings } from "../settings/runtime-settings.js";
import { coreDelegationResultSchema } from "../contracts/index.js";
import { skillsForEnabledToggles } from "../skills/skill-engine.js";

export type OrchestrationResult = {
  taskId: string;
  assignedSubagent: string;
  routingSource: "configured" | "heuristic";
  matchedCategory?: string;
  suggestedSkills: string[];
  enforcedSkills: string[];
  requiresApproval: boolean;
  notes: string[];
  taskBundle?: TaskBundle;
  executionPath?: {
    stages: string[];
    result: CoreDelegationResult;
  };
};

type TaskInput = z.input<typeof taskSchema>;
type SettingsInput = unknown;

export async function runTask(taskInput: TaskInput, settingsInput: SettingsInput): Promise<OrchestrationResult> {
  const task = taskSchema.parse(taskInput);
  const settings = resolveRuntimeSettings(settingsInput);
  const toggles = settings.toggles;

  const delegationRules = loadDelegationRules(settings);
  const routeDecision = routeTaskDetailed({
    intent: task.intent,
    category: task.category,
    rules: delegationRules
  });
  const assignedSubagent = routeDecision.assignedSubagent;
  const configuredSkills = routeDecision.matchedCategory
    ? delegationRules[routeDecision.matchedCategory]?.requiredSkills ?? []
    : [];
  const suggestedSkills = suggestSkills(task.intent);
  const toggleRequiredSkills = skillsForEnabledToggles(toggles);
  const enforcedSkills = Array.from(
    new Set([
      ...configuredSkills,
      ...toggleRequiredSkills
    ])
  );

  const notes: string[] = [];
  notes.push(`Deep plan: ${toggles.deepPlan ? "on" : "off"}.`);
  notes.push(`Enable review: ${toggles.enableReview ? "on" : "off"}.`);
  if (toggles.enableReview) {
    notes.push("Settings require hf-verification-before-completion checks and reviewer sign-off.");
  }
  let executionPath: OrchestrationResult["executionPath"];
  let taskBundle: OrchestrationResult["taskBundle"];

  if (assignedSubagent === "PlanOrchestrator") {
    // Plan phase is handled by hf-plan-orchestrator markdown agent.
    // Stages reflect the agent's internal flow for test/validation purposes.
    const result = executeCoreDelegationPath(task, settings);
    executionPath = {
      stages: ["Brainstormer", "LocalContextScout", "WebResearchScout", "CodeSearchScout", "PlanSynthesis"],
      result
    };
  } else if (assignedSubagent === "BuildOrchestrator") {
    // Build phase is handled by hf-build-orchestrator markdown agent.
    // TS runtime is a validation layer — use executeCoreDelegationPath for evidence.
    const result = executeCoreDelegationPath(task, settings);
    executionPath = {
      stages: ["MilestoneTracking", "Coder", "Reviewer"],
      result
    };
  } else if (assignedSubagent === "Coder") {
    const result = executeCoreDelegationPath(task, settings);
    executionPath = {
      stages: ["Coder", "Reviewer"],
      result
    };
  }

  return {
    taskId: task.id,
    assignedSubagent,
    routingSource: routeDecision.source,
    matchedCategory: routeDecision.matchedCategory,
    suggestedSkills,
    enforcedSkills,
    requiresApproval: toggles.enableReview,
    notes,
    taskBundle,
    executionPath
  };
}

import { taskSchema } from "../contracts/index.js";
import type { z } from "zod";
import { routeTaskDetailed } from "../router/delegation-router.js";
import { suggestSkills } from "../skills/skill-engine.js";
import { executeCoreDelegationPath } from "../delegation/execute-core-path.js";
import type { CoreDelegationResult } from "../contracts/index.js";
import type { TaskBundle } from "../contracts/index.js";
import { createTaskBundle } from "../tasks/task-bundle.js";
import { runTaskManager, summarizeTaskManagerBundle } from "../subagents/task-manager.js";
import { loadDelegationRules, resolveRuntimeSettings } from "../settings/runtime-settings.js";
import { runContextScout } from "../subagents/context-scout.js";
import { runTaskPlanner } from "../subagents/task-planner.js";
import { runCoder } from "../subagents/coder.js";
import { runReviewer } from "../subagents/reviewer.js";
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

function appendTaskArtifactNote(notes: string[], taskBundle: TaskBundle): void {
  const bundleSummary = summarizeTaskManagerBundle(taskBundle);
  notes.push(
    `Task artifacts prepared (${bundleSummary.subtaskCount} subtasks, ${bundleSummary.parallelizable} parallelizable).`
  );
}

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
  notes.push(`Worktree automation: ${toggles.useWorktreesByDefault ? "on" : "off"}.`);
  notes.push(`Git management automation: ${toggles.manageGitByDefault ? "on" : "off"}.`);
  notes.push(`Test gate: ${toggles.requireTests ? "required" : "optional"}.`);
  if (toggles.requireVerification) {
    notes.push("Settings require hf-verification-before-completion checks.");
  }
  if (toggles.requireCodeReview) {
    notes.push("Settings require explicit review before closing tasks.");
  }
  let executionPath: OrchestrationResult["executionPath"];
  let taskBundle: OrchestrationResult["taskBundle"];

  if (assignedSubagent === "Coder") {
    const result = executeCoreDelegationPath(task, settings);
    if (toggles.enableTaskArtifacts) {
      taskBundle = createTaskBundle(task, result.plan);
      appendTaskArtifactNote(notes, taskBundle);
    }
    executionPath = {
      stages: ["ContextScout", "TaskPlanner", "Coder", "Reviewer"],
      result
    };
  } else if (assignedSubagent === "TaskManager") {
    const context = runContextScout(task, settings);
    const plan = runTaskPlanner(task, context);
    if (toggles.enableTaskArtifacts) {
      taskBundle = runTaskManager(task, plan);
      appendTaskArtifactNote(notes, taskBundle);
    }
    const patch = runCoder(plan, settings);
    const review = runReviewer(plan, patch, settings);
    const result: CoreDelegationResult = coreDelegationResultSchema.parse({ context, plan, patch, review });
    executionPath = {
      stages: ["ContextScout", "TaskPlanner", "TaskManager", "Coder", "Reviewer"],
      result
    };
  } else if (toggles.enableTaskArtifacts) {
    taskBundle = createTaskBundle(task);
  }

  return {
    taskId: task.id,
    assignedSubagent,
    routingSource: routeDecision.source,
    matchedCategory: routeDecision.matchedCategory,
    suggestedSkills,
    enforcedSkills,
    requiresApproval: toggles.requireApprovalGates,
    notes,
    taskBundle,
    executionPath
  };
}

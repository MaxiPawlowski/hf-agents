import { runtimeSettingsSchema, taskSchema } from "../contracts/index.js";
import type { z } from "zod";
import { routeTaskDetailed } from "../router/delegation-router.js";
import { requiredSkillsForMode, shouldEnforceSkill, suggestSkills } from "../skills/skill-engine.js";
import { executeCoreDelegationPath } from "../delegation/execute-core-path.js";
import type { CoreDelegationResult } from "../contracts/index.js";
import type { TaskBundle } from "../contracts/index.js";
import { createTaskBundle } from "../tasks/task-bundle.js";
import { runTaskManager, summarizeTaskManagerBundle } from "../subagents/task-manager.js";
import { loadDelegationProfiles } from "../settings/runtime-settings.js";
import { runContextScout } from "../subagents/context-scout.js";
import { runTaskPlanner } from "../subagents/task-planner.js";
import { runCoder } from "../subagents/coder.js";
import { runReviewer } from "../subagents/reviewer.js";
import { coreDelegationResultSchema } from "../contracts/index.js";

export type OrchestrationResult = {
  taskId: string;
  assignedSubagent: string;
  routingSource: "profile" | "heuristic";
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
type SettingsInput = z.input<typeof runtimeSettingsSchema>;

export async function runTask(taskInput: TaskInput, settingsInput: SettingsInput): Promise<OrchestrationResult> {
  const task = taskSchema.parse(taskInput);
  const settings = runtimeSettingsSchema.parse(settingsInput);

  const delegationProfiles = loadDelegationProfiles(settings);
  const routeDecision = routeTaskDetailed({
    intent: task.intent,
    category: task.category,
    profiles: delegationProfiles
  });
  const assignedSubagent = routeDecision.assignedSubagent;
  const profileSkills = routeDecision.matchedCategory
    ? delegationProfiles[routeDecision.matchedCategory]?.requiredSkills ?? []
    : [];
  const suggestedSkills = suggestSkills(task.intent);
  const enforcedSkills = Array.from(
    new Set([
      ...profileSkills,
      ...suggestedSkills.filter((skill) => shouldEnforceSkill(skill, settings.profile)),
      ...requiredSkillsForMode(settings.profile)
    ])
  );

  const notes: string[] = [];
  if (!settings.useWorktreesByDefault) {
    notes.push("Worktrees are disabled by default.");
  }
  if (!settings.manageGitByDefault) {
    notes.push("Git management is disabled by default.");
  }
  if (!settings.requireTests) {
    notes.push("Tests are optional and can be run manually.");
  } else {
    notes.push("Settings require test execution before completion.");
  }
  if (settings.requireVerification) {
    notes.push("Settings require hf-verification-before-completion checks.");
  }
  if (settings.requireCodeReview) {
    notes.push("Settings require explicit review before closing tasks.");
  }
  let executionPath: OrchestrationResult["executionPath"];
  let taskBundle: OrchestrationResult["taskBundle"];

  if (assignedSubagent === "Coder") {
    const result = executeCoreDelegationPath(task, settings);
    if (settings.enableTaskArtifacts) {
      taskBundle = createTaskBundle(task, result.plan);
      const bundleSummary = summarizeTaskManagerBundle(taskBundle);
      notes.push(
        `Task artifacts prepared (${bundleSummary.subtaskCount} subtasks, ${bundleSummary.parallelizable} parallelizable).`
      );
    }
    executionPath = {
      stages: ["ContextScout", "TaskPlanner", "Coder", "Reviewer"],
      result
    };
  } else if (assignedSubagent === "TaskManager") {
    const context = runContextScout(task, settings);
    const plan = runTaskPlanner(task, context);
    if (settings.enableTaskArtifacts) {
      taskBundle = runTaskManager(task, plan);
      const bundleSummary = summarizeTaskManagerBundle(taskBundle);
      notes.push(
        `Task artifacts prepared (${bundleSummary.subtaskCount} subtasks, ${bundleSummary.parallelizable} parallelizable).`
      );
    }
    const patch = runCoder(plan, settings);
    const review = runReviewer(plan, patch, settings);
    const result: CoreDelegationResult = coreDelegationResultSchema.parse({ context, plan, patch, review });
    executionPath = {
      stages: ["ContextScout", "TaskPlanner", "TaskManager", "Coder", "Reviewer"],
      result
    };
  } else if (settings.enableTaskArtifacts) {
    taskBundle = createTaskBundle(task);
  }

  return {
    taskId: task.id,
    assignedSubagent,
    routingSource: routeDecision.source,
    matchedCategory: routeDecision.matchedCategory,
    suggestedSkills,
    enforcedSkills,
    requiresApproval: settings.requireApprovalGates,
    notes,
    taskBundle,
    executionPath
  };
}

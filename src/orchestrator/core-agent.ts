import { policySchema, taskSchema } from "../contracts/index.js";
import type { z } from "zod";
import { routeTaskDetailed } from "../router/delegation-router.js";
import { requiredSkillsForMode, shouldEnforceSkill, suggestSkills } from "../skills/skill-engine.js";
import { executeCoreDelegationPath } from "../delegation/execute-core-path.js";
import type { CoreDelegationResult } from "../contracts/index.js";
import type { TaskBundle } from "../contracts/index.js";
import { createTaskBundle } from "../tasks/task-bundle.js";
import { runTaskManager, summarizeTaskManagerBundle } from "../subagents/task-manager.js";
import { loadDelegationProfiles } from "../policies/policy-loader.js";
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
type PolicyInput = z.input<typeof policySchema>;

export async function runTask(taskInput: TaskInput, policyInput: PolicyInput): Promise<OrchestrationResult> {
  const task = taskSchema.parse(taskInput);
  const policy = policySchema.parse(policyInput);

  const delegationProfiles = loadDelegationProfiles(policy);
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
      ...suggestedSkills.filter((skill) => shouldEnforceSkill(skill, policy.mode)),
      ...requiredSkillsForMode(policy.mode)
    ])
  );

  const notes: string[] = [];
  if (!policy.useWorktreesByDefault) {
    notes.push("Worktrees are disabled by default.");
  }
  if (!policy.manageGitByDefault) {
    notes.push("Git management is disabled by default.");
  }
  if (!policy.requireTests) {
    notes.push("Tests are optional and can be run manually.");
  } else {
    notes.push("Policy requires test execution before completion.");
  }
  if (policy.requireVerification) {
    notes.push("Policy requires hf-verification-before-completion checks.");
  }
  if (policy.requireCodeReview) {
    notes.push("Policy requires explicit review before closing tasks.");
  }
  let executionPath: OrchestrationResult["executionPath"];
  let taskBundle: OrchestrationResult["taskBundle"];

  if (assignedSubagent === "Coder") {
    const result = executeCoreDelegationPath(task, policy);
    if (policy.enableTaskArtifacts) {
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
    const context = runContextScout(task);
    const plan = runTaskPlanner(task, context);
    if (policy.enableTaskArtifacts) {
      taskBundle = runTaskManager(task, plan);
      const bundleSummary = summarizeTaskManagerBundle(taskBundle);
      notes.push(
        `Task artifacts prepared (${bundleSummary.subtaskCount} subtasks, ${bundleSummary.parallelizable} parallelizable).`
      );
    }
    const patch = runCoder(plan, policy);
    const review = runReviewer(plan, patch, policy);
    const result: CoreDelegationResult = coreDelegationResultSchema.parse({ context, plan, patch, review });
    executionPath = {
      stages: ["ContextScout", "TaskPlanner", "TaskManager", "Coder", "Reviewer"],
      result
    };
  } else if (policy.enableTaskArtifacts) {
    taskBundle = createTaskBundle(task);
  }

  return {
    taskId: task.id,
    assignedSubagent,
    routingSource: routeDecision.source,
    matchedCategory: routeDecision.matchedCategory,
    suggestedSkills,
    enforcedSkills,
    requiresApproval: policy.requireApprovalGates,
    notes,
    taskBundle,
    executionPath
  };
}

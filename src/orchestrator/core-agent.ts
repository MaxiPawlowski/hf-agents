import { policySchema, taskSchema } from "../contracts/index.js";
import type { z } from "zod";
import { routeTask } from "../router/delegation-router.js";
import { requiredSkillsForMode, shouldEnforceSkill, suggestSkills } from "../skills/skill-engine.js";
import { executeCoreDelegationPath } from "../delegation/execute-core-path.js";
import type { CoreDelegationResult } from "../contracts/index.js";
import type { TaskBundle } from "../contracts/index.js";
import { createTaskBundle } from "../tasks/task-bundle.js";

export type OrchestrationResult = {
  taskId: string;
  assignedSubagent: string;
  suggestedSkills: string[];
  enforcedSkills: string[];
  requiresApproval: boolean;
  notes: string[];
  taskBundle?: TaskBundle;
  executionPath?: {
    stages: ["TaskPlanner", "Coder", "Reviewer"];
    result: CoreDelegationResult;
  };
};

type TaskInput = z.input<typeof taskSchema>;
type PolicyInput = z.input<typeof policySchema>;

export async function runTask(taskInput: TaskInput, policyInput: PolicyInput): Promise<OrchestrationResult> {
  const task = taskSchema.parse(taskInput);
  const policy = policySchema.parse(policyInput);

  const assignedSubagent = routeTask(task.intent);
  const suggestedSkills = suggestSkills(task.intent);
  const enforcedSkills = Array.from(
    new Set([
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

  if (policy.enableTaskArtifacts && (assignedSubagent === "TaskManager" || assignedSubagent === "Coder")) {
    taskBundle = createTaskBundle(task);
  }

  if (assignedSubagent === "Coder") {
    const result = executeCoreDelegationPath(task, policy);
    if (policy.enableTaskArtifacts) {
      taskBundle = createTaskBundle(task, result.plan);
    }
    executionPath = {
      stages: ["TaskPlanner", "Coder", "Reviewer"],
      result
    };
  }

  return {
    taskId: task.id,
    assignedSubagent,
    suggestedSkills,
    enforcedSkills,
    requiresApproval: policy.requireApprovalGates,
    notes,
    taskBundle,
    executionPath
  };
}

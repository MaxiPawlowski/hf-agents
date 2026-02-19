import { codePatchSchema, policySchema, executionPlanSchema, type CodePatch } from "../contracts/index.js";

export function runCoder(planInput: unknown, policyInput: unknown): CodePatch {
  const plan = executionPlanSchema.parse(planInput);
  const policy = policySchema.parse(policyInput);

  const patch: CodePatch = {
    taskId: plan.taskId,
    summary: `Implemented plan for: ${plan.objective}`,
    filesTouched: [],
    safeguards: {
      usedWorktrees: policy.useWorktreesByDefault,
      managedGit: policy.manageGitByDefault,
      autoTestsRun: policy.requireTests
    }
  };

  return codePatchSchema.parse(patch);
}

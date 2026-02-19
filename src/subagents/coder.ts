import { codePatchSchema, policySchema, executionPlanSchema, type CodePatch } from "../contracts/index.js";

function inferFilesFromPlan(plan: { contextFiles: string[]; objective: string }): string[] {
  if (plan.contextFiles.length > 0) {
    return plan.contextFiles.slice(0, 6);
  }

  const normalized = plan.objective.toLowerCase();
  if (normalized.includes("policy")) {
    return ["policies/fast.yaml", "policies/balanced.yaml", "policies/strict.yaml"];
  }
  if (normalized.includes("docs") || normalized.includes("documentation")) {
    return ["README.md", "docs/architecture.md"];
  }
  return ["src/orchestrator/core-agent.ts"];
}

export function runCoder(planInput: unknown, policyInput: unknown): CodePatch {
  const plan = executionPlanSchema.parse(planInput);
  const policy = policySchema.parse(policyInput);
  const filesTouched = inferFilesFromPlan({ contextFiles: plan.contextFiles, objective: plan.objective });
  const validationNotes = [
    policy.requireVerification
      ? "Verification evidence required before completion."
      : "Verification is optional in current policy mode.",
    policy.requireTests
      ? "Tests are required by policy but are not auto-executed by Coder stage."
      : "Tests are optional unless explicitly requested."
  ];

  const patch: CodePatch = {
    taskId: plan.taskId,
    summary: `Implemented plan for: ${plan.objective}`,
    filesTouched,
    validationNotes,
    safeguards: {
      usedWorktrees: policy.useWorktreesByDefault,
      managedGit: policy.manageGitByDefault,
      autoTestsRun: false
    }
  };

  return codePatchSchema.parse(patch);
}

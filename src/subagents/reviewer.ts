import {
  codePatchSchema,
  executionPlanSchema,
  policySchema,
  reviewReportSchema,
  type ReviewReport
} from "../contracts/index.js";

export function runReviewer(planInput: unknown, patchInput: unknown, policyInput: unknown): ReviewReport {
  const plan = executionPlanSchema.parse(planInput);
  const patch = codePatchSchema.parse(patchInput);
  const policy = policySchema.parse(policyInput);

  const findings: string[] = [];
  const blockingFindings: string[] = [];

  if (patch.filesTouched.length === 0) {
    blockingFindings.push("No candidate files were identified by Coder stage.");
  }
  if (plan.steps.length < 3) {
    blockingFindings.push("Plan is underspecified (expected at least 3 steps).");
  }
  if (patch.safeguards.usedWorktrees) {
    findings.push("Policy enabled worktrees for this run.");
  }
  if (patch.safeguards.managedGit) {
    findings.push("Policy enabled git management for this run.");
  }
  if (policy.requireTests && !patch.safeguards.autoTestsRun) {
    blockingFindings.push("Policy requires tests but no automated test run evidence was produced.");
  }
  if (policy.requireVerification) {
    findings.push("Verification is required and must be completed before closeout.");
  }

  const report: ReviewReport = {
    taskId: patch.taskId,
    approved: blockingFindings.length === 0,
    findings,
    blockingFindings,
    reviewer: "Reviewer"
  };

  return reviewReportSchema.parse(report);
}

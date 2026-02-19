import { codePatchSchema, reviewReportSchema, type ReviewReport } from "../contracts/index.js";

export function runReviewer(patchInput: unknown): ReviewReport {
  const patch = codePatchSchema.parse(patchInput);

  const findings: string[] = [];
  if (patch.safeguards.usedWorktrees) {
    findings.push("Policy enabled worktrees for this run.");
  }
  if (patch.safeguards.managedGit) {
    findings.push("Policy enabled git management for this run.");
  }

  const report: ReviewReport = {
    taskId: patch.taskId,
    approved: true,
    findings,
    reviewer: "Reviewer"
  };

  return reviewReportSchema.parse(report);
}

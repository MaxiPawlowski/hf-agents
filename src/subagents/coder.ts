import { codePatchSchema, executionPlanSchema, type CodePatch } from "../contracts/index.js";
import { resolveRuntimeSettings } from "../settings/runtime-settings.js";

function inferFilesFromPlan(plan: { contextFiles: string[]; objective: string }): string[] {
  if (plan.contextFiles.length > 0) {
    return plan.contextFiles.slice(0, 6);
  }

  const normalized = plan.objective.toLowerCase();
  if (normalized.includes("settings") || normalized.includes("toggles")) {
    return ["settings/framework-settings.json", "src/settings/runtime-settings.ts"];
  }
  if (normalized.includes("docs") || normalized.includes("documentation")) {
    return ["README.md", "docs/architecture.md"];
  }
  return ["src/orchestrator/core-agent.ts"];
}

export function runCoder(planInput: unknown, settingsInput: unknown): CodePatch {
  const plan = executionPlanSchema.parse(planInput);
  const settings = resolveRuntimeSettings(settingsInput);
  const toggles = settings.toggles;
  const filesTouched = inferFilesFromPlan({ contextFiles: plan.contextFiles, objective: plan.objective });
  const validationNotes = [
    toggles.requireVerification
      ? "Verification evidence required before completion."
      : "Verification is optional in current settings.",
    toggles.requireTests
      ? "Tests are required by settings but are not auto-executed by Coder stage."
      : "Tests are optional unless explicitly requested."
  ];

  const patch: CodePatch = {
    taskId: plan.taskId,
    summary: `Implemented plan for: ${plan.objective}`,
    filesTouched,
    validationNotes,
    safeguards: {
      usedWorktrees: toggles.useWorktreesByDefault,
      managedGit: toggles.manageGitByDefault,
      autoTestsRun: false
    }
  };

  return codePatchSchema.parse(patch);
}

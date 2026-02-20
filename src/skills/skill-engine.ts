import type { RuntimeToggles, Skill } from "../contracts/index.js";

const CORE_SKILLS: Skill[] = [
  {
    id: "hf-brainstorming",
    triggerHints: ["design", "approach", "architecture"]
  },
  {
    id: "hf-subagent-driven-development",
    triggerHints: ["delegate", "subagent", "workflow"]
  },
  {
    id: "hf-test-driven-development",
    triggerHints: ["feature", "bug", "refactor"]
  },
  {
    id: "hf-systematic-debugging",
    triggerHints: ["bug", "failure", "unexpected"]
  },
  {
    id: "hf-verification-before-completion",
    triggerHints: ["done", "complete", "fixed"]
  },
  {
    id: "hf-bounded-parallel-scouting",
    triggerHints: ["discover", "context", "scout"]
  },
  {
    id: "hf-task-management",
    triggerHints: ["task", "dependency", "subtask"]
  },
  {
    id: "hf-dispatching-parallel-agents",
    triggerHints: ["parallel", "independent", "batch"]
  },
  {
    id: "hf-core-delegation",
    triggerHints: ["core delegation", "delegation path"]
  },
  {
    id: "hf-git-workflows",
    triggerHints: ["git workflow", "worktree", "branching"]
  },
  {
    id: "hf-testing-gate",
    triggerHints: ["test gate", "test required", "coverage gate"]
  },
  {
    id: "hf-approval-gates",
    triggerHints: ["approval gate", "verification gate", "review gate"]
  },
  {
    id: "hf-task-artifact-gate",
    triggerHints: ["task artifact", "task bundle", "lifecycle artifacts"]
  }
];

export function listSkills(): Skill[] {
  return CORE_SKILLS;
}

export function suggestSkills(input: string): string[] {
  const normalized = input.toLowerCase();
  const matched = CORE_SKILLS.filter((skill) =>
    skill.triggerHints.some((hint) => normalized.includes(hint))
  ).map((skill) => skill.id);

  return Array.from(new Set(matched));
}

export function skillsForEnabledToggles(toggles: RuntimeToggles): string[] {
  const enabled: string[] = [];
  if (toggles.useWorktreesByDefault || toggles.manageGitByDefault) {
    enabled.push("hf-git-workflows");
  }
  if (toggles.requireTests) {
    enabled.push("hf-testing-gate");
  }
  if (toggles.requireApprovalGates || toggles.requireVerification || toggles.requireCodeReview) {
    enabled.push("hf-approval-gates");
  }
  if (toggles.enableTaskArtifacts) {
    enabled.push("hf-task-artifact-gate");
  }
  if (toggles.requireVerification) {
    enabled.push("hf-verification-before-completion");
  }
  return enabled;
}

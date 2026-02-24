import type { RuntimeToggles, Skill } from "../contracts/index.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesHint(input: string, hint: string): boolean {
  const normalizedHint = hint.toLowerCase();
  if (normalizedHint.includes(" ")) {
    return input.includes(normalizedHint);
  }
  const re = new RegExp(`\\b${escapeRegExp(normalizedHint)}\\b`, "i");
  return re.test(input);
}

const CORE_SKILLS: Skill[] = [
  {
    id: "hf-brainstorming",
    triggerHints: ["design", "approach", "architecture"]
  },
  {
    id: "hf-subagent-driven-development",
    triggerHints: ["delegate", "subagent", "handoff", "planner", "reviewer"]
  },
  {
    id: "hf-test-driven-development",
    triggerHints: ["tdd", "test-driven", "test first", "test-first"]
  },
  {
    id: "hf-systematic-debugging",
    triggerHints: ["debug", "failing", "regression", "exception", "stacktrace"]
  },
  {
    id: "hf-verification-before-completion",
    triggerHints: ["complete", "finish", "ship", "release"]
  },
  {
    id: "hf-bounded-parallel-scouting",
    triggerHints: ["discover", "scout", "inventory"]
  },
  {
    id: "hf-task-management",
    triggerHints: ["dependency", "subtask", "lifecycle", "artifact"]
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
    skill.triggerHints.some((hint) => matchesHint(normalized, hint))
  ).map((skill) => skill.id);

  const unique = Array.from(new Set(matched));
  return unique.slice(0, 4);
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

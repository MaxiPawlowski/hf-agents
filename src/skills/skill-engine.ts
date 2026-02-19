import type { PolicyMode, Skill } from "../contracts/index.js";

const CORE_SKILLS: Skill[] = [
  {
    id: "hf-brainstorming",
    strictIn: ["balanced", "strict"],
    triggerHints: ["design", "approach", "architecture"]
  },
  {
    id: "hf-test-driven-development",
    strictIn: ["strict"],
    triggerHints: ["feature", "bug", "refactor"]
  },
  {
    id: "hf-systematic-debugging",
    strictIn: ["balanced", "strict"],
    triggerHints: ["bug", "failure", "unexpected"]
  },
  {
    id: "hf-verification-before-completion",
    strictIn: ["balanced", "strict"],
    triggerHints: ["done", "complete", "fixed"]
  },
  {
    id: "hf-executing-plans",
    strictIn: ["balanced", "strict"],
    triggerHints: ["implement", "execute", "plan"]
  },
  {
    id: "hf-requesting-code-review",
    strictIn: ["balanced", "strict"],
    triggerHints: ["review", "quality", "complete"]
  },
  {
    id: "hf-receiving-code-review",
    strictIn: ["balanced", "strict"],
    triggerHints: ["feedback", "review"]
  },
  {
    id: "hf-finishing-a-development-branch",
    strictIn: ["strict"],
    triggerHints: ["finish", "merge", "pr"]
  },
  {
    id: "hf-using-git-worktrees",
    strictIn: ["strict"],
    triggerHints: ["worktree", "isolate"]
  },
  {
    id: "hf-task-management",
    strictIn: ["fast", "balanced", "strict"],
    triggerHints: ["task", "dependency", "subtask"]
  },
  {
    id: "hf-dispatching-parallel-agents",
    strictIn: ["fast", "balanced", "strict"],
    triggerHints: ["parallel", "independent", "batch"]
  }
];

export function listSkills(): Skill[] {
  return CORE_SKILLS;
}

export function shouldEnforceSkill(skillId: string, mode: PolicyMode): boolean {
  const skill = CORE_SKILLS.find((entry) => entry.id === skillId);
  if (!skill) return false;
  return skill.strictIn.includes(mode);
}

export function suggestSkills(input: string): string[] {
  const normalized = input.toLowerCase();
  const matched = CORE_SKILLS.filter((skill) =>
    skill.triggerHints.some((hint) => normalized.includes(hint))
  ).map((skill) => skill.id);

  return Array.from(new Set(matched));
}

export function requiredSkillsForMode(mode: PolicyMode): string[] {
  return CORE_SKILLS.filter((skill) => skill.strictIn.includes(mode)).map((skill) => skill.id);
}

import type { SettingsProfile, Skill } from "../contracts/index.js";

const CORE_SKILLS: Skill[] = [
  {
    id: "hf-brainstorming",
    strictIn: [],
    triggerHints: ["design", "approach", "architecture"]
  },
  {
    id: "hf-subagent-driven-development",
    strictIn: [],
    triggerHints: ["delegate", "subagent", "workflow"]
  },
  {
    id: "hf-test-driven-development",
    strictIn: ["strict"],
    triggerHints: ["feature", "bug", "refactor"]
  },
  {
    id: "hf-systematic-debugging",
    strictIn: [],
    triggerHints: ["bug", "failure", "unexpected"]
  },
  {
    id: "hf-verification-before-completion",
    strictIn: ["balanced", "strict"],
    triggerHints: ["done", "complete", "fixed"]
  },
  {
    id: "hf-bounded-parallel-scouting",
    strictIn: [],
    triggerHints: ["discover", "context", "scout"]
  },
  {
    id: "hf-task-management",
    strictIn: [],
    triggerHints: ["task", "dependency", "subtask"]
  },
  {
    id: "hf-dispatching-parallel-agents",
    strictIn: [],
    triggerHints: ["parallel", "independent", "batch"]
  },
  {
    id: "hf-core-delegation",
    strictIn: [],
    triggerHints: ["core delegation", "delegation path"]
  }
];

export function listSkills(): Skill[] {
  return CORE_SKILLS;
}

export function shouldEnforceSkill(skillId: string, mode: SettingsProfile): boolean {
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

export function requiredSkillsForMode(mode: SettingsProfile): string[] {
  return CORE_SKILLS.filter((skill) => skill.strictIn.includes(mode)).map((skill) => skill.id);
}

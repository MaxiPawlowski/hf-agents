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
    id: "hf-brainstormer",
    triggerHints: ["brainstorm", "scope", "research brief", "unknowns"]
  },
  {
    id: "hf-plan-synthesis",
    triggerHints: ["plan doc", "milestones", "synthesize plan", "plan synthesis"]
  },
  {
    id: "hf-local-context",
    triggerHints: ["local context", "local files", "context scout", "project files"]
  },
  {
    id: "hf-milestone-tracking",
    triggerHints: ["milestone", "checkbox", "plan progress", "track milestone"]
  },
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
    id: "hf-local-context-scout",
    triggerHints: ["local context", "read files", "project scan"]
  },
  {
    id: "hf-web-research-scout",
    triggerHints: ["web research", "online search", "external knowledge"]
  },
  {
    id: "hf-code-search-scout",
    triggerHints: ["code search", "github search", "online code"]
  },
  {
    id: "hf-reviewer",
    triggerHints: ["review", "reviewer", "code review", "sign off"]
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
  if (toggles.deepPlan) {
    enabled.push("hf-web-research-scout", "hf-brainstormer", "hf-code-search-scout", "hf-plan-synthesis");
  }
  if (toggles.enableReview) {
    enabled.push("hf-verification-before-completion", "hf-reviewer");
  }
  return enabled;
}

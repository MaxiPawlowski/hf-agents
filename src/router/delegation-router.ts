import { hasSubagent } from "../registry/agent-registry.js";
import {
  routeTaskInputSchema,
  type DelegationCategory,
  type RouteTaskDecision,
  type RouteTaskInput
} from "../contracts/index.js";

const CATEGORY_HINTS: Array<{ category: DelegationCategory; hints: string[] }> = [
  { category: "feature", hints: ["complex", "multi", "epic", "feature"] },
  { category: "planning", hints: ["plan", "break down"] },
  { category: "context", hints: ["context", "find"] },
  { category: "validation", hints: ["test", "validate"] },
  { category: "review", hints: ["review", "quality"] },
  { category: "build", hints: ["build", "type"] },
  { category: "docs", hints: ["docs", "library"] },
  { category: "completion", hints: ["finish", "pr", "merge"] }
];

function heuristicSubagent(intent: string): string {
  const normalized = intent.toLowerCase();

  if (
    normalized.includes("complex") ||
    normalized.includes("multi") ||
    normalized.includes("epic") ||
    normalized.includes("feature")
  ) {
    return "TaskManager";
  }

  if (normalized.includes("plan") || normalized.includes("break down")) {
    return "TaskPlanner";
  }

  if (normalized.includes("context") || normalized.includes("find")) {
    return "ContextScout";
  }

  if (normalized.includes("test") || normalized.includes("validate")) {
    return "Tester";
  }

  if (normalized.includes("review") || normalized.includes("quality")) {
    return "Reviewer";
  }

  if (normalized.includes("build") || normalized.includes("type")) {
    return "BuildValidator";
  }

  if (normalized.includes("docs") || normalized.includes("library")) {
    return "ExternalDocsScout";
  }

  if (normalized.includes("finish") || normalized.includes("pr") || normalized.includes("merge")) {
    return "Reviewer";
  }

  return "Coder";
}

export function inferDelegationCategory(intent: string): DelegationCategory {
  const normalized = intent.toLowerCase();
  const matched = CATEGORY_HINTS.find((entry) => entry.hints.some((hint) => normalized.includes(hint)));
  return matched ? matched.category : "implementation";
}

export function routeTask(input: string | RouteTaskInput): string {
  return routeTaskDetailed(input).assignedSubagent;
}

export function routeTaskDetailed(input: string | RouteTaskInput): RouteTaskDecision {
  const parsed = routeTaskInputSchema.parse(
    typeof input === "string"
      ? { intent: input }
      : { ...input, category: input.category ?? inferDelegationCategory(input.intent) }
  );

  const profile = parsed.category ? parsed.profiles[parsed.category] : undefined;
  if (profile && hasSubagent(profile.preferredSubagent)) {
    return {
      assignedSubagent: profile.preferredSubagent,
      source: "profile",
      matchedCategory: parsed.category
    };
  }

  return {
    assignedSubagent: heuristicSubagent(parsed.intent),
    source: "heuristic",
    matchedCategory: parsed.category
  };
}

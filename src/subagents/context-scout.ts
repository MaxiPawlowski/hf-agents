import { contextBundleSchema, taskSchema, type ContextBundle } from "../contracts/index.js";

const BASE_CONTEXT_FILES = [
  ".opencode/context/navigation.md",
  ".opencode/context/core/standards/code-quality.md",
  ".opencode/context/core/standards/documentation.md",
  ".opencode/context/project-intelligence/technical-domain.md",
  ".opencode/context/project/runtime-preferences.md"
];

export function runContextScout(taskInput: unknown): ContextBundle {
  const task = taskSchema.parse(taskInput);
  const normalized = task.intent.toLowerCase();
  const relevantFiles = [...BASE_CONTEXT_FILES];

  if (normalized.includes("test") || normalized.includes("verify") || normalized.includes("validation")) {
    relevantFiles.push(".opencode/context/core/standards/test-coverage.md");
  }

  if (task.category === "docs" || normalized.includes("docs")) {
    relevantFiles.push("docs/architecture.md");
  }

  if (normalized.includes("workflow") || normalized.includes("process") || normalized.includes("delegation")) {
    relevantFiles.push(".opencode/context/project-intelligence/external-inspirations.md");
  }

  if (task.category === "implementation" || normalized.includes("implement") || normalized.includes("feature")) {
    relevantFiles.push("src/orchestrator/core-agent.ts");
  }

  const unresolvedQuestions: string[] = [];
  if (task.successCriteria.length === 0) {
    unresolvedQuestions.push("No explicit success criteria provided; use policy-aligned defaults.");
  }

  return contextBundleSchema.parse({
    taskId: task.id,
    summary: `Context scoped for '${task.intent}'.`,
    relevantFiles: Array.from(new Set(relevantFiles)),
    constraints: task.constraints,
    unresolvedQuestions
  });
}

import {
  contextBundleSchema,
  executionPlanSchema,
  taskSchema,
  type ContextBundle,
  type ExecutionPlan
} from "../contracts/index.js";

function buildPlanSteps(taskIntent: string, hasCriteria: boolean): ExecutionPlan["steps"] {
  const steps: ExecutionPlan["steps"] = [
    {
      id: "step-1",
      description: `Map intent to concrete change areas for '${taskIntent}'`
    },
    {
      id: "step-2",
      description: "Implement the minimal scoped change set"
    },
    {
      id: "step-3",
      description: "Verify scope and policy compliance before completion"
    }
  ];

  if (!hasCriteria) {
    steps.splice(1, 0, {
      id: "step-1b",
      description: "Define explicit acceptance checks from requested outcome"
    });
  }

  return steps;
}

export function runTaskPlanner(taskInput: unknown, contextInput?: unknown): ExecutionPlan {
  const task = taskSchema.parse(taskInput);
  const context: ContextBundle | undefined = contextInput ? contextBundleSchema.parse(contextInput) : undefined;

  const risks = task.riskLevel === "high"
    ? ["High-risk scope: require stricter reviewer validation before completion."]
    : [];
  if (context && context.unresolvedQuestions.length > 0) {
    risks.push("Context has unresolved questions; use explicit assumptions in implementation notes.");
  }

  const plan: ExecutionPlan = {
    taskId: task.id,
    objective: task.intent,
    steps: buildPlanSteps(task.intent, task.successCriteria.length > 0),
    contextFiles: context?.relevantFiles ?? [],
    risks,
    assumptions: [
      task.successCriteria.length > 0
        ? "Use provided success criteria as acceptance checks."
        : "Treat policy defaults and user intent as acceptance baseline."
    ]
  };

  return executionPlanSchema.parse(plan);
}

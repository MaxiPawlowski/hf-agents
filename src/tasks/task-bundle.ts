import {
  executionPlanSchema,
  taskBundleSchema,
  taskSchema,
  type ExecutionPlan,
  type Task,
  type TaskBundle
} from "../contracts/index.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function baseContextFiles(): string[] {
  return [
    ".opencode/context/navigation.md",
    ".opencode/context/core/standards/code-quality.md",
    ".opencode/context/core/standards/documentation.md",
    ".opencode/context/core/standards/test-coverage.md"
  ];
}

export function createTaskBundle(taskInput: unknown, planInput?: unknown): TaskBundle {
  const task = taskSchema.parse(taskInput);
  const plan = planInput ? executionPlanSchema.parse(planInput) : undefined;

  const featureSlug = slugify(task.intent || task.id) || task.id;
  const subtasks = createSubtasks(task, plan, featureSlug);

  return taskBundleSchema.parse({
    featureId: featureSlug,
    name: task.intent,
    objective: task.intent,
    status: "active",
    contextFiles: baseContextFiles(),
    referenceFiles: [],
    exitCriteria: task.successCriteria.length > 0
      ? task.successCriteria
      : ["Requested behavior is implemented", "Scope validated by Reviewer"],
    subtasks
  });
}

function createSubtasks(task: Task, plan: ExecutionPlan | undefined, featureSlug: string): TaskBundle["subtasks"] {
  if (!plan) {
    return [
      {
        id: `${featureSlug}-01`,
        seq: "01",
        title: "Clarify scope and constraints",
        status: "pending",
        dependsOn: [],
        parallel: false,
        suggestedAgent: "TaskPlanner",
        contextFiles: baseContextFiles(),
        referenceFiles: [],
        acceptanceCriteria: ["Scope is explicit"],
        deliverables: ["Task breakdown"]
      },
      {
        id: `${featureSlug}-02`,
        seq: "02",
        title: "Implement focused changes",
        status: "pending",
        dependsOn: ["01"],
        parallel: false,
        suggestedAgent: "Coder",
        contextFiles: baseContextFiles(),
        referenceFiles: [],
        acceptanceCriteria: ["Implementation matches scope"],
        deliverables: ["Code patch summary"]
      },
      {
        id: `${featureSlug}-03`,
        seq: "03",
        title: "Verify and close",
        status: "pending",
        dependsOn: ["02"],
        parallel: false,
        suggestedAgent: "Reviewer",
        contextFiles: baseContextFiles(),
        referenceFiles: [],
        acceptanceCriteria: ["Review passes and findings are resolved"],
        deliverables: ["Review report"]
      }
    ];
  }

  return plan.steps.map((step, index) => {
    const seq = String(index + 1).padStart(2, "0");
    return {
      id: `${featureSlug}-${seq}`,
      seq,
      title: step.description,
      status: "pending" as const,
      dependsOn: index === 0 ? [] : [String(index).padStart(2, "0")],
      parallel: false,
      suggestedAgent: index === 0 ? "TaskPlanner" : index === plan.steps.length - 1 ? "Reviewer" : "Coder",
      contextFiles: baseContextFiles(),
      referenceFiles: [],
      acceptanceCriteria: [step.description],
      deliverables: ["Step output"]
    };
  });
}

import { executionPlanSchema, taskSchema, type ExecutionPlan } from "../contracts/index.js";

export function runTaskPlanner(taskInput: unknown): ExecutionPlan {
  const task = taskSchema.parse(taskInput);

  const plan: ExecutionPlan = {
    taskId: task.id,
    objective: task.intent,
    steps: [
      {
        id: "step-1",
        description: "Map task intent to target implementation units"
      },
      {
        id: "step-2",
        description: "Produce minimal change set aligned with constraints"
      },
      {
        id: "step-3",
        description: "Prepare output for reviewer verification"
      }
    ]
  };

  return executionPlanSchema.parse(plan);
}

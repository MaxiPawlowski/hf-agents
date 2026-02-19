import { executionPlanSchema, taskBundleSchema, type ExecutionPlan, type TaskBundle } from "../contracts/index.js";
import { createTaskBundle } from "../tasks/task-bundle.js";

export function runTaskManager(taskInput: unknown, planInput: unknown): TaskBundle {
  const plan = executionPlanSchema.parse(planInput);
  const bundle = createTaskBundle(taskInput, plan);
  return taskBundleSchema.parse(bundle);
}

export function summarizeTaskManagerBundle(bundleInput: unknown): {
  subtaskCount: number;
  parallelizable: number;
} {
  const bundle = taskBundleSchema.parse(bundleInput);
  return {
    subtaskCount: bundle.subtasks.length,
    parallelizable: bundle.subtasks.filter((subtask) => subtask.parallel).length
  };
}

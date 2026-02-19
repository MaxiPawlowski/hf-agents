import {
  coreDelegationResultSchema,
  runtimeSettingsSchema,
  taskSchema,
  type CoreDelegationResult
} from "../contracts/index.js";
import { runContextScout } from "../subagents/context-scout.js";
import { runTaskPlanner } from "../subagents/task-planner.js";
import { runCoder } from "../subagents/coder.js";
import { runReviewer } from "../subagents/reviewer.js";

export function executeCoreDelegationPath(taskInput: unknown, settingsInput: unknown): CoreDelegationResult {
  const task = taskSchema.parse(taskInput);
  const settings = runtimeSettingsSchema.parse(settingsInput);

  const context = runContextScout(task, settings);
  const plan = runTaskPlanner(task, context);
  const patch = runCoder(plan, settings);
  const review = runReviewer(plan, patch, settings);

  return coreDelegationResultSchema.parse({ context, plan, patch, review });
}

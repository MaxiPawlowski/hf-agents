import {
  coreDelegationResultSchema,
  policySchema,
  taskSchema,
  type CoreDelegationResult
} from "../contracts/index.js";
import { runContextScout } from "../subagents/context-scout.js";
import { runTaskPlanner } from "../subagents/task-planner.js";
import { runCoder } from "../subagents/coder.js";
import { runReviewer } from "../subagents/reviewer.js";

export function executeCoreDelegationPath(taskInput: unknown, policyInput: unknown): CoreDelegationResult {
  const task = taskSchema.parse(taskInput);
  const policy = policySchema.parse(policyInput);

  const context = runContextScout(task);
  const plan = runTaskPlanner(task, context);
  const patch = runCoder(plan, policy);
  const review = runReviewer(plan, patch, policy);

  return coreDelegationResultSchema.parse({ context, plan, patch, review });
}

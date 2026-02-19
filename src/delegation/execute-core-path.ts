import {
  coreDelegationResultSchema,
  policySchema,
  taskSchema,
  type CoreDelegationResult
} from "../contracts/index.js";
import { runTaskPlanner } from "../subagents/task-planner.js";
import { runCoder } from "../subagents/coder.js";
import { runReviewer } from "../subagents/reviewer.js";

export function executeCoreDelegationPath(taskInput: unknown, policyInput: unknown): CoreDelegationResult {
  const task = taskSchema.parse(taskInput);
  const policy = policySchema.parse(policyInput);

  const plan = runTaskPlanner(task);
  const patch = runCoder(plan, policy);
  const review = runReviewer(patch);

  return coreDelegationResultSchema.parse({ plan, patch, review });
}

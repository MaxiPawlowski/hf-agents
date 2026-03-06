---
name: hf-task-management
description: >
  Use for managing dependency-aware task lifecycle artifacts and delegation sequencing.
  Do NOT use for single-step tasks with no dependency graph.
autonomy: autonomous
context_budget: 8000 / 2000
max_iterations: 5
---

# Task Management

Iron law: Never mark a subtask `completed` if any `dependsOn` prerequisite is not already `completed`.

## Overview

One lifecycle management pass: create, advance, or verify task artifacts for one feature. Artifact bookkeeping only — no code changes.

## When to Use

- When managing dependency-aware task lifecycle artifacts and delegation sequencing.
- When a feature has multiple subtasks with explicit ordering dependencies.

## When Not to Use

- For single-step tasks with no dependency graph.

## Scope

One lifecycle management pass: create, advance, or verify task artifacts for one feature. Artifact bookkeeping only — no code changes. Constraints: append-only updates; all subtasks must be accounted for (collection completeness); `.tmp/task-lifecycle.json` is the deterministic output path (stable output paths). Interface: `.opencode/commands/task-loop.md` (init/status/checkpoint/close).

## Workflow

1. **Plan gate** — Entry: multi-stage feature with dependency ordering. Create a `TaskBundle` and upsert into the lifecycle store. Exit: lifecycle store has a task entry with `featureId` and `subtasks[]` with `dependsOn`.
2. **Execute gate** — Entry: valid lifecycle artifact exists. Advance one subtask at a time (`pending → in_progress → completed`). Transitions respect `dependsOn` ordering. Exit: transitions are valid and artifact reflects current reality.
3. **Verify gate** — Entry: all claimed-complete subtasks are dependency-valid. Validate artifact integrity and (if required) verification evidence exists. Exit: all subtasks are dependency-valid and evidence requirements satisfied.

## Verification

- Run: `node -e "JSON.parse(require('fs').readFileSync('.tmp/task-lifecycle.json','utf8')); console.log('task-lifecycle-valid')"`
- Expect: `task-lifecycle-valid` with no JSON parse error.

## Failure Behavior

- On dependency violation (completing task with incomplete prerequisite): return `{ blocked: "dependency violation", why: "subtask <seq> depends on <seq> which is not completed", unblock: "complete prerequisite subtask <seq> first" }`.
- On invalid artifact schema: return `{ blocked: "artifact schema invalid", why: "<validation error details>", unblock: "<corrective edit>" }`.
- On circular dependency detected: return `{ blocked: "circular dependency", why: "<cycle path>", unblock: "restructure dependency graph to break cycle" }`.
- On priority/order conflict: escalate to user for product decision.

## Circuit Breaker

- Warning at 3 transition attempts on blocked tasks.
- Hard stop at 5 — report all blocked tasks and escalate.
- On circular dependency detected: immediate stop and report.

## Examples

### Correct
Mark task `in_progress`, complete it with evidence, then unlock dependent task. This works because the artifact acts as a reliable dependency graph — downstream tasks only start when their prerequisites are provably complete.

### Anti-pattern
Bulk-marking all tasks complete to simplify reporting. This fails because dependency violations go undetected, and dependent tasks may execute against incomplete prerequisites.

## Red Flags

- "Dependencies are obvious, no need to encode them."
- "I can clean up artifact history by rewriting prior states."

## Integration

- **Before:** feature scope + task bundle from `hf-core-delegation` or `hf-task-planner`.
- **After:** `{ feature_id, progress: { pending, in_progress, completed, blocked }, next_ready: [seq], blocked: [{ seq, blockedReason }], validation: errors[], next_action }`. Artifact: `.tmp/task-lifecycle.json`.

## Rollback

1. Revert `.tmp/task-lifecycle.json` to previous valid state.
2. Report which transitions were undone and affected subtask IDs.

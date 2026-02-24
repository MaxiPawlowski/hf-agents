---
name: hf-task-management
description: Use for managing dependency-aware task artifacts and delegation sequencing.
---

# Task Management

## Overview

Track and validate lifecycle artifacts in `.tmp/task-lifecycle.json` so delegation remains deterministic and auditable.

Iron law: Never mark a subtask `completed` if any `dependsOn` prerequisite is not already `completed`.

## When to Use

- Multi-stage implementation with dependency ordering.
- Delegated work where handoff artifacts are required.

## When Not to Use

- Single-step, non-delegated tasks with no dependency graph.

## Workflow

1. Plan gate
   - Create a `TaskBundle` and upsert it into the lifecycle store.
   - Exit gate: lifecycle store has a task entry with `featureId` and `subtasks[]`.
2. Execute gate
   - Advance one subtask at a time (`pending -> in_progress -> completed`).
   - Exit gate: transitions respect `dependsOn` (enforced by `src/tasks/task-lifecycle.ts`).
3. Verify gate
   - Validate artifact integrity and (if required) verification evidence exists.
   - Exit gate: all claimed-complete subtasks are dependency-valid and evidence requirements are satisfied.

## Required Output

Return:

- feature_id: string
- progress: counts of pending/in_progress/completed/blocked
- next_ready: list of `seq` that are dependency-ready
- blocked: list of `seq` with `blockedReason` (if any)
- validation: errors found (empty when ok)
- next_action: recommended next checkpoint command (if using `hf-task-loop`)

## Verification

- Run: `npm run build`
- Expect: build passes after implementation updates.
- Run: `node -e "JSON.parse(require('fs').readFileSync('.tmp/task-lifecycle.json','utf8')); console.log('task-lifecycle-valid')"`
- Expect: `task-lifecycle-valid` and no JSON parse error.

## Failure Behavior

- Stop checkpoint closure when validation errors or unresolved dependencies exist.
- Report blocking subtask seqs, dependency edges, and required next action.
- Escalate to user when priority/order conflicts require product decisions.

## Examples

- Good: mark task `in_progress`, complete it, then unlock dependent task with evidence entry.
- Anti-pattern: bulk mark all tasks complete to simplify reporting.

## Red Flags

- "Dependencies are obvious, no need to encode them."
- "I can clean up artifact history by rewriting prior states."
- Corrective action: restore append-only updates and re-run lifecycle validation.

## Integration

- Used by: `hf-core-agent`, `hf-task-manager`.
- Required before: `hf-task-artifact-gate` when task artifacts are required.
- Required after: `hf-verification-before-completion` when a completion claim is made.
- Executable interface:
  - `src/tasks/task-lifecycle.ts` (read/write/transition helpers)
  - `.opencode/commands/task-loop.md` (init/status/checkpoint/close)

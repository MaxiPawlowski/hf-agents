---
name: hf-task-artifact-gate
description: Enforce task lifecycle artifact tracking gate.
---

# Task Artifact Gate

## Overview

Iron law: Every active workstream must have an up-to-date lifecycle artifact.

## When to Use
- Work spans multiple steps, dependencies, or delegated units.

## When Not to Use

- Toggle is disabled and user did not request artifact tracking.
- One-step trivial tasks with no dependency surface.

## Workflow

1. Artifact initialization
    - Ensure `.tmp/task-lifecycle.json` exists for active feature.
    - Recommended helper: `.opencode/commands/task-loop.md` (`hf-task-loop init|checkpoint|status|close`).
    - Exit gate: artifact has `version: 1`, a task entry with `featureId`, and `subtasks[]` with `dependsOn`.
2. Execution sync
   - Update status as tasks move `pending -> in_progress -> completed`.
   - Exit gate: artifact reflects current reality (no impossible transitions).
3. Completion sync
   - Finalize evidence and next-ready snapshot.
   - Exit gate: output includes artifact summary and unresolved blockers (if any).

## Verification

- Run: `npm run build`
- Expect: project still builds after tracked changes.
- Run: `node -e "JSON.parse(require('fs').readFileSync('.tmp/task-lifecycle.json','utf8')); console.log('task-artifact-ok')"`
- Expect: `task-artifact-ok` plus valid JSON parse.

## Failure Behavior

- Stop if artifact is missing or invalid while this gate is active.
- Report invalid field(s), affected task id(s), and corrective action.
- Escalate to user only if schema decision or dependency intent is unclear.

## Integration

- Required before: `hf-task-management` and/or `hf-task-manager` for dependency-aware planning.
- Required after: `hf-verification-before-completion` readiness checks.
- Input artifacts: feature scope, task bundle, current execution status.
- Output artifacts: updated `.tmp/task-lifecycle.json`, progress summary, blocker list.

## Examples

- Good: each delegated subtask updates artifact status and evidence before handoff.
- Anti-pattern: finishing coding first and backfilling lifecycle state at the end.

## Red Flags

- "Artifact updates can wait until final message."
- "I changed dependencies without updating blocked reasons."
- Corrective action: pause execution, repair artifact state, then continue.

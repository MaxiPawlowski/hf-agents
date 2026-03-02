---
name: hf-task-artifact-gate
description: >
  Use when work spans multiple steps, dependencies, or delegated units and lifecycle artifacts must be tracked.
  Do NOT use when toggle is disabled and user did not request artifact tracking, or for trivial one-step tasks.
autonomy: autonomous
context_budget: 6000 / 1500
max_iterations: 3
---

# Task Artifact Gate

## Iron Law

Every active workstream must have an up-to-date lifecycle artifact. Never proceed past a gate when the artifact is missing or invalid.

## Scope

One artifact validation pass for one active workstream. No code changes — artifact bookkeeping only. Constraints: append-only updates; no rewriting prior states.

## Workflow

1. **Artifact initialization** — Entry: active feature with no lifecycle artifact or stale artifact. Ensure `.tmp/task-lifecycle.json` exists with `version: 1`, `featureId`, and `subtasks[]` with `dependsOn`. Recommended helper: `.opencode/commands/task-loop.md` (`hf-task-loop init|checkpoint|status|close`). Exit: artifact has valid schema and current feature entry.
2. **Execution sync** — Entry: valid artifact exists. Update status as tasks move `pending → in_progress → completed`. Exit: artifact reflects current reality with no impossible transitions.
3. **Completion sync** — Entry: all claimed-complete subtasks are dependency-valid. Finalize evidence and next-ready snapshot. Exit: output includes artifact summary and unresolved blockers (if any).

## Verification

- Run: `npm run build`
- Expect: project still builds after tracked changes.
- Run: `node -e "JSON.parse(require('fs').readFileSync('.tmp/task-lifecycle.json','utf8')); console.log('task-artifact-ok')"`
- Expect: `task-artifact-ok` with no JSON parse error.

## Error Handling

- On missing artifact while gate is active: return `{ blocked: "lifecycle artifact missing", why: "no .tmp/task-lifecycle.json for active feature", unblock: "run hf-task-loop init" }`.
- On invalid schema or impossible transition: return `{ blocked: "artifact validation failed", why: "<invalid field(s) and affected task id(s)>", unblock: "<corrective edit to artifact>" }`.
- On ambiguous dependency intent: escalate to user for priority/order clarification.

## Circuit Breaker

- Warning at 2 validation failures on the same artifact.
- Hard stop at 3 validation failures — force report and escalate.
- On same schema violation repeated: stop and escalate to user.

## Examples

### Correct
Each delegated subtask updates artifact status and evidence before handoff. This works because downstream tasks can trust the artifact as source of truth for dependency readiness.

### Anti-pattern
Finishing all coding first and backfilling lifecycle state at the end. This fails because intermediate dependency violations go undetected, and blocked tasks may execute against incomplete prerequisites.

## Red Flags

- "Artifact updates can wait until final message."
- "I changed dependencies without updating blocked reasons."

## Handoffs

- **Before:** feature scope + task bundle + current execution status from `hf-task-management` or `hf-core-delegation`.
- **After:** updated `.tmp/task-lifecycle.json` + progress summary (pending/in_progress/completed/blocked counts) + blocker list. Schema: `{ feature_id, progress, next_ready, blocked, validation }`.

## Rollback

1. Restore `.tmp/task-lifecycle.json` from backup or last valid state.
2. Report which transitions were rolled back and affected task IDs.

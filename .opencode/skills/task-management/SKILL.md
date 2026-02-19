---
name: hf-task-management
description: Use for managing dependency-aware task artifacts and delegation sequencing.
---

# Task Management

## Overview

Track and validate lifecycle artifacts in `.tmp/task-lifecycle.json` so delegation remains deterministic and auditable.

This flow is optional in `fast` mode and recommended for complex, multi-stage work.

## Integration

Run via task lifecycle APIs in `src/tasks/task-lifecycle.ts`.

## Rules

- Keep subtasks atomic and dependency-correct.
- Never mark a task complete when dependencies are unresolved.
- Use Reviewer verification before closing final subtasks in balanced/strict profile.
- Keep updates append-only per feature checkpoint; avoid destructive rewrites.

## Lifecycle fields

- `featureId`
- `phase` (`planned|implementing|reviewing|verifying|closed`)
- `tasks[]` with `status`, `dependsOn`, and `owner`
- `nextReadyTasks[]`
- `blockedReasons[]`
- `evidence[]`
- `updatedAt`

## Output

- current progress summary
- ready tasks and blocked reasons
- validation errors (if any)
- recommended next checkpoint command

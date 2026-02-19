---
name: hf-task-loop
description: Manage optional v2 lifecycle checkpoints for complex feature execution.
argument-hint: <init|status|checkpoint|close> --feature=<key> [--phase=<name>] [--note=<text>]
---

## Purpose

Provide a lightweight, optional task artifact loop inspired by structured task-state workflows.

## Preconditions

- Feature key is provided.
- `.tmp/` is writable.

## Execution Contract

1. `init`: create or refresh feature entry in `.tmp/task-lifecycle.json`.
2. `status`: report progress, ready tasks, blocked reasons, and next checkpoint.
3. `checkpoint`: append stage update (`phase`, `note`, `updatedAt`) and recompute readiness.
4. `close`: mark feature complete and preserve final evidence snapshot.

## Required Output

- `Feature`: key and current phase.
- `Progress`: completed/in-progress/blocked counts.
- `Ready Tasks`: tasks with resolved dependencies.
- `Blocked Reasons`: concise blockers.
- `Next Action`: recommended next command.

## Failure Contract

- Never overwrite unrelated feature entries.
- If lifecycle file is invalid, return repair guidance and do not continue writes.

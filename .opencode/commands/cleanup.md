---
name: hf-cleanup
description: Clean stale framework temporary artifacts with safety checks.
argument-hint: [--feature=<key>] [--force] [--dry-run]
---

## Purpose

Reduce stale task/session artifacts while preserving active work.

## Preconditions

- Temporary directories are readable (`.tmp/task-lifecycle.json`, `.tmp/sessions`, optional caches).
- Cleanup target is defined (feature-specific or global).

## Execution Contract

1. Discover cleanup candidates and classify active vs stale.
2. Default behavior is non-destructive preview.
3. Apply deletions only when `--force` is present or explicit user confirmation is available.
4. Preserve active tasks and currently referenced session artifacts.

## Required Output

- `Candidates`: count and path summary.
- `Deleted`: applied deletions (or none in preview).
- `Preserved`: active items skipped.
- `Freed Space`: approximate reclaimed size.

## Failure Contract

- Never delete active artifacts.
- On error, stop further deletion and report partial results with rollback guidance.

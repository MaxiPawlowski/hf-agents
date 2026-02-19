---
name: hf-task-management
description: Use for managing dependency-aware task artifacts and delegation sequencing.
---

# Task Management

## Overview

Track and validate lifecycle artifacts in `.tmp/task-lifecycle.json` so delegation remains deterministic and auditable.

## Commands

Run via framework lifecycle commands:

- `framework task-status [--feature <feature-id>]`
- `framework task-next --feature <feature-id>`
- `framework task-blocked --feature <feature-id>`
- `framework task-resume --feature <feature-id>`

## Rules

- Keep subtasks atomic and dependency-correct.
- Never mark a task complete when dependencies are unresolved.
- Use Reviewer verification before closing final subtasks in balanced/strict mode.

## Output

- current progress summary
- ready tasks and blocked reasons
- validation errors (if any)

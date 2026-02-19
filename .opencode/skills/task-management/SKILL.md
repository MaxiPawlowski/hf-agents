---
name: hf-task-management
description: Use for managing dependency-aware task artifacts and delegation sequencing.
---

# Task Management

## Overview

Track and validate `.tmp/tasks/<feature>/` artifacts so delegation remains deterministic and auditable.

## Commands

Run via:

`bash .opencode/skills/task-management/router.sh <command> [feature]`

Supported commands:
- `status [feature]`
- `next [feature]`
- `blocked [feature]`
- `parallel [feature]`
- `validate [feature]`

## Rules

- Keep subtasks atomic and dependency-correct.
- Never mark a task complete when dependencies are unresolved.
- Use Reviewer verification before closing final subtasks in balanced/strict mode.

## Output

- current progress summary
- ready tasks and blocked reasons
- validation errors (if any)

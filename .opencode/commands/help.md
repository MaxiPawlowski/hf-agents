---
name: hf-help
description: Show command catalog, recommended workflows, and profile guidance.
argument-hint: [command-name]
---

## Purpose

Provide quick command discovery and route users to the correct next action.

## Preconditions

- Command catalog is available under `.opencode/commands/`.

## Execution Contract

1. If a specific command name is provided, show purpose, arguments, and expected output.
2. Otherwise, list available commands grouped by workflow phase.
3. Include profile guidance (`fast`, `balanced`, `strict`) and recommended default path.

## Required Output

- `Command Catalog`: grouped command list with one-line intent.
- `Workflow`: common sequence (hf-setup -> hf-brainstorm -> hf-plan-feature -> hf-run-core-delegation -> hf-status -> hf-verify -> hf-finish).
- `Optional Workflow`: for lifecycle tracking, insert `hf-task-loop` checkpoints between planning, implementation, and verification.
- `Profile Guidance`: when to use each profile.
- `Examples`: two to three concise command examples.

## Failure Contract

- If command metadata cannot be read, return missing path details and fallback manual list.

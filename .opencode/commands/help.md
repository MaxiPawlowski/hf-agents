---
name: hf-help
description: HF: Show command catalog and recommended workflows.
argument-hint: [command-name]
---

## Purpose

Provide quick command discovery and route users to the correct next action.

## Preconditions

- Command catalog is available under `.opencode/commands/`.

## Execution Contract

1. If a specific command name is provided, show purpose, arguments, and expected output.
2. Otherwise, list available commands grouped by workflow phase.
3. Include toggle-aware guidance and recommended default path.
4. For command catalog output, call `toggle_get` and append ON/OFF status to each `toggle-*` command description.

## Required Output

- `Command Catalog`: grouped command list with one-line intent, including individual `toggle-*` commands and current `ON|OFF` state.
- `Workflow`: common sequence (hf-setup -> hf-brainstorm -> hf-plan-feature -> hf-run-core-delegation -> hf-status -> hf-verify -> hf-finish).
- `Optional Workflow`: for lifecycle tracking, insert `hf-task-loop` checkpoints between planning, implementation, and verification.
- `Runtime Guidance`: how toggles affect execution gates.
- `Examples`: two to three concise command examples.

Recommended toggle commands:
- `toggle-worktree`
- `toggle-tests`
- `toggle-verification`
- `toggle-artifacts`
- `toggle-status`

## Failure Contract

- If command metadata cannot be read, return missing path details and fallback manual list.

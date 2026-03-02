---
name: toggle-artifacts
description: "HF: ON - Toggle task artifacts gate on or off."
argument-hint: <on|off>
---
## Purpose

Set `task_artifacts` runtime toggle.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=task_artifacts`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `task_artifacts=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.

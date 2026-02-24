---
name: toggle-worktree
description: "HF: Toggle worktree gate on or off."
argument-hint: <on|off>
---

## Purpose

Set `use_worktree` runtime toggle.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=use_worktree`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `use_worktree=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.

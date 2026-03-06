---
name: toggle-plan
description: "HF: OFF - Toggle deep plan on or off."
argument-hint: <on|off>
---
## Purpose

Set `deep_plan` runtime toggle. When ON, activates web research scout, brainstormer, online code search, and plan synthesis during the planning phase.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=deep_plan`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `deep_plan=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.

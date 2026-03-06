---
name: toggle-tests
description: "HF: OFF - Toggle required tests gate on or off."
argument-hint: <on|off>
---
## Purpose

Set `require_tests` runtime toggle.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=require_tests`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `require_tests=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.

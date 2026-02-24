---
name: toggle-verification
description: "HF: Toggle verification gate on or off."
argument-hint: <on|off>
---

## Purpose

Set `require_verification` runtime toggle.

## Preconditions

- Argument is `on` or `off`.

## Execution Contract

1. Call `toggle_set` with `key=require_verification`.
2. Apply the provided state.
3. Report updated state.

## Required Output

- `Toggle Updated`: `require_verification=ON|OFF`

## Failure Contract

- Return usage if argument is invalid.

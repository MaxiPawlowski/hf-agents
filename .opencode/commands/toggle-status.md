---
name: toggle-status
description: "HF: [W=OFF, T=OFF, V=OFF, A=ON] Show current runtime toggle states."
---

## Purpose

Inspect current in-memory toggle states for this directory session.

## Preconditions

- None.

## Execution Contract

1. Call `toggle_get` without a key.
2. Return all toggle states.

## Required Output

- `Toggle Status`: one line with each toggle and ON/OFF value.

## Failure Contract

- If state is unavailable, return fallback defaults and warning.

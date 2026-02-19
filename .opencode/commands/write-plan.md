---
name: hf-write-plan
description: Create an implementation plan using the hf-writing-plans skill.
argument-hint: <feature or task>
disable-model-invocation: true
---

## Purpose

Route planning work to the canonical planning workflow.

## Preconditions

- Planning target is provided.
- `hf-writing-plans` skill is available.

## Execution Contract

Invoke `hf-writing-plans` skill and follow it exactly.

## Required Output

- Plan file path under `docs/plans/`.
- Task list with file-level implementation steps.

## Failure Contract

- If skill invocation fails, return failure reason and manual fallback steps.

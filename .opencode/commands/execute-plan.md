---
name: hf-execute-plan
description: Execute an approved implementation plan with checkpoints.
argument-hint: <plan path>
disable-model-invocation: true
---

## Purpose

Route implementation execution to the plan-execution workflow.

## Preconditions

- Plan file exists and is approved.
- `hf-executing-plans` skill is available.

## Execution Contract

Invoke `hf-executing-plans` skill and follow it exactly.

## Required Output

- Task-by-task execution status.
- Verification summary per checkpoint.
- Final completion recommendation.

## Failure Contract

- If execution fails, return failed task, blocker, and restart point.

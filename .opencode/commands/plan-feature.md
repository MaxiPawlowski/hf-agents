---
name: hf-plan-feature
description: HF: Create dependency-aware feature plan and execution phases.
argument-hint: <feature description> [--task-loop=on|off]
---

## Purpose

Convert a feature request into a deterministic implementation plan with atomic subtasks.

## Preconditions

- A clear feature description is provided.
- Required agents are available: `TaskPlanner`, `TaskManager`.

## Execution Contract

1. Use `TaskPlanner` to produce scope, constraints, and acceptance criteria.
2. For context-heavy or external-library tasks, call `ContextScout` and optional `ExternalDocsScout` first.
3. If routing thresholds are met, use `TaskManager` to split work into dependency-aware subtasks.
4. Generate/update lifecycle artifacts in `.tmp/task-lifecycle.json` when `--task-loop=on` is selected.

Default behavior:
- when `task_artifacts=ON`, treat task loop as `on` unless explicitly disabled.
5. Return execution phases that respect dependencies and identify parallelizable work.

Optional v2 task loop:
- Default is `off` for fast planning.
- When `on`, include checkpoint fields (`plannedAt`, `phase`, `nextReadyTasks`, `blockedReasons`).

## Required Output

- `Feature ID`: normalized feature key.
- `Subtasks`: ordered list with owners and dependencies.
- `Execution Phases`: phase-by-phase run order.
- `Acceptance Criteria`: binary completion checks.

## Failure Contract

- Never return a plan without dependencies and acceptance criteria.
- If planning fails, return blocker, missing inputs, and smallest next step.

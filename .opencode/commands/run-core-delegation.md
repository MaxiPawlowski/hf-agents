---
name: hf-run-core-delegation
description: HF: Run the default toggle-aware delegation path for implementation tasks.
argument-hint: <task description> [--task-loop=on|off]
---

## Purpose

Route implementation work through the default delegation pipeline with deterministic stage outputs.

Runtime gates are resolved from `settings.toggles.*`.

## Preconditions

- A non-empty task description is provided.
- Runtime settings are resolved from project defaults plus overrides.
- Required agents are available: `TaskPlanner`, `Coder`, `Reviewer`.

## Execution Contract

1. `ContextScout` loads minimal relevant local context; call `ExternalDocsScout` when needed.
2. If routing thresholds are met, call `TaskManager`; otherwise continue direct path.
3. `TaskPlanner` creates scoped implementation plan and identifies risks.
4. `Coder` executes plan with minimal, scope-correct changes.
5. `Reviewer` validates in two passes: spec-fit, then quality/risk.

Use `@.opencode/context/project/subagent-handoff-template.md` for all delegated handoffs.

Toggle behavior:
- `requireTests=false`: no mandatory test gate; flag missing evidence as risk.
- `requireVerification=true`: require explicit verification evidence before completion recommendation.
- `requireCodeReview=true`: require explicit review signoff before completion recommendation.

Optional task loop (v2):
- `--task-loop=on` enables lifecycle checkpoint updates in `.tmp/task-lifecycle.json` after each major stage.
- `--task-loop=off` keeps orchestration stateless.
- Default behavior: when `task_artifacts=ON`, treat task loop as `on` unless explicitly disabled.

Defaults:
- No worktrees unless explicitly requested.
- No git management unless explicitly requested.

## Required Output

- `Plan`: scoped steps, touched areas, key assumptions.
- `Implementation Status`: completed/in-progress/blocked with evidence.
- `Review Findings`: must-fix items, non-blocking risks, open questions.
- `Next Action`: specific recommended next command.
- `Readiness`: `ready|not-ready`

## Failure Contract

- Never return success if any stage fails.
- On failure, include:
  - failed stage (`TaskPlanner` | `Coder` | `Reviewer`)
  - blocker summary
  - minimal recovery actions

---
name: hf-run-core-delegation
description: Run the default mode-aware delegation path for implementation tasks.
argument-hint: <task description> [--mode=<fast|balanced|strict>]
---

## Purpose

Route implementation work through the default delegation pipeline with deterministic stage outputs.

## Preconditions

- A non-empty task description is provided.
- Policy mode is resolved from argument or project default.
- Required agents are available: `TaskPlanner`, `Coder`, `Reviewer`.

## Execution Contract

1. `ContextScout` loads minimal relevant local context; call `ExternalDocsScout` when needed.
2. `TaskPlanner` creates scoped implementation plan and identifies risks.
3. `Coder` executes plan with minimal, scope-correct changes.
4. `Reviewer` validates in two passes: spec-fit, then quality/risk.

Mode behavior:
- `fast`: no mandatory test gate; flag missing verification as risk.
- `balanced`: require explicit verification evidence before completion recommendation.
- `strict`: require verification evidence plus test/build/type checks before completion recommendation.

Defaults:
- No worktrees unless explicitly requested.
- No git management unless explicitly requested.

## Required Output

- `Plan`: scoped steps, touched areas, key assumptions.
- `Implementation Status`: done/in-progress/blocked with evidence.
- `Review Findings`: must-fix items, non-blocking risks, open questions.
- `Next Action`: specific recommended next command.

## Failure Contract

- Never return success if any stage fails.
- On failure, include:
  - failed stage (`TaskPlanner` | `Coder` | `Reviewer`)
  - blocker summary
  - minimal recovery actions

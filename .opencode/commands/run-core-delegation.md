---
name: hf-run-core-delegation
description: Run the default profile-aware delegation path for implementation tasks.
argument-hint: <task description> [--profile=<fast|balanced|strict>] [--task-loop=on|off]
---

## Purpose

Route implementation work through the default delegation pipeline with deterministic stage outputs.

Policy source of truth: `@.opencode/context/project/policy-contract.md`

## Preconditions

- A non-empty task description is provided.
- Policy mode is resolved from argument or project default.
- Required agents are available: `TaskPlanner`, `Coder`, `Reviewer`.

## Execution Contract

1. `ContextScout` loads minimal relevant local context; call `ExternalDocsScout` when needed.
2. If routing thresholds are met, call `TaskManager`; otherwise continue direct path.
3. `TaskPlanner` creates scoped implementation plan and identifies risks.
4. `Coder` executes plan with minimal, scope-correct changes.
5. `Reviewer` validates in two passes: spec-fit, then quality/risk.

Use `@.opencode/context/project/subagent-handoff-template.md` for all delegated handoffs.

Profile behavior:
- `fast`: no mandatory test gate; flag missing verification as risk.
- `balanced`: require explicit verification evidence before completion recommendation.
- `strict`: require verification evidence plus test/build/type checks before completion recommendation.

Execution flavors:
- `fast`: bounded parallel scouting allowed.
- `governed-balanced`: explicit reviewer/evidence required.
- `compliance-strict`: strict verification artifacts required.

Optional task loop (v2):
- `--task-loop=on` enables lifecycle checkpoint updates in `.tmp/task-lifecycle.json` after each major stage.
- `--task-loop=off` keeps orchestration stateless (default for speed).

Defaults:
- No worktrees unless explicitly requested.
- No git management unless explicitly requested.

## Required Output

- `Plan`: scoped steps, touched areas, key assumptions.
- `Implementation Status`: completed/in-progress/blocked with evidence.
- `Review Findings`: must-fix items, non-blocking risks, open questions.
- `Next Action`: specific recommended next command.
- `Readiness`: `ready|not-ready (<profile>)`

## Failure Contract

- Never return success if any stage fails.
- On failure, include:
  - failed stage (`TaskPlanner` | `Coder` | `Reviewer`)
  - blocker summary
  - minimal recovery actions

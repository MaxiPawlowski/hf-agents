---
name: hf-core-delegation
description: Use when implementing coding tasks that should run through TaskPlanner -> Coder -> Reviewer with runtime toggle gates.
---

# Core Delegation

## Overview

Use this skill for the default implementation workflow in this repository.

Iron law: No implementation starts until scope, constraints, and delegation chain are explicit.

## When to Use

- Request needs end-to-end orchestration from discovery through review.
- Work requires routing across planner/coder/reviewer roles.

## When Not to Use

- Plan is already finalized and only execution remains (use subagent-driven flow).
- Small single-file edits that do not benefit from delegation overhead.

## Workflow

1. Intent gate (optional but recommended)
   - Use `hf-intent-scout` to classify intent/risk and select the safest workflow.
   - Exit gate: risk level and evidence expectations are explicit.
2. Context gate
   - `hf-context-scout` identifies minimum relevant local context.
   - Exit gate: constraints/toggles + candidate files are explicit.
3. Planning gate
    - `hf-task-planner` produces a small, verifiable plan.
    - Use `hf-task-manager` when dependency-heavy.
    - Exit gate: scope-in/scope-out + acceptance criteria + verify steps are explicit.
4. Execution gate
   - `hf-coder` implements scoped changes only.
   - Exit gate: files touched and rationale are captured.
5. Verification gate (conditional)
    - Use `hf-testing-gate` + `hf-tester` when tests are required.
    - Use `hf-approval-gates` + `hf-build-validator` / `hf-reviewer` when verification is required.
    - Exit gate: evidence is fresh and tied to requested scope.
6. Review gate
   - `hf-reviewer` validates scope-fit and gate compliance.
   - Exit gate: approved yes/no + next action.

Use `hf-external-docs-scout` when external library behavior is uncertain.
Brainstorming ownership: orchestrator-led via `hf-brainstorming` unless explicitly delegated.

## Handoff Contract

- TaskPlanner -> objective + scope + steps (with verify) + risks
- TaskManager -> featureId + subtasks + dependencies + artifact update
- Coder -> implemented + files_touched + commands_run + results + gaps
- Tester/BuildValidator -> commands_run + results + evidence
- Reviewer -> approved + findings + evidence_gaps + required_next_action

Reviewer performs two passes:
- pass 1: scope/spec fit
- pass 2: quality/risk/runtime fit

## When to use support subagents

- `ContextScout` when constraints, standards, or context are unclear
- `ExternalDocsScout` when external libraries or APIs are involved
- `BuildValidator` and `Tester` when user request or runtime toggle gates require verification

Skill selection matrix:

- Use `hf-core-delegation` when request needs end-to-end orchestration.
- Use `hf-subagent-driven-development` when plan is already approved and execution is the primary task.
- Use `hf-bounded-parallel-scouting` for lightweight discovery bursts.

## Runtime toggle gates

- If review is required by runtime policy, require explicit review signoff.

Use `@.opencode/context/project/subagent-handoff-template.md` for delegation handoffs.

Default safety:
- no implicit git operations
- no implicit worktree creation
- no mandatory tests unless runtime toggle gates or user request require them

## Integration

- Used by: `hf-core-agent`.
- Pairs with: `hf-git-workflows` when workspace strategy matters.
- Require `hf-task-artifact-gate` and keep `.tmp/task-lifecycle.json` current when task artifacts are required.
- Executable interface:
  - `.opencode/commands/run-core-delegation.md`
  - `.opencode/context/project/subagent-handoff-template.md`

## Verification

- Run: `npm run build`
- Expect: build passes after code changes.
- Run: `git status --short`
- Expect: scope of file changes matches delegation summary.

## Red Flags

- Starting implementation before scope is explicit
- Adding unrequested functionality
- Running git actions without explicit instruction

Corrective action: return to context/planning gate and re-establish explicit scope.

## Completion Format

Return:
- Plan summary
- Implementation summary with changed files
- Review findings

## Failure Behavior

- Stop on unresolved ambiguity or failed review pass.
- Report blocking condition, impacted scope item, and required next decider.
- Escalate to user for scope trade-offs or policy overrides.

## Examples

- Good: context scout -> planner -> coder -> two-pass review with gate-aware completion note.
- Anti-pattern: direct coding before routing decision and without review artifacts.

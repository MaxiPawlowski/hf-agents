---
name: hf-core-delegation
description: Use when implementing coding tasks that should run through TaskPlanner -> Coder -> Reviewer with profile-aware gates.
---

# Core Delegation

## Overview

Use this skill for the default implementation workflow in this repository.

## Execution chain

0. ContextScout identifies minimum relevant local context.
1. TaskManager (only when routing thresholds are met) generates dependency-aware task artifacts.
2. TaskPlanner produces concise implementation steps.
3. Coder implements only the scoped changes.
4. Reviewer validates scope fit and quality.

Use ExternalDocsScout when external library behavior is uncertain.

## Handoff contract

- TaskPlanner -> Objective + steps + risks
- Coder -> Change summary + files touched + constraints respected
- Reviewer -> Pass/fail + findings + next action
- TaskManager -> Task bundle + dependencies + parallelizable units

Reviewer performs two passes:
- pass 1: scope/spec fit
- pass 2: quality/risk/policy fit

## When to use support subagents

- `ContextScout` when constraints, standards, or context are unclear
- `ExternalDocsScout` when external libraries or APIs are involved
- `BuildValidator` and `Tester` when user request or settings profile requires verification

Skill selection matrix:

- Use `hf-core-delegation` when request needs end-to-end orchestration.
- Use `hf-subagent-driven-development` when plan is already approved and execution is the primary task.
- Use `hf-bounded-parallel-scouting` for `fast` profile discovery bursts.

## Mode-aware quality gates

- `fast`: keep flow lightweight
- `balanced`: require hf-verification-before-completion and explicit review signoff
- `strict`: require tests and explicit approval-oriented validation

Use `@.opencode/context/project/policy-contract.md` as mode/routing source of truth.
Use `@.opencode/context/project/subagent-handoff-template.md` for delegation handoffs.

Default safety:
- no implicit git operations
- no implicit worktree creation
- no mandatory tests unless mode/user requires them

## Red flags

- Starting implementation before scope is explicit
- Adding unrequested functionality
- Running git actions without explicit instruction

## Completion Format

Return:
- Plan summary
- Implementation summary with changed files
- Review findings

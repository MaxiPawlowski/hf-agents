---
name: hf-core-delegation
description: Use when implementing coding tasks that should run through TaskPlanner -> Coder -> Reviewer without approval-gate blocking.
---

# Core Delegation

## Overview

Use this skill for the default implementation workflow in this repository.

## Execution chain

1. TaskManager (for complex work) generates dependency-aware task artifacts.
2. TaskPlanner produces concise implementation steps.
3. Coder implements only the scoped changes.
4. Reviewer validates scope fit and quality.

## Handoff contract

- TaskPlanner -> Objective + steps + risks
- Coder -> Change summary + files touched + constraints respected
- Reviewer -> Pass/fail + findings + next action
- TaskManager -> Task bundle + dependencies + parallelizable units

## When to use support subagents

- `ContextScout` when constraints, standards, or context are unclear
- `ExternalDocsScout` when external libraries or APIs are involved
- `BuildValidator` and `Tester` only when user explicitly requests verification

## Mode-aware quality gates

- `fast`: keep flow lightweight
- `balanced`: require hf-verification-before-completion and explicit review signoff
- `strict`: require tests and explicit approval-oriented validation

## Project Defaults

- No worktrees unless user explicitly requests them.
- No git management unless user explicitly requests it.
- No mandatory tests; user validates manually by default.

## Red flags

- Starting implementation before scope is explicit
- Adding unrequested functionality
- Running git actions without explicit instruction

## Completion Format

Return:
- Plan summary
- Implementation summary with changed files
- Review findings

---
name: hf-testing-gate
description: Enforce required test evidence gate.
---

# Testing Gate

## Overview

Iron law: If test gate is required, completion is blocked until required checks run and pass or a user-approved exception is recorded.

## When to Use

- User requests mandatory test evidence.

## When Not to Use

- Read-only analysis with no code change.
- User explicitly asks for manual validation only and no runtime gate requires tests.

## Workflow

1. Requirement capture
   - Define exact required checks for this change.
   - Exit gate: required command list is explicit.
2. Execution
   - Run checks in deterministic order and capture outputs.
   - Exit gate: every required command has pass/fail result.
3. Readiness decision
   - Block completion on any fail/missing result.
   - Exit gate: output includes command-level evidence.

## Verification

- Run: `npm test`
- Expect: test command exits successfully with passing result summary.
- Run: `npm run build`
- Expect: build passes after test-aligned changes.

## Failure Behavior

- Stop completion on first required failure.
- Report failing command, key error signal, and next remediation step.
- Escalate to user for exception/waiver decisions.

## Integration

- Required before: `hf-approval-gates` when verification gates are active.
- Required after: `hf-verification-before-completion` final scope check.
- Input artifacts: requested behavior, changed files, required check list.
- Output artifacts: command log with pass/fail evidence and readiness decision.

## Examples

- Good: gate requires tests, you run `npm test` and include fresh result evidence.
- Anti-pattern: reporting "should pass" without running checks.

## Red Flags

- "Tests are probably fine for this tiny change."
- "I ran unrelated checks instead of required ones."
- Corrective action: run exact required commands and attach output evidence.

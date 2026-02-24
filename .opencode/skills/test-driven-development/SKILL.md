---
name: hf-test-driven-development
description: Use when settings or user request call for test-first implementation.
---

# Test-Driven Development

## Overview

Provide test-first implementation when explicitly requested by the user or required by runtime settings.

Iron law: Do not write or modify production code for a behavior until there is a failing test that captures that behavior.

## When to Use

- User asks for it, or
- Runtime toggle gates/settings explicitly require it.

## When Not to Use

- User requests manual validation only and no gate requires tests.
- Trivial documentation-only edits with no runtime behavior change.

## Workflow

1. Red phase
   - Add or update a focused test that fails for the requested behavior.
   - Exit gate: failing test output is captured.
2. Green phase
   - Implement the smallest production change to make the test pass.
   - Exit gate: target test passes.
3. Refactor phase
   - Improve code clarity/safety without changing behavior.
   - Exit gate: tests still pass after refactor.

## Guardrails

- Do not force this flow for users who requested manual validation.
- Keep tests focused on requested behavior.
- Avoid introducing test-only production behavior.

## Verification

- Run: `npm test`
- Expect: previously failing target test is now passing.
- Run: `npm run build`
- Expect: build succeeds with final implementation.

## Failure Behavior

- Stop if a failing test cannot be produced for the requested behavior.
- Report ambiguity or missing acceptance condition and ask for one concrete expectation.
- If green phase fails repeatedly, report failing signal and smallest remaining hypothesis.

## Integration

- Required before: `hf-testing-gate` when test evidence is required.
- Required after: `hf-verification-before-completion` for final scope-fit confirmation.
- Input artifacts: behavior request, existing test patterns, runtime gate state.
- Output artifacts: failing-to-passing test evidence and minimal implementation summary.

## Examples

- Good: add failing test for edge case, implement minimal fix, rerun suite, then refactor names only.
- Anti-pattern: implement feature first, then add tests to match current behavior.

## Red Flags

- "I'll add tests later once it works."
- "This change is too small to justify a failing test first."
- Corrective action: return to Red phase and capture the behavior in a focused failing test.

## Required Output

Return:

- tests: what test(s) were added/updated
- red_evidence: failing output signal before the fix
- green_evidence: passing output signal after the fix
- implementation: minimal production change summary

---
name: hf-test-driven-development
description: >
  Use when user requests or runtime settings require test-first implementation.
  Do NOT use when user requests manual validation only and no gate requires tests, or for documentation-only edits with no runtime behavior change.
autonomy: supervised
context_budget: 10000 / 3000
max_iterations: 5
---

# Test-Driven Development

## Iron Law

Do not write or modify production code for a behavior until there is a failing test that captures that behavior.

## Scope

One red-green-refactor cycle for one requested behavior. Constraints: do not force this flow for users who requested manual validation; keep tests focused on requested behavior; avoid introducing test-only production behavior.

## Workflow

1. **Red phase** — Entry: behavior request with no covering test. Add or update a focused test that fails for the requested behavior. Exit: failing test output is captured.
2. **Green phase** — Entry: failing test exists. Implement the smallest production change to make the test pass. Exit: target test passes.
3. **Refactor phase** — Entry: target test passing. Improve code clarity/safety without changing behavior. Exit: all tests still pass after refactor.

## Verification

- Run: `npm test`
- Expect: previously failing target test is now passing.
- Run: `npm run build`
- Expect: build succeeds with final implementation.

## Error Handling

- On cannot produce failing test: return `{ blocked: "no failing test possible", why: "<behavior is ambiguous or already covered>", unblock: "provide one concrete expectation for the behavior" }`.
- On green phase fails repeatedly: return `{ blocked: "green phase stuck", why: "<failing signal after N attempts>", unblock: "<smallest remaining hypothesis to test>" }`.
- On ambiguous acceptance condition: escalate to user for one concrete expectation.

## Circuit Breaker

- Warning at 3 green-phase attempts for the same test.
- Hard stop at 5 — report failing signal and escalate.
- On same test failure with same fix approach twice: stop and report.

## Examples

### Correct
Add failing test for edge case, implement minimal fix, rerun suite, then refactor names only. This works because the test proves the behavior exists before and after refactoring, preventing regressions.

### Anti-pattern
Implement feature first, then add tests to match current behavior. This fails because tests written after implementation confirm what was built, not what was requested — they can't catch spec drift.

## Red Flags

- "I'll add tests later once it works."
- "This change is too small to justify a failing test first."

## Handoffs

- **Before:** behavior request + existing test patterns + runtime gate state from `hf-core-delegation` or `hf-testing-gate`.
- **After:** `{ tests: [added/updated], red_evidence: "<failing output>", green_evidence: "<passing output>", implementation: "<minimal change summary>" }`.

## Rollback

1. Remove added test file(s) or revert test changes.
2. Revert production code changes.
3. Confirm test suite returns to pre-TDD state.

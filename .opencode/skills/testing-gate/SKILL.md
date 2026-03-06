---
name: hf-testing-gate
description: >
  Use when user or runtime toggle mandates test evidence before completion.
  Do NOT use for read-only analysis with no code change, or when user explicitly requests manual validation only with no runtime gate requiring tests.
autonomy: autonomous
context_budget: 6000 / 1500
max_iterations: 3
---

# Testing Gate

## Iron Law

If test gate is required, completion is blocked until all required checks run and pass, or a user-approved exception is recorded.

## Scope

One test evidence collection pass for one set of required checks. No creative decisions — run existing test commands and report results.

## Workflow

1. **Requirement capture** — Entry: code change with active test gate. Define exact required checks for this change. Exit: required command list is explicit.
2. **Execution** — Entry: required command list defined. Run checks in deterministic order and capture outputs. Exit: every required command has a pass/fail result.
3. **Readiness decision** — Entry: all commands executed. Block completion on any fail or missing result. Exit: output includes command-level evidence with pass/fail.

## Verification

- Run: `npm test`
- Expect: test command exits successfully with passing result summary.
- Run: `npm run build`
- Expect: build passes after test-aligned changes.

## Error Handling

- On test command failure: return `{ blocked: "required test failed", why: "<failing command + key error signal>", unblock: "<next remediation step>" }`.
- On missing test infrastructure: return `{ blocked: "no test runner configured", why: "<missing command or config>", unblock: "configure test runner or request user exception" }`.
- On ambiguous required checks: escalate to user for exception/waiver decision.

## Circuit Breaker

- Warning at 2 test command failures on the same check.
- Hard stop at 3 — report failing evidence and escalate.
- On same test failing with identical output: stop and report root cause hypothesis.

## Examples

### Correct
Gate requires tests. Run `npm test`, capture fresh output, include pass/fail evidence in completion report. This works because the readiness decision is backed by current-session evidence, not assumptions.

### Anti-pattern
Reporting "should pass" without running checks. This fails because stale assumptions miss regressions introduced by the current change.

## Red Flags

- "Tests are probably fine for this tiny change."
- "I ran unrelated checks instead of required ones."

## Handoffs

- **Before:** requested behavior + changed files + required check list from `hf-core-delegation` or `hf-subagent-driven-development`.
- **After:** command log with pass/fail evidence + readiness decision. Schema: `{ commands_run[], results[], readiness: pass|fail, gaps[] }`.

## Rollback

1. No code side effects to revert.
2. Retract readiness claim.
3. Report failing evidence with command outputs.

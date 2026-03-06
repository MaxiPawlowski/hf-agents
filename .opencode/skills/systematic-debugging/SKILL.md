---
name: hf-systematic-debugging
description: >
  Use when behavior is failing or unexpected and root cause is unclear.
  Do NOT use for known one-line fixes with verified path, or pure feature implementation with no failure signal.
autonomy: supervised
context_budget: 15000 / 4000
max_iterations: 6
---

# Systematic Debugging

Iron law: Do not ship a fix until root cause is evidenced and the failing symptom is re-verified as resolved.

## Overview

One debugging session: from symptom reproduction through root cause identification and minimum safe fix for one failure.

## When to Use

- When behavior is failing or unexpected and root cause is unclear.

## When Not to Use

- For known one-line fixes with a verified path.
- For pure feature implementation with no failure signal.

## Scope

One debugging session: from symptom reproduction through root cause identification and minimum safe fix for one failure. Constraints: no automatic git operations; no mandatory test requirement unless requested.

## Workflow

1. **Reproduction gate** — Entry: failure report received. Capture exact symptom and reproduction steps. Exit: failure is reproducible or bounded.
2. **Diagnosis gate** — Entry: failure reproduced. Test hypotheses with observable signals only. Keep a short log: symptom → hypothesis → check → result. Tie each hypothesis to an observable signal. Common patterns to check: hidden precondition mismatch, incorrect state transition ordering, integration contract drift, external dependency version mismatch. Exit: root cause statement is evidence-backed.
3. **Fix gate** — Entry: root cause identified. Apply minimum safe change. Exit: fix maps directly to root cause.
4. **Verification gate** — Entry: fix applied. Re-run failing path and required checks. Exit: symptom resolved with evidence.

## Verification

- Run: `npm test`
- Expect: failing path now passes when tests exist for symptom.
- Run: `npm run validate:assets`
- Expect: all validators remain passing after fix.

## Failure Behavior

- On cannot reproduce: return `{ blocked: "cannot reproduce", why: "<attempted reproduction steps and environment>", unblock: "provide additional reproduction context or environment details" }`.
- On multiple plausible root causes: return `{ blocked: "ambiguous root cause", why: "<hypothesis A and B both plausible>", unblock: "<specific discriminating test to run>" }`.
- On fix creates new failure: return `{ blocked: "fix regression", why: "<new symptom after fix>", unblock: "revert fix and investigate <new symptom>" }`.
- On external blocker: escalate to user for environment or priority decisions.

## Circuit Breaker

- Warning at 4 hypothesis tests without convergence.
- Hard stop at 6 — report all evidence gathered and escalate.
- On same hypothesis tested twice with same result: stop and report — the hypothesis is disproven.

## Examples

### Correct
Capture stack trace, test two hypotheses with targeted checks, isolate contract drift as root cause, apply targeted fix, verify symptom is gone. This works because each step narrows the search space with evidence, and the fix is directly tied to the proven root cause.

### Anti-pattern
Apply three speculative fixes at once and hope one works. This fails because even if the symptom disappears, the actual root cause is unknown, and the unrelated fixes may introduce latent issues.

## Red Flags

- "I changed many things to be safe."
- "The error disappeared once, so root cause is done."

## Integration

- **Before:** failure report with reproduction steps from `hf-core-delegation` or user. Optionally: context from `hf-bounded-parallel-scouting`.
- **After:** `{ root_cause, fix_summary, residual_risk, verification_evidence: { commands_run[], results[] } }`.

## Rollback

1. Revert fix changes via `git checkout -- <files>`.
2. Confirm symptom returns (proves fix isolation).
3. Report rollback state to orchestrator.

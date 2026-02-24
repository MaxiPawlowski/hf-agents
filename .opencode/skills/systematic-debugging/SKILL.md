---
name: hf-systematic-debugging
description: Use when behavior is failing or unexpected and root cause is unclear.
---

# Systematic Debugging

## Overview

Find root cause before applying fixes. Avoid guess-fix cycles.

Iron law: Do not ship a fix until root cause is evidenced and the failing symptom is re-verified as resolved.

## When to Use

- Reproducible failures with unknown origin.
- Intermittent behavior where assumptions are conflicting.

## When Not to Use

- Known one-line typo with direct, verified fix path.
- Pure feature implementation with no failure signal.

## Workflow

1. Reproduction gate
   - Capture exact symptom and reproduction steps.
   - Exit gate: failure is reproducible or bounded.
2. Diagnosis gate
   - Test hypotheses with observable signals only.
   - Exit gate: root cause statement is evidence-backed.
3. Fix gate
   - Apply minimum safe change.
   - Exit gate: fix maps directly to root cause.
4. Verification gate
   - Re-run failing path and required checks.
   - Exit gate: symptom resolved with evidence.

## Evidence standard

- Capture the failing symptom before changing code.
- Tie each hypothesis to an observable signal.
- Keep a short log: symptom -> hypothesis -> check -> result.

## Verification

- Run: `npm test`
- Expect: failing path now passes when tests exist for symptom.
- Run: `npm run build`
- Expect: build remains successful after fix.

## Common failure patterns

- Hidden precondition mismatch
- Incorrect state transition ordering
- Integration contract drift
- External dependency version mismatch

## Failure Behavior

- Stop if reproduction cannot be established after reasonable attempts.
- Report known observations, attempted checks, and smallest unknown blocking progress.
- Escalate to user for environment or priority decisions when blocked externally.

## Required Output

Return:
- Root cause statement
- Fix summary
- Residual risk
- Verification performed

## Project Defaults

- No automatic git operations.
- No mandatory test requirement unless requested.

## Examples

- Good: capture stack trace, test two hypotheses, isolate contract drift, apply targeted fix, verify symptom gone.
- Anti-pattern: apply three speculative fixes at once and hope one works.

## Red Flags

- "I changed many things to be safe."
- "The error disappeared once, so root cause is done."
- Corrective action: revert to smallest change set and rebuild evidence chain.

## Integration

- Used by: `hf-core-agent` when a bug/failure report is the primary request.
- Often pairs with: `hf-bounded-parallel-scouting` for quick context discovery.
- Required after: apply fix via `hf-coder`, then validate via `hf-tester` / `hf-build-validator` as needed.
- Required before: `hf-verification-before-completion` for completion claims.

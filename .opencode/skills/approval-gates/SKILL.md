---
name: hf-approval-gates
description: >
  Use when a task has mandatory review, verification, or approval criteria before marking work ready.
  Do NOT use for purely informational requests with no completion claim.
autonomy: gated
context_budget: 8000 / 2000
max_iterations: 3
---

# Approval Gates

Iron law: Never mark work ready when a required gate is unresolved. Every gate requires fresh evidence.

## Overview

One gate resolution pass per completion claim. Discovers active gates, collects evidence, and produces a readiness decision. No code changes — evidence aggregation only.

## When to Use

- When a task claims completion or readiness and mandatory review/verification criteria must be checked.
- When resolving runtime toggle gates before marking a milestone done.

## When Not to Use

- For purely informational requests with no completion claim.
- When no gates are active (no toggles enabled, no reviewer criteria set).

## Scope

One gate resolution pass: discover active gates, collect evidence, produce readiness decision. No code changes — evidence aggregation only.

## Workflow

1. **Gate discovery** — Entry: task claims completion or readiness. Resolve active runtime gates (from `framework-settings.json` toggles) and user-imposed gates. Exit: list of required approvals is explicit.
2. **Evidence collection** — Entry: required gate list defined. Gather verification output and reviewer findings for each gate. Exit: each required gate has fresh evidence.
3. **Readiness decision** — Entry: all evidence collected. Mark ready only if all required gates are green. Exit: final output states gate-by-gate status with evidence pointers.

## Verification

- Run: `npm run build`
- Expect: successful build output when implementation changed code.
- Run: `git status --short`
- Expect: changed files list matches reported scope.

## Failure Behavior

- On missing evidence for a required gate: return `{ blocked: "gate evidence missing", why: "<gate name> has no fresh evidence", unblock: "<exact verification command or reviewer action needed>" }`.
- On conflicting gate results: return `{ blocked: "gate conflict", why: "<gate A passes but gate B contradicts>", unblock: "resolve conflict with <specific action>" }`.
- On unclear whether gate applies: escalate to user for waive/override decision.

## Circuit Breaker

- Warning at 2 evidence collection rounds without all gates resolving.
- Hard stop at 3 — report unresolved gates and escalate.
- On same gate failing without new evidence between attempts: stop and escalate.

## Examples

### Correct
Verification gate ON. Run required commands, include fresh output evidence, report gate-by-gate matrix before saying ready. This works because each gate decision is traceable to current-session evidence.

### Anti-pattern
"Looks good" with no fresh evidence and no gate status. This fails because unresolved gates are invisible to the caller, creating false confidence in readiness.

## Red Flags

- "I skipped checks because change looked small."
- "I assumed review is optional without checking toggles."

## Integration

- **Before:** active toggle states + reviewer results + verification logs from `hf-testing-gate`, `hf-verification-before-completion`, or upstream reviewers.
- **After:** gate matrix with pass/fail and evidence pointers. Schema: `{ gates[]: { name, status: pass|fail, evidence_ref }, readiness: ready|blocked, unresolved[] }`.

## Rollback

1. No side effects to revert.
2. Retract readiness decision.
3. Report which gates remain unresolved with their last evidence state.

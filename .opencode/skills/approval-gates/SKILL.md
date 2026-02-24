---
name: hf-approval-gates
description: Enforce approval, verification, and review gates.
---

# Approval Gates

## Overview

Iron law: Never mark work ready when a required gate is unresolved.

## When to Use

- A task has mandatory review, verification, or approval criteria.

## When Not to Use

- Requests that are purely informational and do not claim completion.

## Workflow

1. Gate discovery
   - Resolve active runtime gates and user-imposed gates.
   - Exit gate: list of required approvals is explicit.
2. Evidence collection
   - Gather verification output and reviewer findings.
   - Exit gate: each required gate has fresh evidence.
3. Readiness decision
   - Mark ready only if all required gates are green.
   - Exit gate: final output states gate-by-gate status.

## Verification

- Run: `npm run build`
- Expect: successful build output when implementation changed code.
- Run: `git status --short`
- Expect: changed files list matches reported scope.

## Failure Behavior

- Stop readiness declaration if any required gate is missing evidence.
- Report missing gate, missing evidence, and exact unblock step.
- Escalate to user for waive/override decisions.

## Integration

- Required before: `hf-verification-before-completion`.
- Required after: final response with explicit gate outcomes.
- Input artifacts: active toggle states, reviewer results, verification logs.
- Output artifacts: gate matrix with pass/fail and evidence pointers.

## Examples

- Good: verification gate ON, you include command output evidence before saying ready.
- Anti-pattern: "Looks good" with no fresh evidence and no gate status.

## Red Flags

- "I skipped checks because change looked small."
- "I assumed review is optional without checking toggles."
- Corrective action: rerun gate discovery and attach evidence.

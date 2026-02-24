---
name: hf-verification-before-completion
description: Use before declaring work done to ensure output matches request.
---

# Verification Before Completion

## Overview

Prevent false "done" claims by checking scope, constraints, and output quality.

Iron law: Never claim completion without fresh verification evidence tied to the exact requested scope.

## When to Use

- Any response that claims implementation or fix completion.
- Any change where constraints/toggles may affect readiness.

## When Not to Use

- Pure brainstorming or exploratory discussion with no completion claim.

## Checklist

- Verify requested scope is fully covered.
- Confirm no unrequested expansion was introduced.
- Confirm constraints from runtime-preferences are respected.
- Provide a concise summary of results and known limitations.

## Required Output

Return:

- scope_map: user request -> delivered behavior (bullets)
- evidence: commands run + pass/fail signals
- gates: resolved toggle gates and whether each is satisfied
- gaps: missing verification/evidence and why
- residual_risks: prioritized bullets

## Workflow

1. Scope-fit gate
   - Map user request to delivered behavior.
   - Exit gate: all requested items are accounted for.
2. Constraint gate
   - Validate runtime preferences and safety defaults were respected.
   - Exit gate: no policy drift remains.
3. Evidence gate
   - Attach fresh command outputs relevant to the change.
   - Exit gate: completion claim is evidence-backed.

## Scope-fit checks

- Does behavior match user intent exactly?
- Were defaults respected (no worktrees, no auto-git, no forced tests)?
- Are changed files clearly documented?
- Are known trade-offs disclosed?

## Verification

- Run: `git status --short`
- Expect: changed file list matches reported implementation scope.
- Run: `npm run build`
- Expect: successful build for code-changing tasks.

## Integration

- Used by: `hf-core-agent`, `hf-reviewer`.
- Required after: `hf-approval-gates` when approval/verification gates are active.
- Consumes evidence from: `hf-tester`, `hf-build-validator`, `hf-git-workflows`.

## Failure Behavior

- Stop completion claim if any scope item or constraint is unresolved.
- Report unresolved item, impact, and exact next action.
- Escalate to user when trade-off or waiver is required.

## Completion message format

- What changed
- Why it satisfies the request
- What was intentionally not done
- Optional next step suggestions

## Examples

- Good: includes what changed, why it satisfies request, and fresh build/status evidence.
- Anti-pattern: "Done" with no verification or explicit scope mapping.

## Red Flags

- "This is small enough to skip verification."
- "I already know this part works from earlier runs."
- Corrective action: rerun checks and provide current-session evidence.

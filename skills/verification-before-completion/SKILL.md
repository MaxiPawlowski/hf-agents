---
name: hf-verification-before-completion
description: >
  Use when implementation is about to be declared done and scope coverage, policy
  compliance, and evidence freshness still need a final check. Verify the actual requested
  scope with the narrowest relevant checks, then report any remaining gaps clearly.
autonomy: autonomous
context_budget: 8000 / 2000
max_iterations: 3
---

# Verification Before Completion

Iron law: never declare completion without fresh evidence tied to the exact scope being closed.

## Overview

Use this skill for the final verification pass before a builder or reviewer reports work complete. It is a read-only check on scope fit, required gates, and evidence freshness.

The plan doc remains the canonical record of milestone state. Runtime artifacts or prior runs can inform the check, but they do not replace current evidence, and the final verification result belongs under the last completed milestone before the plan moves to `status: complete`.

## When to Use

- Before declaring a milestone or full plan complete.
- Before reporting success on work that required tests, builds, screenshots, or other proof.
- When a reviewer or builder needs a final confidence check against the original request.

## When Not to Use

- Brainstorming or open-ended exploration with no completion claim.
- Re-running the same verification with no code or artifact changes since the last pass.

## Workflow

1. Scope-fit gate: map the original request or milestone acceptance criterion to the delivered behavior.
2. Constraint gate: confirm the workflow respected explicit limits such as no unapproved git actions, no scope expansion, and any required builder/runtime constraints.
3. Evidence gate: gather the narrowest relevant fresh evidence for the change, such as status checks, targeted tests, build output, screenshots, or artifact inspection.
4. Recording gate: make sure the final verification evidence that supports plan completion can be recorded under the last completed milestone in the plan doc.
5. Gap gate: call out anything unverified, any known trade-off, and whether it blocks completion.

## Verification

- Confirm the reported changed files match the implementation summary.
- Confirm required commands or inspections ran after the last relevant code change.
- Confirm evidence is specific to the requested scope rather than reused from an earlier state.
- Confirm the completion claim matches both the milestone acceptance criterion and any explicit user constraints.
- Confirm final verification evidence is ready to attach under the last completed milestone before any `status: complete` transition.

Choose checks that fit the change. For docs-only work, file inspection may be enough. For code changes, use the smallest command set that can actually falsify the completion claim.

## Failure Behavior

If blocked, return:

- blocked: what cannot yet be verified
- why: the missing evidence, unresolved scope gap, or policy violation
- unblock: the smallest concrete action needed to finish verification

Escalate to the user when completion depends on a trade-off or waiver that the workflow cannot decide alone.

## Integration

- Used by builders before final completion reporting.
- Consumes implementation summaries, reviewer output, and any required artifacts.
- Produces completion-ready evidence and remaining gaps for the final response and for the last completed milestone entry in the plan doc.

## Required Output

Return:

- scope_map: how the delivered work maps to the requested scope
- evidence: commands, inspections, or captures used for verification and their results
- gaps: anything still unverified or intentionally out of scope
- residual_risks: remaining risks that do not block completion, if any
- completion_decision: `ready` or `blocked`

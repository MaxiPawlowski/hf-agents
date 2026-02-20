---
name: hf-finish
description: HF: Prepare a completion decision for current branch or change set.
argument-hint: [target=current-branch]
---

## Purpose

Produce a safety-aware completion recommendation based on verification and review evidence.

Evidence schema: `@.opencode/context/project/verification-evidence-schema.md`

## Preconditions

- Verification output exists for the resolved runtime gates.
- Review expectations for resolved runtime gates are satisfied.
- Any unresolved blockers are explicitly listed before recommendations.

## Execution Contract

1. Validate readiness against toggle-required checks.
2. Summarize evidence quality and unresolved risks.
3. Present integration options:
   - keep branch for more work
   - open PR
   - merge locally
   - discard branch changes (only if explicitly requested)

Toggle gating:
- `requireVerification=true`: requires verification evidence.
- `requireCodeReview=true`: requires reviewer pass.
- when both are false: allow recommendation with explicit risk callouts.

## Required Output

- `Readiness`: ready/not-ready with gating rationale.
- `Evidence`: concise proof that required checks were satisfied.
- `Residual Risks`: unresolved risk list and impact.
- `Recommended Path`: one primary next action and one fallback.
- `Decision Signal`: `ready|not-ready`

## Failure Contract

- Never mark ready when toggle-required evidence is incomplete.
- Never propose destructive actions unless explicitly requested by the user.

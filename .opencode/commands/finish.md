---
name: hf-finish
description: Prepare a completion decision for current branch or change set.
argument-hint: [target=current-branch] [--profile=<fast|balanced|strict>]
---

## Purpose

Produce a safety-aware completion recommendation based on verification and review evidence.

Policy source of truth: `@.opencode/context/project/policy-contract.md`
Evidence schema: `@.opencode/context/project/verification-evidence-schema.md`

## Preconditions

- Verification output exists for the selected mode.
- Review expectations for selected mode are satisfied.
- Any unresolved blockers are explicitly listed before recommendations.

## Execution Contract

1. Validate readiness against mode-required checks.
2. Summarize evidence quality and unresolved risks.
3. Present integration options:
   - keep branch for more work
   - open PR
   - merge locally
   - discard branch changes (only if explicitly requested)

Profile gating:
- `fast`: allows recommendation with explicit risk callouts.
- `balanced`: requires verification evidence and reviewer pass.
- `strict`: requires balanced gates plus tests/build/type checks.

## Required Output

- `Readiness`: ready/not-ready with gating rationale.
- `Evidence`: concise proof that required checks were satisfied.
- `Residual Risks`: unresolved risk list and impact.
- `Recommended Path`: one primary next action and one fallback.
- `Decision Signal`: `ready|not-ready (<profile>)`

## Failure Contract

- Never mark ready when mode-required evidence is incomplete.
- Never propose destructive actions unless explicitly requested by the user.

---
name: hf-verify
description: HF: Run toggle-aware verification for current changes with explicit evidence requirements.
argument-hint: [target=current-changes|<path>]
---

## Purpose

Assess readiness from runtime toggles and return a deterministic go/no-go decision.

Verification gates are driven by resolved `settings.toggles.*`.

Evidence schema: `@.opencode/context/project/verification-evidence-schema.md`

## Preconditions

- Verification target is defined (`current-changes` default or explicit path).
- If no changed files are present for `current-changes`, return no-go with guidance.

## Execution Contract

Toggle checks:
- baseline: scope-fit validation and risk scan.
- `requireVerification=true`: enforce `hf-verification-before-completion` expectations.
- `requireCodeReview=true`: enforce reviewer pass evidence.

Evidence rules:
- Checks requiring evidence must include concrete output or file references.
- Missing evidence for enabled required toggles is an automatic no-go.
- Missing evidence for disabled optional toggles is allowed only with explicit risk disclosure.
- Output must use the shared verification evidence schema.

## Required Output

- `Verification Checklist`: each check with pass/fail/unknown.
- `Evidence`: command/file evidence for every required check.
- `Failures`: failing checks with remediation steps.
- `Decision`: explicit `go` or `no-go` with reason.
- `Readiness`: `ready|not-ready`

## Failure Contract

- Never emit `go` if any required check fails or evidence is missing.
- On verification failure, include minimum remediation commands and retry criteria.

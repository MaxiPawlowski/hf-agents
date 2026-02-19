---
name: hf-verify
description: Run mode-aware verification for current changes with explicit evidence requirements.
argument-hint: [target=current-changes|<path>] [--mode=<fast|balanced|strict>]
---

## Purpose

Assess readiness by policy mode and return a deterministic go/no-go decision.

## Preconditions

- Verification target is defined (`current-changes` default or explicit path).
- Policy mode is resolved from argument or project default.
- If no changed files are present for `current-changes`, return no-go with guidance.

## Execution Contract

Mode checks:
- `fast`: scope-fit validation and risk scan.
- `balanced`: `fast` checks plus `hf-verification-before-completion` expectations and reviewer pass.
- `strict`: `balanced` checks plus required test/build/typecheck evidence.

Evidence rules:
- Checks requiring evidence must include concrete output or file references.
- Missing required evidence in `balanced`/`strict` is an automatic no-go.
- In `fast`, missing optional evidence is allowed only with explicit risk disclosure.

## Required Output

- `Verification Checklist`: each check with pass/fail/unknown.
- `Evidence`: command/file evidence for every required check.
- `Failures`: failing checks with remediation steps.
- `Decision`: explicit `go` or `no-go` with reason.

## Failure Contract

- Never emit `go` if any required check fails or evidence is missing.
- On verification failure, include minimum remediation commands and retry criteria.

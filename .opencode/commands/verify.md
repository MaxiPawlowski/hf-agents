---
name: hf-verify
description: Run profile-aware verification for current changes with explicit evidence requirements.
argument-hint: [target=current-changes|<path>] [--profile=<fast|balanced|strict>]
---

## Purpose

Assess readiness by profile and return a deterministic go/no-go decision.

Policy source of truth: `@.opencode/context/project/policy-contract.md`
Evidence schema: `@.opencode/context/project/verification-evidence-schema.md`

## Preconditions

- Verification target is defined (`current-changes` default or explicit path).
- Profile is resolved from argument or project default.
- If no changed files are present for `current-changes`, return no-go with guidance.

## Execution Contract

Profile checks:
- `fast`: scope-fit validation and risk scan.
- `balanced`: `fast` checks plus `hf-verification-before-completion` expectations and reviewer pass.
- `strict`: `balanced` checks plus required test/build/typecheck evidence.

Evidence rules:
- Checks requiring evidence must include concrete output or file references.
- Missing required evidence in `balanced`/`strict` is an automatic no-go.
- In `fast`, missing optional evidence is allowed only with explicit risk disclosure.
- Output must use the shared verification evidence schema.

## Required Output

- `Verification Checklist`: each check with pass/fail/unknown.
- `Evidence`: command/file evidence for every required check.
- `Failures`: failing checks with remediation steps.
- `Decision`: explicit `go` or `no-go` with reason.
- `Readiness`: `ready|not-ready (<profile>)`

## Failure Contract

- Never emit `go` if any required check fails or evidence is missing.
- On verification failure, include minimum remediation commands and retry criteria.

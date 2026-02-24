<!--
id: verification-evidence-schema
owner: team
updated: 2026-02-19
-->

# Verification Evidence Schema

Use this compact structure in `hf-verify` and `hf-finish`.

## Required fields

- `check`: short check name.
- `required`: `yes|no|if:<condition>`.
- `status`: `pass|fail|unknown`.
- `evidence`: command output snippet or file path.
- `notes`: optional risk or follow-up.

## Table format

| check | required | status | evidence | notes |
| --- | --- | --- | --- | --- |
| scope-fit | yes | pass | reviewer: pass-1 | - |
| reviewer-quality | if: requireCodeReview=true | pass | reviewer: pass-2 | - |
| tests | if: requireTests=true | pass | `npm test` exit 0 | 124 tests |
| build | if: user-requested | pass | `npm run build` exit 0 | - |
| typecheck | if: user-requested | pass | `npm run typecheck` exit 0 | - |

## Decision rule

- `go` only when all required checks are `pass`.
- Any required `fail|unknown` => `no-go` with remediation.

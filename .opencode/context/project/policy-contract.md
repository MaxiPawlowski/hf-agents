<!--
id: policy-contract
owner: team
updated: 2026-02-19
-->

# Policy Contract

Single source of truth for runtime policy, routing thresholds, and completion output.

## Safety defaults

- No implicit git operations.
- No implicit worktree creation.
- No mandatory tests unless profile or user requires them.

## Runtime profiles

- `fast`: speed-first, bounded verification, explicit risks.
- `balanced`: explicit verification evidence and reviewer signoff.
- `strict`: balanced gates plus test/build/typecheck evidence.

## Profile gates

- `fast`: scope-fit + risk scan; missing non-critical evidence allowed with risk disclosure.
- `balanced`: `fast` gates + reviewer pass + required evidence.
- `strict`: `balanced` gates + tests/build/typecheck evidence.

## TaskManager routing thresholds

Route through TaskManager when any threshold is met:

- 4+ files expected to change.
- 3+ dependency-linked stages (for example, schema -> API -> UI).
- 2+ independent streams that can run in parallel.
- External integration plus internal refactor in the same request.

If none are met, use direct `TaskPlanner -> Coder -> Reviewer`.

## Context-bundle handoff

When delegating to subagents, provide one shared context bundle using:

- `@.opencode/context/project/subagent-handoff-template.md`

## Verification evidence schema

Use this required schema for `verify` and `finish` outputs:

- `@.opencode/context/project/verification-evidence-schema.md`

## Completion readiness signal

Return one status line at end of orchestration output:

- `Readiness: ready|not-ready (<profile>)`

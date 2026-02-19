<!--
id: external-inspirations
owner: team
updated: 2026-02-19
-->

# External Inspirations

This project borrows proven workflow ideas from:

- `obra/superpowers`
- `darrenhinde/OpenAgentsControl`

## Patterns adopted in this framework

- Discovery-first routing: resolve local context before implementation.
- Thin command wrappers: keep command contracts short, move execution detail into skills.
- Dependency-aware task artifacts: use `.tmp/task-lifecycle.json` for deterministic delegation.
- Batch execution: run independent tasks in parallel, then checkpoint before next batch.
- Two-pass review: check scope/spec-fit first, then quality/risk.
- MVI context usage: load minimal context needed for the active task.

## Runtime-safe adaptations

- No implicit git operations.
- No worktree usage unless explicitly requested by the user.
- No mandatory test execution unless mode/user requires it.
- No approval-gate blocking by default in `fast` mode.

## Mode behavior mapping

- `fast`: speed-first, lightweight verification, risk callouts.
- `balanced`: explicit verification evidence plus reviewer signoff.
- `strict`: balanced gates plus required build/type/test evidence.

## Workflow profile

1. Discovery (`ContextScout` and optional `ExternalDocsScout`)
2. Planning (`TaskPlanner`, optional `TaskManager`)
3. Implementation (`Coder`)
4. Review (`Reviewer`)
5. Verification and closeout (`verify` and `finish` commands)

## Do not import directly

- Any always-on git/worktree/commit behavior
- Any always-on TDD requirement in default mode
- Any always-on approval gates for simple tasks

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
- No mandatory test execution unless toggles/user require it.
- No approval-gate blocking by default.

## Runtime behavior mapping

- Keep execution speed-first and scope-focused by default.
- Increase verification and review requirements only when toggles enable those gates.

## Workflow pattern

1. Discovery (`ContextScout` and optional `ExternalDocsScout`)
2. Planning (`TaskPlanner`, optional `TaskManager`)
3. Implementation (`Coder`)
4. Review (`Reviewer`)
5. Verification and closeout (`verify` and `finish` commands)

## Do not import directly

- Any always-on git/worktree/commit behavior
- Any always-on TDD requirement in default settings
- Any always-on approval gates for simple tasks

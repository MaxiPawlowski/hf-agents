<!--
id: runtime-preferences
owner: team
updated: 2026-02-19
-->

# Runtime Preferences

This project is OpenCode-configured and markdown-first.

## Non-negotiable defaults

- Do not use worktrees unless explicitly requested by the user.
- Do not manage git unless explicitly requested by the user.
- Do not force test execution; manual validation is the default.
- Do not use approval-gate blocking as default workflow.

Canonical runtime policy lives in:

- `@.opencode/context/project/policy-contract.md`

## Preferred execution style

- Fast autonomous delegation
- Minimal overhead
- Clear summaries of what changed
- Profile-aware quality gates (`fast`, `balanced`, `strict`)
- Dependency-aware task artifacts for complex work

## Baseline skill set

Prefer these markdown skills for normal operation:

- hf-brainstorming
- hf-subagent-driven-development
- hf-systematic-debugging
- hf-verification-before-completion
- hf-dispatching-parallel-agents
- hf-bounded-parallel-scouting

Use `hf-test-driven-development` only when explicitly requested or strict profile requires it.

## Profile intent

- `fast`: prioritize velocity, minimal context, lightweight verification
- `balanced`: require verification and explicit review
- `strict`: require tests, approval-oriented flow, verification, and review

## Optional task loop (v2)

- Task lifecycle tracking is optional by default.
- Enable it for complex or long-running feature work that benefits from explicit checkpoints.
- Artifacts live in `.tmp/task-lifecycle.json`.

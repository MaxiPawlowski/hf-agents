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

## Preferred execution style

- Fast autonomous delegation
- Minimal overhead
- Clear summaries of what changed
- Mode-aware quality gates (`fast`, `balanced`, `strict`)
- Dependency-aware task artifacts for complex work

## Baseline skill set

Prefer these markdown skills for normal operation:

- hf-brainstorming
- hf-writing-plans
- hf-subagent-driven-development
- hf-systematic-debugging
- hf-verification-before-completion
- hf-dispatching-parallel-agents

Use `hf-test-driven-development` only when explicitly requested or strict policy requires it.

## Mode intent

- `fast`: prioritize velocity, lightweight verification
- `balanced`: require verification and explicit review
- `strict`: require tests, approval-oriented flow, verification, and review

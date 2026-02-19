# Implementation Status

## What Was Missing

The first scaffold was runtime-heavy (TypeScript) and had limited OpenCode markdown configuration.

Main gaps were:
- Incomplete `.opencode/skills/` coverage
- Incomplete `.opencode/agents/` coverage
- Limited markdown-level orchestration rules

## What Was Added

### Skills

- `.opencode/skills/brainstorming/SKILL.md`
- `.opencode/skills/writing-plans/SKILL.md`
- `.opencode/skills/subagent-driven-development/SKILL.md`
- `.opencode/skills/systematic-debugging/SKILL.md`
- `.opencode/skills/verification-before-completion/SKILL.md`
- `.opencode/skills/dispatching-parallel-agents/SKILL.md`
- `.opencode/skills/test-driven-development/SKILL.md`

All skills were expanded from minimal stubs to richer operational guides with:
- Overview and intent
- Detailed process/rules
- Output formats
- Project-specific guardrails

### Subagents

- `.opencode/agents/context-scout.md`
- `.opencode/agents/external-docs-scout.md`
- `.opencode/agents/build-validator.md`
- `.opencode/agents/tester.md`

### Orchestrator and Context

- Expanded `.opencode/agents/core-agent.md` with skill and subagent routing policy.
- Expanded `.opencode/context/project/runtime-preferences.md` with baseline skill set and policy boundaries.
- Added bootstrap plugin: `.opencode/plugins/framework-bootstrap.js` to inject markdown-first defaults into system prompt.

## Current Direction

Repository is now markdown-first for OpenCode behavior and policy.
TypeScript remains as execution scaffold, but orchestration intent is primarily defined in `.opencode/**/*.md`.

## Recent Enhancements

- Added policy-mode differentiation across `fast`, `balanced`, and `strict`.
- Added OpenCode project config: `opencode.json`.
- Added plural OpenCode directories (`.opencode/agents`, `.opencode/commands`) while keeping compatibility paths.
- Added minimal context system:
  - `.opencode/context/navigation.md`
  - `.opencode/context/core/standards/*`
  - `.opencode/context/project-intelligence/technical-domain.md`
- Added lifecycle skills:
- `hf-executing-plans`
- `hf-requesting-code-review`
- `hf-receiving-code-review`
- `hf-finishing-a-development-branch`
- `hf-using-git-worktrees`
- Added `hf-task-management` skill and router script for task artifact operations.
- Extended orchestration runtime with dependency-aware task bundle generation in `src/tasks/task-bundle.ts`.

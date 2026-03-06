<!-- Context: project-intelligence/technical-domain | Priority: critical | Version: 1.1 | Updated: 2026-03-01 -->

# Technical Domain

## Stack

- Runtime: Node.js + TypeScript
- CLI: Commander
- Validation: Zod
- Config: YAML + markdown-first `.opencode` definitions

## Agentic architecture pattern

- Primary orchestrator routes to specialized subagents.
- Core coding path uses `ContextScout -> TaskPlanner -> Coder -> Reviewer`.
- Complex features route via `ContextScout -> TaskPlanner -> TaskManager -> Coder -> Reviewer`.
- Complex features can generate optional lifecycle task artifacts in `.tmp/task-lifecycle.json` before implementation.

## Naming and file patterns

- Keep orchestration code in `src/orchestrator/`, `src/router/`, `src/skills/`.
- Keep contract schemas in `src/contracts/`.
- Keep context and behavior policies in `.opencode/context/` and `.opencode/skills/`.

## Security and safety baseline

- No automatic worktrees or git management unless explicitly requested.
- Avoid destructive shell commands by default.
- Verification and review gates are controlled by runtime toggles.

## Codebase references

- `src/orchestrator/core-agent.ts`
- `src/tasks/task-bundle.ts`
- `src/subagents/context-scout.ts`
- `src/skills/skill-engine.ts`
- `.opencode/agents/hf-core-agent.md`
- `.opencode/context/project/runtime-preferences.md`

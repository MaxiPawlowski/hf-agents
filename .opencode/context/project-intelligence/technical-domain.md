<!-- Context: project-intelligence/technical-domain | Priority: critical | Version: 1.2 | Updated: 2026-03-06 -->

# Technical Domain

## Stack

- Runtime: Node.js (validation and install scripts only)
- Config: Markdown-first `.opencode` definitions

## Agentic architecture pattern

- Mode-based agent selection: choose planner-light/deep or builder-light/deep.
- Planner agents produce milestone-based plan docs in `docs/plans/`.
- Builder agents execute milestones from plan docs, optionally with coder→reviewer loop.

## Naming and file patterns

- Keep context and behavior policies in `.opencode/context/` and `.opencode/skills/`.
- Keep agent contracts in `.opencode/agents/`.
- Keep command contracts in `.opencode/commands/`.

## Security and safety baseline

- No automatic worktrees or git management unless explicitly requested.
- Avoid destructive shell commands by default.
- Review gates are controlled by agent mode selection (light vs. deep).

## Codebase references

- `.opencode/agents/`: all agent contracts
- `.opencode/skills/`: all skill contracts
- `.opencode/context/project/runtime-preferences.md`
- `.opencode/registry.json`

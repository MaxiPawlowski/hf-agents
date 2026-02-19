# Custom Agentic Framework

A markdown-first OpenCode framework that combines:
- OAC-style orchestration, governance, and context discipline
- Superpowers-style skill workflows and delegation patterns

The system is designed for fast autonomous execution with mode-aware quality gates and clear operational contracts.

## What This Includes

- Multi-agent orchestration (`TaskPlanner -> Coder -> Reviewer`) with TaskManager escalation for complex work
- Contract-driven commands in `.opencode/commands/`
- Skill library in `.opencode/skills/`
- Context system with navigation and project standards in `.opencode/context/`
- Asset governance via `.opencode/registry.json` (paths + dependencies)
- Safe install/update script with collision policies (`skip|overwrite|backup|cancel`)
- Context reference convention validation (`@.opencode/context/...`)
- Transcript/token eval harness for command-agent runs
- Prompt variant scaffolding for the core agent
- Cross-platform hook wrapper scaffolding (Windows/macOS/Linux)

## Runtime Defaults

- No worktrees unless explicitly requested
- No automatic git management unless explicitly requested
- No mandatory tests by default (manual validation acceptable)
- No approval-gate blocking by default

Policy modes:
- `fast`: speed-first, lightweight verification
- `balanced`: verification + explicit review
- `strict`: tests/build/type checks + verification + explicit review

## Project Layout

- Agents: `.opencode/agents/`
- Commands: `.opencode/commands/`
- Skills: `.opencode/skills/`
- Context: `.opencode/context/`
- Prompt variants: `.opencode/prompts/`
- Registry: `.opencode/registry.json`
- Hooks: `hooks/hooks.json`, `scripts/hooks/`
- Validation scripts: `scripts/validation/`
- Installer: `scripts/install/install-opencode-assets.mjs`
- Evals: `evals/command-agent/`

## Quick Start

```bash
npm install
npm run build
npm run test
```

Check framework runtime profile:

```bash
node dist/cli/index.js doctor
```

## CLI Commands

- `framework agents`
- `framework skills`
- `framework policy --mode fast`
- `framework run --intent "implement feature" --mode fast`
- `framework task-bundle --intent "implement feature"`
- `framework doctor`

## Validation and Operations

Run full asset validation:

```bash
npm run validate:assets
```

Individual validators:

- `npm run validate:registry`
- `npm run validate:deps`
- `npm run validate:context-refs`

Safe install/update with collision handling:

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --dry-run
```

Transcript token analysis:

```bash
npm run eval:transcript
```

## Command Set

Current command contracts in `.opencode/commands/`:

- `setup`
- `help`
- `plan-feature`
- `run-core-delegation`
- `write-plan`
- `execute-plan`
- `verify`
- `finish`
- `add-context`
- `status`
- `cleanup`

## Core Skills

- `hf-brainstorming`
- `hf-writing-plans`
- `hf-subagent-driven-development`
- `hf-systematic-debugging`
- `hf-verification-before-completion`
- `hf-dispatching-parallel-agents`
- `hf-test-driven-development` (optional by default)
- `hf-executing-plans`
- `hf-requesting-code-review`
- `hf-receiving-code-review`
- `hf-finishing-a-development-branch`
- `hf-using-git-worktrees` (opt-in)
- `hf-task-management`
- `hf-core-delegation`

## Documentation

- Architecture: `docs/architecture.md`
- Architecture contracts: `docs/architecture-contracts.md`
- Install and validation ops: `docs/install-and-validation.md`
- Portability matrix: `docs/portability-matrix.md`
- Command docs: `docs/commands/README.md`

## Notes

- This repo is markdown-first: behavior should primarily be authored in `.opencode/**/*.md`.
- TypeScript runtime/CLI provides a thin execution and validation scaffold around those markdown contracts.

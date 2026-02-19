# Custom Agentic Framework

A markdown-first OpenCode framework that combines:
- OAC-style orchestration, governance, and context discipline
- Superpowers-style skill workflows and delegation patterns

The system is designed for fast autonomous execution with settings-driven quality gates and clear operational contracts.

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

Canonical runtime policy contract:
- `.opencode/context/project/policy-contract.md`

Settings profiles:
- `light`: speed-first, minimal context, lightweight verification
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
npm run test  # optional unless mode/user requires tests
```

Use runtime settings API:

```bash
npm run build
```

Diagnostics run through `generateDiagnosticsReport()` and can be formatted with `formatDiagnosticsReport()`.

## Library API

This project now ships as a library-first runtime.

- `runTask(task, settings)`
- `resolveRuntimeSettings(overrides)`
- `loadRuntimeSettings(path?)`
- `generateDiagnosticsReport(repoRoot?)`
- `formatDiagnosticsReport(report)`

## Validation and Operations

Run full asset validation:

```bash
npm run validate:assets
```

Individual validators:

- `npm run validate:registry`
- `npm run validate:deps`
- `npm run validate:context-refs`
- `npm run validate:command-contracts`

Task lifecycle helpers are exposed in `src/tasks/task-lifecycle.ts`.

Safe install/update with collision handling:

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --dry-run
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --open-env
```

Installer notes:

- Seeds `<target>/.env` with Tavily placeholders if the file does not exist.
- Use `--open-env` to open `<target>/.env` in your default editor after install.
- Default mode is `symlink` (linked install).
- Use `--mode copy` if you want standalone copied files instead.

Superpowers-style global install flow:

```bash
git clone <your-repo-url> ~/.config/opencode/hybrid-framework
cd ~/.config/opencode/hybrid-framework
node scripts/install/install-opencode-assets.mjs --target ~/.config/opencode --mode symlink --collision backup --open-env
```

Uninstall from a target:

```bash
node scripts/install/uninstall-opencode-assets.mjs --target ~/.config/opencode --dry-run
node scripts/install/uninstall-opencode-assets.mjs --target ~/.config/opencode
```

## Command Set

Current command contracts in `.opencode/commands/`:

- `setup`
- `help`
- `brainstorm`
- `plan-feature`
- `run-core-delegation`
- `verify`
- `finish`
- `add-context`
- `status`
- `cleanup`

## Core Skills

- `hf-brainstorming`
- `hf-subagent-driven-development`
- `hf-systematic-debugging`
- `hf-verification-before-completion`
- `hf-dispatching-parallel-agents`
- `hf-bounded-parallel-scouting`
- `hf-test-driven-development` (optional by default)
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
- TypeScript runtime provides a thin execution and validation scaffold around those markdown contracts.
- Delegation routing is category-based when settings `delegationProfiles` is present, with deterministic heuristic fallback when no valid profile match is available.
- Hook runtime appends markdown-first context notes, output truncation summaries, and resume-stage continuation reminders.
- Hook runtime is config-driven (`settings.hookRuntime`) with per-hook enable/disable and settings.

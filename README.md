# Hybrid Framework

Markdown-first orchestration framework with a TypeScript runtime for unattended planner-reviewer and builder loop control.

- plan with `hf-planner`
- review plans with `hf-plan-reviewer`
- build with `hf-builder`
- run unattended loop control with the shipped runtime in `src/`

Everything else exists to support those flows.

## Quick Start

### Working in this repository

Use the repo root as the canonical source of truth:

- prompt assets live in `agents/`, `subagents/`, and `skills/`
- runtime and schemas live in `src/` and `schemas/`
- adapters in `.opencode/` and `.claude/` are thin entrypoints that point back to root assets

### Installing into a consumer project

```bash
npm install hybrid-framework
npm exec hf-setup --command init
```

Use `--platform claude` or `--platform opencode` when a project only needs one adapter. Run `npm exec hf-setup` without flags to launch the interactive wizard.

## Canonical Layout

```text
agents/       Main orchestrators
subagents/    Worker roles used by the orchestrators
skills/       Reusable workflow procedures
plans/        Planner outputs; runtime sidecars at plans/runtime/<slug>/
vault/        Optional markdown context layer; plan notes at vault/plans/<slug>/, shared notes at vault/shared/
schemas/      Runtime event and outcome contracts
src/          Runtime, CLI, and adapter implementations
.opencode/    OpenCode adapter (points to root assets)
.claude/      Claude adapter (hooks + local settings)
```

No `.codex/` directory is shipped in this repo.

## Framework Overview

| Surface | Role |
|---|---|
| `hf-planner` | Expands a request into explicit milestones and prepares a draft plan for review |
| `hf-plan-reviewer` | Reviews draft plans for coverage and builder-readiness before execution starts |
| `hf-builder` | Executes exactly one approved milestone at a time |
| `hf-reviewer` | Verifies milestone output, evaluates evidence, and routes the next action |

Builders emit the canonical `turn_outcome:` trailer as the final block of their response, and adapters ingest only that final fenced block.

## Vault

The vault is an optional markdown context layer under `vault/`.
Agents may author and update it, while the runtime only reads it and never depends on it for correctness.
Use `vault/plans/<slug>/` for plan-specific notes and `vault/shared/` for durable cross-plan context.
The runtime automatically injects semantically relevant vault chunks into each resume prompt; agents can also call the `hf_search` tool to issue targeted queries on demand when the auto-injected context is insufficient. `hf_search` is available cross-platform as an OpenCode plugin tool and as a Claude Code MCP tool, with an optional `source` filter (`"vault" | "code" | "all"`).
See `docs/vault.md` for layout, authoring rules, semantic indexing, and testing details.

## Detailed Docs

- Developer architecture guide: `docs/architecture.md`
- Consumer install and lifecycle contract: `docs/consumer-install.md`
- Vault semantic index and authoring rules: `docs/vault.md`
- Claude end-to-end testing contract: `docs/claude-e2e-contract.md`

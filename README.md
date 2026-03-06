# Hybrid Framework

A markdown-first, contract-driven orchestration framework for [OpenCode](https://opencode.ai) that routes AI agent tasks through mode-based agent selection with explicit execution contracts.

## What It Does

The framework sits between you and OpenCode's AI agents. Instead of sending tasks directly to a single model, it breaks them into stages — planning and building — and routes each stage to a specialized subagent. You choose the execution mode by selecting the agent: light (fast, no review gate) or deep (coder→reviewer loop with verification).

In short: every task follows a defined path, every gate is explicit, and every outcome is verifiable.

## How It Works

### Execution Modes

Four primary agents cover the two main workflows:

| Agent | Role |
|---|---|
| `hf-planner-light` | Fast planning — local context scout only |
| `hf-planner-deep` | Thorough planning — brainstorm + 3-scout parallel research |
| `hf-builder-light` | Fast build — single coder pass per milestone |
| `hf-builder-deep` | Quality build — coder→reviewer loop + verification before completion |

Mode is selected by choosing an agent — no toggles, no runtime state.

### Skills and Commands

The framework ships 13 **skills** (reusable workflow procedures — debugging, TDD, parallel scouting, git workflows, etc.) and 11 **commands** (one-shot invocations like `/verify`, `/plan-feature`, `/finish`). All are declared in `.opencode/registry.json` with explicit dependency edges, validated by the scripts in `scripts/validation/`.

### Contract Model

Every agent, command, and skill is a markdown file with a YAML frontmatter contract. Contracts declare: purpose, preconditions, execution steps, required output, and failure behavior. This makes the system auditable — you can read any `.opencode/` file and know exactly what it will do.

## Quick Start

```bash
npm install
npm run validate
```

### Install into OpenCode

```bash
# Dry run against a local target
npm run install:opencode:dry -- --target .opencode.local --collision backup

# Install globally into your OpenCode config directory
npm run install:opencode:global -- --collision backup
```

### Validate Assets

```bash
npm run validate
```

This lints all registry references, command/agent/skill contracts, and context module paths.

## Repository Layout

```
.opencode/            Framework assets (agents, commands, skills, context)
scripts/              Validation and install utilities
docs/                 Architecture and policy documentation
```

## Documentation

- Architecture overview: `docs/architecture.md`
- Contract definitions: `docs/architecture-contracts.md`
- Command catalog: `docs/commands/README.md`
- Install and validation guide: `docs/install-and-validation.md`

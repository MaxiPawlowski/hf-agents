# Hybrid Framework

A markdown-first, contract-driven orchestration framework for [OpenCode](https://opencode.ai) that routes AI agent tasks through structured delegation chains with configurable runtime gates.

## What It Does

The framework sits between you and OpenCode's AI agents. Instead of sending tasks directly to a single model, it breaks them into stages — context gathering, planning, implementation, and review — and routes each stage to a specialized subagent. Behavior at each stage is governed by toggles that you can flip on or off per project.

In short: every task follows a defined path, every gate is explicit, and every outcome is verifiable.

## How It Works

### Delegation Chain

When you give the framework a task, the core orchestrator agent (`hf-core-agent`) determines a routing category (e.g. feature, bugfix, planning) and dispatches work through a chain of specialized subagents:

```
ContextScout → TaskPlanner → [TaskManager?] → Coder → Reviewer
```

- **ContextScout** gathers relevant files and constraints before any code is written.
- **TaskPlanner** produces a scoped execution plan with explicit steps and risks.
- **TaskManager** (for complex features) generates a dependency-aware subtask bundle tracked in `.tmp/task-lifecycle.json`.
- **Coder** implements changes within the plan's constraints.
- **Reviewer** validates scope fit and quality before the task is considered complete.

### Runtime Toggles

Seven toggles in `settings/framework-settings.json` control which gates are active:

| Toggle | Effect |
|---|---|
| `useWorktreesByDefault` | Auto-creates isolated git worktrees for feature work |
| `manageGitByDefault` | Enables automatic git branching and commit workflows |
| `requireTests` | Blocks completion until tests pass |
| `requireApprovalGates` | Requires explicit sign-off at approval checkpoints |
| `requireVerification` | Enforces pre-completion verification evidence |
| `requireCodeReview` | Invokes the Reviewer agent before marking work done |
| `enableTaskArtifacts` | Tracks subtask state in a lifecycle artifact file |

If installed globally into OpenCode, `/toggle-*` commands let you switch these on or off from the chat interface. The plugin (`framework-bootstrap.js`) intercepts those commands and persists the changes to `settings/framework-settings.json`.

### Skills and Commands

Beyond the delegation chain, the framework ships 13 **skills** (reusable workflow procedures — debugging, TDD, parallel scouting, git workflows, etc.) and 16 **commands** (one-shot invocations like `/verify`, `/plan-feature`, `/finish`). All are declared in `.opencode/registry.json` with explicit dependency edges, validated by the scripts in `scripts/validation/`.

### Markdown Interpolation

Agent, command, and skill files are plain markdown, but they can embed template tokens that the plugin resolves at runtime — before the model ever sees the prompt. This means toggle state is expressed directly in the prompt layer, not in branching TypeScript logic.

Supported tokens:

| Token | Resolves to |
|---|---|
| `{{toggle.key}}` | `ON` or `OFF` |
| `{{rule.key}}` | The rule's enforcement text when the toggle is ON, empty when OFF |
| `{{#if toggle.key}}...{{else}}...{{/if}}` | Conditional block inclusion |
| `{{#unless toggle.key}}...{{/unless}}` | Inverse conditional |
| `{{skill.name}}` | Full inline expansion of a skill file (recursively processed) |

The consequence is that there is one canonical file per asset. Flipping a toggle immediately changes what the model sees in the next request — no file edits, no branching copies. The plugin also injects per-agent gate behavior into the system prompt based on active toggles, so each subagent automatically knows its constraints without those constraints being hardcoded into the agent's own file.

Post-resolution, the engine cleans up any blank list items or extra newlines left behind when a conditional block evaluates to empty, so the model receives a clean, well-formed prompt regardless of which toggles are on.

### Contract Model

Every agent, command, and skill is a markdown file with a YAML frontmatter contract. Contracts declare: purpose, preconditions, execution steps, required output, and failure behavior. This makes the system auditable — you can read any `.opencode/` file and know exactly what it will do.

## Quick Start

```bash
npm install
npm run build
npm run test
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
src/                  TypeScript runtime (orchestrator, router, settings, hooks, diagnostics)
.opencode/            Framework assets (agents, commands, skills, context, plugins)
settings/             Runtime toggle configuration
scripts/              Validation and install utilities
tests/                Test suite
docs/                 Architecture and policy documentation
evals/                Delegation scenario tests
```

## Documentation

- Architecture overview: `docs/architecture.md`
- Contract definitions: `docs/architecture-contracts.md`
- Toggle defaults and precedence: `docs/policies.md`
- Command catalog: `docs/commands/README.md`
- Install and validation guide: `docs/install-and-validation.md`

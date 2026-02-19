# Architecture Contracts

This project now enforces a layered framework contract inspired by OAC and Superpowers.

## Layer 1: Tools and Scripts

Atomic operations with deterministic output:

- `scripts/validation/validate-registry.mjs`
- `scripts/validation/check-dependencies.mjs`
- `scripts/validation/validate-context-refs.mjs`
- `scripts/validation/lint-command-contracts.mjs`
- `scripts/install/install-opencode-assets.mjs`
- `evals/command-agent/transcript-token-harness.mjs`

## Layer 2: Subagents

Reusable specialists under `.opencode/agents/`.

Core chain:
1. `task-planner`
2. `coder`
3. `reviewer`

## Layer 3: Commands

Contract-driven markdown commands under `.opencode/commands/`.

Each command must include:
- Purpose
- Preconditions
- Execution Contract
- Required Output
- Failure Contract

## Layer 4: Main Orchestration

The primary orchestrator is `hf-core-agent`, with mode-aware behavior controlled by policy files.

## Typed Runtime Contracts

The framework enforces typed contracts in `src/contracts/index.ts` for:

- Diagnostics report output (`DiagnosticsReport`, `DiagnosticsItem`)
- Markdown command contract lint findings (`MarkdownContractLintResult`)
- Task lifecycle persistence (`TaskLifecycleStore`, `TaskLifecycleState`)
- Delegation category profiles (`DelegationCategoryProfiles`)
- Hook runtime context/result structures (`HookRuntimeContext`, `HookRuntimeResult`)
- Hook registry/config structures (`HookRuntimeConfig`, `HookSettings`)
- Background job queue contracts (`BackgroundTaskStore`, `BackgroundTaskJob`)
- MCP integration contracts (`McpIntegrations`, `McpProviderId`)

These contracts are used by CLI operations (`framework doctor`, `framework task-status`, `framework task-resume`) and routing/lifecycle internals.

## Asset Governance Contracts

### Registry Contract

- Source of truth: `.opencode/registry.json`
- Every asset has `id`, `type`, `path`, and `dependsOn`
- Registry references must resolve to real files

### Dependency Contract

- No missing dependency IDs
- No circular dependency chains
- Validation command must pass before distribution

### Context Reference Contract

When using `@` context references in markdown, use:

`@.opencode/context/path/to/file.md`

This keeps references transformable for local/global installation.

### Command Markdown Contract

Every markdown command in `.opencode/commands/*.md` must contain:

- YAML frontmatter
- `## Purpose`
- `## Preconditions`
- `## Execution Contract`
- `## Required Output`
- `## Failure Contract`

Validation command:

`npm run validate:command-contracts`

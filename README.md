# Custom Agentic Framework

Markdown-first OpenCode framework for toggle-aware orchestration, delegation, and governance.

## What It Provides

- Multi-agent orchestration with a core execution chain: `TaskPlanner -> Coder -> Reviewer`
- TaskManager escalation path for complex feature work
- Contract-driven command files in `.opencode/commands/`
- Skill catalog and gating hooks in `.opencode/skills/`
- Runtime settings resolution with toggle precedence: built-in defaults < `settings.toggles`
- Diagnostics and validation utilities for registry, command contracts, and artifact drift

## Runtime Gates

Primary toggles:

- `useWorktreesByDefault`
- `manageGitByDefault`
- `requireTests`
- `requireApprovalGates`
- `requireVerification`
- `requireCodeReview`
- `enableTaskArtifacts`

Toggle mappings:

- Git/worktree toggles -> `hf-git-workflows`
- `requireTests` -> `hf-testing-gate`
- Approval/verification/review toggles -> `hf-approval-gates`
- `requireVerification` -> `hf-verification-before-completion`
- `enableTaskArtifacts` -> `hf-task-artifact-gate`

## Quick Start

```bash
npm install
npm run build
npm run test
```

## Public API

- `runTask(task, settings)`
- `resolveRuntimeSettings(overrides)`
- `loadRuntimeSettings(path?)`
- `generateDiagnosticsReport(repoRoot?)`
- `formatDiagnosticsReport(report)`

## Common Operations

```bash
# Validate assets and contracts
npm run validate:assets

# Linked install into another target directory
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --dry-run

# Uninstall from target
node scripts/install/uninstall-opencode-assets.mjs --target .opencode.local --dry-run
```

## Repository Layout

- Runtime source: `src/`
- Tests: `tests/`
- Framework assets: `.opencode/`
- Validation scripts: `scripts/validation/`
- Install scripts: `scripts/install/`
- Hook wrappers: `scripts/hooks/` and `hooks/hooks.json`
- Evals: `evals/delegation/`

## Documentation

- Start here: `docs/README.md`
- Architecture: `docs/architecture.md`
- Runtime and asset contracts: `docs/architecture-contracts.md`
- Install and validation: `docs/install-and-validation.md`
- Runtime policy defaults: `docs/policies.md`
- Command catalog: `docs/commands/README.md`

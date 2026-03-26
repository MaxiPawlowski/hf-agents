# Hybrid Framework

Markdown-first orchestration framework with a TypeScript runtime for unattended planner-reviewer and builder loop control.

- plan with `hf-planner`
- review plans with `hf-plan-reviewer`
- build with `hf-builder`
- run unattended loop control with the shipped runtime in `src/`

Everything else exists to support those flows.

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

Canonical prompt assets: `agents/`, `subagents/`, `skills/`
Canonical runtime surface: `src/`, `schemas/`
Adapters: `.opencode/`, `.claude/` - thin entrypoints that point back to root assets

No `.codex/` directory is shipped in this repo.

## Agents

| Agent | Role |
|---|---|
| `hf-planner` | Local-context-first planning that expands the request into explicit milestones and prepares a draft plan for review |
| `hf-builder` | Milestone execution with coder, reviewer, and final verification gates |

## Subagents

| Subagent | Role |
|---|---|
| `hf-coder` | Implements a single milestone scope with targeted, convention-aligned changes |
| `hf-plan-reviewer` | Reviews draft plans for user-intent coverage, exhaustive enumeration, and builder-readiness before execution starts |
| `hf-reviewer` | Acts as a technical tester for milestones: verifies scope fit, evaluates evidence, runs or inspects narrow checks, and routes the next action to the correct actor |

## Workflow

1. `hf-planner` explores local context and writes a draft plan with `status: planning`.
2. The runtime loop keeps `hf-planner` and `hf-plan-reviewer` in the planning phase until the plan is approved.
3. Approved plans move to `status: in-progress`.
4. `hf-builder` executes exactly one unchecked milestone at a time.
5. `hf-reviewer` reviews milestone output as a technical tester and gathers or evaluates evidence before approval.
6. Final verification runs before the plan can move to `status: complete`.

Canonical plan rules:

- Plans carry a `## User Intent` section near the top.
- Plans are fully enumerated with ordinary milestones only.
- Broad prompts such as “review all files and apply X” should expand into explicit milestones instead of milestone-internal loop syntax.

## Skills

User-facing skills:

| Skill | When it runs |
|---|---|
| `hf-plan-synthesis` | Milestone plan generation during planning passes |
| `hf-local-context` | Targeted repository discovery during planning |
| `hf-milestone-tracking` | Plan progress updates during build turns |
| `hf-verification-before-completion` | Final evidence checks before a plan is declared complete |
| `hf-vault-bootstrap` | Conversational project-context capture that seeds `vault/shared/` and optional `vault/plans/<slug>/` starter notes |

Internal evaluation assets may exist under `skills/` and are not part of the supported operator surface.

## Runtime

Builders emit the canonical `turn_outcome:` trailer as the final block of their response:

````text
turn_outcome:
```json
{
  "state": "progress",
  "summary": "Brief milestone-scoped outcome.",
  "files_changed": [],
  "tests_run": [],
  "next_action": "Describe the next smallest step."
}
```
````

Adapters only ingest the final fenced `turn_outcome:` block.

The runtime owns pause and escalation thresholds. Planners, reviewers, and builders should react to runtime state rather than inventing local retry counters.
Turn closure is persisted as canonical `turn_outcome.*` events rather than duplicate raw stop/idle lifecycle entries.

Sidecars at `plans/runtime/<slug>/`:

| File | Contents |
|---|---|
| `status.json` | Current runtime phase, loop state, and counters |
| `events.jsonl` | Append-only event log |
| `resume-prompt.txt` | Injected at next session start |

Vault context at `vault/`:

| Path | Purpose |
|---|---|
| `vault/plans/<slug>/context.md` | Active-plan discoveries, constraints, and cross-cutting notes that do not belong in milestone metadata |
| `vault/plans/<slug>/discoveries.md` | Execution-time findings, blocker resolutions, and implementation notes that may matter across milestones |
| `vault/plans/<slug>/decisions.md` | In-flight plan-specific decisions and rationale |
| `vault/plans/<slug>/references.md` | Short references, commands, and pointers worth preserving for the active plan |
| `vault/shared/architecture.md` | Durable architecture notes reusable across plans |
| `vault/shared/patterns.md` | Established implementation patterns and conventions |
| `vault/shared/decisions.md` | Cross-plan decisions and lessons learned |

Vault rules:

- The plan doc remains the executable contract: milestones, acceptance, evidence, and completion state stay in `plans/`.
- Runtime state remains in `plans/runtime/<slug>/`; the runtime never depends on `vault/` for correctness.
- `vault/` is optional. When it is absent, execution and prompt generation continue exactly as before.
- Agents create and update vault content; the runtime only reads it and never auto-creates vault directories.
- `hf-vault-bootstrap` is the packaged skill for first-pass vault authoring; it gathers kickoff context through dialogue and writes only approved vault files.
- Keep shared vault content lightweight and durable. Put task-specific notes under `vault/plans/<slug>/`.
- Vault content is embedded locally using `@huggingface/transformers` (`all-MiniLM-L6-v2`) and retrieved semantically by current milestone description. When the index is unavailable, the runtime falls back to brute-force character-budget inclusion.

### Vault Semantic Index

The runtime builds and maintains a local vector index at `.hf/` in the repo root:

| File | Contents |
|---|---|
| `.hf/index.json` | Item metadata, file hashes, and schema version |
| `.hf/index.bin` | Raw binary `Float32Array` of 384-dim normalized vectors |

Index lifecycle:

- Built by `buildUnifiedIndex()` in `src/runtime/unified-index-pipeline.ts`.
- Scans vault markdown and optional TypeScript source roots.
- Computes SHA-256 hashes per file; only changed or added files are re-chunked and re-embedded.
- Removed files are purged automatically; unchanged files keep their vectors.
- Embedding is batched in groups of 100 texts via `embedBatch()` in `src/runtime/vault-embeddings.ts`.
- `warmupEmbeddingModel()` starts model loading early (during session hydrate) so the model is warm before the first query.

Chunking strategy:

| Source | Split boundary | Merge threshold |
|---|---|---|
| Vault markdown | `##` and `###` headers | Sections with < 20 body chars are merged with the next section |
| TypeScript source | Export and top-level declaration boundaries | Chunks with < 20 chars are merged with the next chunk |

Each chunk carries `sourcePath`, `sectionTitle`, `documentTitle`, and `kind` (`vault` or `code`) as metadata.

Querying supports MongoDB-style metadata filters:

```typescript
// Return only vault chunks
queryItems(index, vectors, queryVector, topK, { kind: { $eq: "vault" } });

// Return chunks from a specific source or tagged runtime
queryItems(index, vectors, queryVector, topK, {
  $or: [{ sourcePath: "vault/shared/architecture.md" }, { tag: { $in: ["runtime"] } }],
});
```

Supported filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`.

See `docs/vault.md` for the full technical reference and testing strategy.

Counters:

- `loop_attempts` - every stop/idle that reaches the hard limit check
- `evaluated_outcomes` - validated `TurnOutcome` payloads the runtime successfully ingested

A stop/idle without a trailer still consumes a loop attempt; the next resume prompt calls that out explicitly.

`status: planning` means the runtime is still looping between `hf-planner` and `hf-plan-reviewer`.
`status: in-progress` means planning is approved and `hf-builder` may execute milestones.
`status: complete` is reserved for plans where every milestone is checked and fresh final verification evidence has been attached under the last completed milestone.

## Claude Hooks

Config in `.claude/settings.example.json`. Handler: `dist/src/bin/hf-claude-hook.js`.

| Event | Matcher | Behavior |
|---|---|---|
| `SessionStart` | `startup\|resume\|clear\|compact` | Records event; injects `resume_prompt` as `additionalContext` |
| `UserPromptSubmit` | `*` | Records event; injects `resume_prompt` as `additionalContext` |
| `PreToolUse` | `Bash` | Denies `git reset --hard`, `git checkout --`, `rm -rf` |
| `PreCompact` | `-` | Archives context snapshot; injects `resume_prompt` as `additionalContext` |
| `Stop` | `-` | Ingests `turn_outcome`; maps all runtime decisions explicitly and blocks only when continuing |
| `SubagentStart` | `-` | Records subagent start |
| `SubagentStop` | `-` | Records subagent completion or failure |

## OpenCode Hooks

Plugin: `HybridRuntimePlugin` exported from `dist/src/opencode/plugin.js`, loaded via the generated `.opencode/plugins/hybrid-runtime.js`.

| Event | Behavior |
|---|---|
| `tool.execute.before` | Records event; blocks destructive commands |
| `session.created` | Records event; returns `resume_prompt` as `additionalContext` |
| `session.status` | Returns runtime status without appending event noise |
| `session.compacted` | Archives context snapshot; returns `resume_prompt` as `additionalContext` |
| `session.idle` | Canonical end-of-turn ingestion point; applies the same runtime decision surface as Claude and auto-continues when enabled |
| `subagent.started` | Records subagent start |
| `subagent.completed` | Records subagent completion or failure |

## Consumer Install Contract

This repo serves two different audiences:

- Package maintainers work in this repository and edit the canonical framework assets at the repo root.
- Consumer projects install the package, run explicit lifecycle commands, and treat generated adapter folders as managed output.

Package installation and project initialization are separate steps.

1. Install the package into a target project: `npm install <package-name-or-tarball>`
2. Run an explicit lifecycle command from the target project:
   - `npm exec hf-install -- --target-dir .`
   - `npm exec hf-init -- --target-dir .`
   - `npm exec hf-sync -- --target-dir .`
   - `npm exec hf-uninstall -- --target-dir .`

`postinstall` still runs after `npm install`, but it is informational only in consumer projects. It does not wire adapters, scaffold folders, or remove anything implicitly. Its job is to point operators at the explicit lifecycle commands.

### Consumer Quick Start

Use this flow inside the target project that will consume the framework:

```bash
npm install hybrid-framework
npm pkg set scripts.hf:init="hf-init --target-dir ."
npm run hf:init
```

That sequence keeps installation explicit:

- `npm install` adds the package only.
- `npm run hf:init` scaffolds `plans/` and `vault/`, then wires the enabled adapters.
- Later reruns use `npm run hf:init`, `npm exec hf-sync -- --target-dir .`, or local wrapper scripts instead of relying on package-manager side effects.

Consumer projects can also keep the full lifecycle as local scripts:

```json
{
  "scripts": {
    "hf:install": "hf-install --target-dir .",
    "hf:init": "hf-init --target-dir .",
    "hf:sync": "hf-sync --target-dir .",
    "hf:uninstall": "hf-uninstall --target-dir ."
  }
}
```

Lifecycle command contract:

| Command | Scope | Inputs | Outputs |
|---|---|---|---|
| `hf-install` | Wire selected adapters into an existing project without creating framework folders by default | `--target-dir`, `--tool`, `--config`, `--platform`, `--skip-build` | merged Claude hooks, generated `.opencode/plugins/hybrid-runtime.js`, generated `.opencode/registry.json`, generated adapter-local metadata |
| `hf-init` | Initialize a project for first use, scaffold the framework workspace, then run install wiring | `--target-dir`, `--tool`, `--config`, `--platform`, `--skip-build` | everything from install plus `plans/`, `plans/evidence/`, `plans/runtime/`, `vault/`, `vault/plans/`, `vault/shared/`, `vault/templates/`, copied starter docs, and empty-dir markers where needed |
| `hf-sync` | Refresh generated adapter surfaces from canonical package assets | `--target-dir`, `--tool`, `--config` | updated generated `.claude/` and `.opencode/` surfaces, copied or linked markdown assets per config |
| `hf-uninstall` | Remove generated framework artifacts without relying on package-manager side effects | `--target-dir`, `--tool`, `--config` | removed generated adapters/assets, reversed generated hook/plugin wiring, preserved unrelated user-owned settings |

Ownership rules:

- `hf-init` copies `plans/README.md`, `vault/README.md`, `vault/templates/*`, and starter `vault/shared/*.md` files into the target project as editable local content; reruns keep existing edits and only fill in missing files.
- `hf-install` and `hf-sync` keep `.claude/` and `.opencode/` as generated adapter mirrors derived from the package's canonical assets.
- `hf-uninstall` removes generated adapter artifacts tracked in `.hybrid-framework/generated-state.json` and preserves project-local scaffold content under `plans/` and `vault/`.

## Target Project Config

Consumer config lives at `hybrid-framework.json` in the target project root unless `--config <path>` is passed.

```json
{
  "adapters": {
    "claude": {
      "enabled": true
    },
    "opencode": {
      "enabled": true
    }
  },
  "scaffold": {
    "plans": true,
    "vault": true
  },
  "assets": {
    "mode": "references",
    "claude": {
      "copy": []
    },
    "opencode": {
      "copy": [],
      "syncGenerated": true
    }
  }
}
```

Config rules:

- `adapters.*.enabled` selects which adapter surfaces are managed; when no config exists, both `claude` and `opencode` default to enabled.
- `scaffold.plans` and `scaffold.vault` control whether `hf-init` creates framework folders such as `plans/`, `plans/evidence/`, `plans/runtime/`, `vault/`, `vault/plans/`, and `vault/shared/`; `hf-install` and `hf-sync` leave scaffolding off by default.
- When scaffolding is enabled, `hf-init` also copies editable starter docs into those folders and seeds `vault/shared/` from `vault/templates/` without overwriting existing project files.
- `assets.mode` decides how adapter-local surfaces are materialized: `references` keeps repo-root markdown assets canonical, `copy` generates editable local copies, and `symlink` links when the environment allows it.
- `assets.claude.copy` and `assets.opencode.copy` list canonical markdown asset paths that should be copied into generated `.claude/` or `.opencode/` surfaces for the consumer project.
- `assets.opencode.syncGenerated` preserves today's generated `.opencode/agents/` and `.opencode/skills/` sync behavior when enabled.

Safe defaults with no config file:

- `hf-install` wires Claude and OpenCode only.
- `hf-init` creates the recommended `plans/` and `vault/` scaffold, copies starter docs/templates, and then wires Claude and OpenCode.
- `hf-sync` refreshes generated adapter surfaces but does not move the canonical markdown source of truth out of the package root.
- `hf-uninstall` is expected to remove only generated framework artifacts and leave unrelated user-authored config alone.

Repo-root markdown assets remain canonical. Generated `.claude/` and `.opencode/` surfaces in consumer projects are adapter-local copies, references, or links derived from those root assets.

## Consumer Project Flow

The end-to-end consumer flow after package installation is:

1. Install the package with `npm install`.
2. Initialize the project once with `hf-init` to scaffold local docs and wire adapters.
3. Customize `hybrid-framework.json` when the project wants different adapters, scaffold defaults, or asset sync behavior.
4. Run `hf-sync` after config changes or package upgrades to refresh generated `.claude/` and `.opencode/` output.
5. Use the generated `plans/` and `vault/` content as editable project-local workflow docs.
6. Run `hf-uninstall` when removing the framework so generated adapter artifacts are cleaned up intentionally.

### Generated Target Layout

After `hf-init -- --target-dir .`, a consumer project typically contains:

```text
.
|- hybrid-framework.json        Consumer-owned framework config
|- plans/
|  |- README.md                 Editable local guidance copied from the package
|  |- evidence/
|  `- runtime/
|- vault/
|  |- README.md                 Editable local guidance copied from the package
|  |- plans/
|  |- shared/
|  `- templates/
|- .claude/
|  |- README.md                 Generated adapter guidance
|  `- settings.local.json       Managed hook wiring merged with user settings
`- .opencode/
   |- README.md                 Generated adapter guidance
   |- plugins/hybrid-runtime.js Managed plugin loader
   |- registry.json             Managed asset registry
   |- agents/                   Generated when OpenCode asset sync is enabled
   `- skills/                   Generated when OpenCode asset sync is enabled
```

The package-maintainer view in this repository is different:

- Root `agents/`, `subagents/`, `skills/`, `src/`, and `schemas/` stay canonical here.
- Consumer projects should not edit generated `.claude/` or `.opencode/` files by hand unless they intentionally stop managing them.
- Consumer projects should edit `hybrid-framework.json`, `plans/`, and `vault/` instead of patching package internals.

### Install vs Init vs Sync vs Uninstall

- `hf-install` wires adapters into an existing project without creating the full planning scaffold.
- `hf-init` is the first-run command for most consumer projects because it creates `plans/` and `vault/` and then performs install wiring.
- `hf-sync` re-generates adapter-local surfaces from the package's canonical assets after config or package changes.
- `hf-uninstall` removes only generated framework artifacts tracked by the package lifecycle metadata and preserves consumer-owned planning docs.

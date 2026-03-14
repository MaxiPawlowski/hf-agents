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
- Keep shared vault content lightweight and durable. Put task-specific notes under `vault/plans/<slug>/`.
- Vault content is embedded locally using `@huggingface/transformers` (`all-MiniLM-L6-v2`) and retrieved semantically by current milestone description. When the index is unavailable, the runtime falls back to brute-force character-budget inclusion.

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

## Install

Install as a package into a target project:

- `npm install <package-path-or-tarball>`

The package `postinstall` hook wires Claude and OpenCode into the consumer project automatically when `npm install` runs from a directory with a `package.json`.

Build and wire the runtime manually in this repo or an explicit target directory:

- Linux: `./scripts/install-runtime.sh --tool all`
- Windows: `.\scripts\install-runtime.ps1 --tool all`

Tool-specific installs:

- Claude only: `--tool claude`
- OpenCode only: `--tool opencode`

What the installers do:

- run `npm install` and `npm run build` unless `--skip-build` is passed
- support `--target-dir <path>` to install hooks and OpenCode assets into another project root
- merge Claude hook groups from `.claude/settings.example.json` into `.claude/settings.local.json` without replacing unrelated local settings
- write the generated OpenCode local plugin loader at `.opencode/plugins/hybrid-runtime.js`
- write `.opencode/registry.json` plus local `.opencode/package.json` metadata for the target project
- run `scripts/sync-opencode-assets.mjs` when installing the OpenCode adapter so generated `.opencode/agents/` and `.opencode/skills/` stay in sync

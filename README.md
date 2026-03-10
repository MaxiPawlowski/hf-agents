# Hybrid Framework

Markdown-first orchestration framework with a TypeScript runtime for unattended loop control.

- plan with `hf-planner`
- build with `hf-builder`
- run unattended loop control with the shipped runtime in `src/`

Everything else exists to support those flows.

## Canonical Layout

```text
agents/       Main orchestrators
subagents/    Worker roles used by the orchestrators
skills/       Reusable workflow procedures
plans/        Planner outputs; runtime sidecars at plans/runtime/<slug>/
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
| `hf-planner` | Local-context-first planning with manual escalation for external research |
| `hf-builder` | Milestone execution with coder, reviewer, and final verification gates |

## Subagents

| Subagent | Role |
|---|---|
| `hf-coder` | Implements a single milestone scope with targeted, convention-aligned changes |
| `hf-reviewer` | Verifies scope fit and gate compliance, then routes the next action to the correct actor |

## Skills

| Skill | When it runs |
|---|---|
| `hf-plan-synthesis` | Milestone plan generation during planning passes |
| `hf-local-context` | Targeted repository discovery during planning |
| `hf-milestone-tracking` | Plan progress updates during build turns |
| `hf-verification-before-completion` | Final evidence checks before a plan is declared complete |

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

The runtime owns pause and escalation thresholds. Builders and reviewers should react to runtime state rather than inventing local retry counters.
Turn closure is persisted as canonical `turn_outcome.*` events rather than duplicate raw stop/idle lifecycle entries.

Sidecars at `plans/runtime/<slug>/`:

| File | Contents |
|---|---|
| `status.json` | Current loop state and counters |
| `events.jsonl` | Append-only event log |
| `resume-prompt.txt` | Injected at next session start |

Counters:

- `loop_attempts` - every stop/idle that reaches the hard limit check
- `evaluated_outcomes` - validated `TurnOutcome` payloads the runtime successfully ingested

A stop/idle without a trailer still consumes a loop attempt; the next resume prompt calls that out explicitly.

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

Build and wire the runtime locally:

- Linux: `./scripts/install-runtime.sh --tool all`
- Windows: `.\scripts\install-runtime.ps1 --tool all`

Tool-specific installs:

- Claude only: `--tool claude`
- OpenCode only: `--tool opencode`

What the installers do:

- run `npm install` and `npm run build` unless `--skip-build` is passed
- merge Claude hook groups from `.claude/settings.example.json` into `.claude/settings.local.json` without replacing unrelated local settings
- write the generated OpenCode local plugin loader at `.opencode/plugins/hybrid-runtime.js`
- run `scripts/sync-opencode-assets.mjs` when installing the OpenCode adapter so generated `.opencode/agents/` and `.opencode/skills/` stay in sync

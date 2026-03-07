# Hybrid Framework

Hybrid Framework is a markdown-first orchestration framework centered on two decisions:

- plan with `hf-planner-light` or `hf-planner-deep`
- build with `hf-builder-light` or `hf-builder-deep`

Everything else exists to support those flows.

## Canonical Layout

The root of the repo is the source of truth:

```text
agents/       Main orchestrators
subagents/    Worker roles used by the orchestrators
skills/       Reusable workflow procedures
plans/        Plan document destination
.opencode/    OpenCode adapter files
.claude/      Claude-specific notes and local settings
.codex/       Codex-specific notes and adapter instructions
```

## Main Agents

| Agent | Role |
|---|---|
| `hf-planner-light` | Fast planning from local context only |
| `hf-planner-deep` | Research-backed planning with brainstorming and parallel scouting |
| `hf-builder-light` | Fast build with a single coder pass per milestone |
| `hf-builder-deep` | Higher-rigor build with coder, reviewer, and verification gates |

## Subagents

The orchestrators delegate to six focused workers:

- `hf-local-context-scout`
- `hf-web-research-scout`
- `hf-code-search-scout`
- `hf-coder`
- `hf-reviewer`
- `hf-build-validator`

## Skills

The root `skills/` directory contains the reusable procedures that make the orchestrators work:

- `hf-brainstormer` for deep-planning research briefs
- `hf-plan-synthesis` for milestone plan generation
- `hf-local-context` for targeted repository discovery
- `hf-milestone-tracking` for plan progress updates
- `hf-verification-before-completion` for final evidence checks

Everything else that used to live under `skills/` was removed to keep orchestration policy in the agent files and avoid carrying unused workflow baggage.

## Project Context

This framework does not ship project-specific context anymore.

Each consuming project should provide its own context in its own repo, usually through:

- a root `README.md`
- local architecture or conventions docs if the project has them
- the codebase itself

The framework assumes:

- planners write milestone plans into `plans/`
- local-context discovery starts from the project README and nearby source files
- handoff requirements are written inline in the current task, plan, or milestone instead of relying on a bundled schema file
- verification evidence is reported in plain language unless the project defines a stricter format

## Tool Adapters

The tool folders are intentionally thin:

- `.opencode/` keeps an adapter registry that points at the root assets
- `.claude/` keeps Claude-specific notes and optional local settings
- `.codex/` keeps Codex-facing instructions that point back to the same root assets

Tool folders are not the framework. They only explain how a given tool should consume the framework.

## What Was Removed

This repo used to carry older playground layers, OpenCode-first install scripts, validation scripts, command packs, and historical design documents. Those are no longer the center of the project and were removed to keep the current planner/builder orchestrator model clear.

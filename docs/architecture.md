# Architecture

Related docs:
- `docs/architecture-contracts.md`
- `docs/portability-matrix.md`
- `docs/install-and-validation.md`

## Runtime Components

- `src/orchestrator`: Main task coordinator
- `src/router`: Deterministic delegation routing
- `src/registry`: Subagent registry
- `src/skills`: Skill selection and enforcement logic
- `src/context`: Context resolution and external docs adapter
- `src/policies`: Policy loading and mode handling
- `src/tasks`: Dependency-aware task artifact generation
- `src/diagnostics`: Runtime diagnostics and command contract lint integration
- `src/hooks`: Runtime hook handlers for output and resume stages
- `src/background`: Async job queue runtime with concurrency-aware dispatch
- `src/mcp`: MCP adapters for Exa search and GitHub grep workflows

## Policy Model

Policies control strictness and defaults.

- `fast`: autonomy-first
- `balanced`: verification + explicit review
- `strict`: tests + approval gates + verification + review

## Delegation Flow

1. Parse task and policy
2. Route task to a subagent (TaskManager for complex work)
3. Suggest relevant skills
4. Generate task artifacts (`task.json`, `subtask_XX`) for dependency-aware execution
5. For coding intents, execute core path: `TaskPlanner -> Coder -> Reviewer`
6. Return execution notes, safeguards, enforced skills, and delegation output

### Category-based routing

- Router accepts explicit task category or infers one from intent hints.
- If `delegationProfiles[category].preferredSubagent` exists and is registered, routing source is `profile`.
- If profile is missing/invalid, routing falls back to deterministic heuristic mapping (`source: heuristic`).
- Orchestrator surfaces `routingSource` and `matchedCategory` in its result contract.

## Diagnostics and Lifecycle CLI

- `doctor` builds diagnostics from policy parse checks, registry asset checks, command contract lint, skill artifact checks, and optional artifact presence.
- `doctor --json` returns structured diagnostics; text mode formats report and runs hook runtime output guards.
- `task-status` lists lifecycle progress for all features or one `--feature`.
- `task-resume` computes next ready subtask, supports `--mark-in-progress`, and includes resume hook notes.
- `task-next` exposes the next dependency-ready subtask.
- `task-blocked` reports blocked subtasks and recorded reasons.
- `task-complete` enforces dependency checks before marking completion.

## Hook Runtime Summary

- Context injection hook appends markdown-first execution note when absent.
- Output truncation guard clips oversized output to configured character limits and annotates notes.
- Resume continuation hook adds dependency-order reminder unless lifecycle is already completed.
- Hook behavior is controlled by `policy.hookRuntime` (global enable + per-hook settings).

## Background Runtime and MCP

- Background jobs are persisted in `.tmp/background-tasks.json` and dispatched with policy concurrency limits.
- Job types: `run-task` (orchestration execution) and `mcp-search` (research integration).
- MCP adapters currently support `tavily` and `gh-grep` providers.
- MCP results can be attached to lifecycle `researchLog` for auditability in execution workflows.

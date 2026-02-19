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
- `src/settings`: Runtime settings profiles and loading
- `src/tasks`: Dependency-aware task artifact generation
- `src/diagnostics`: Runtime diagnostics and command contract lint integration
- `src/hooks`: Runtime hook handlers for output and resume stages

## Runtime Settings Model

Settings profiles control strictness, context depth, and defaults.

- `light`: autonomy-first, minimal context
- `balanced`: verification + explicit review
- `strict`: tests + approval gates + verification + review

## Delegation Flow

1. Parse task and runtime settings
2. Route task to a subagent (TaskManager for complex work)
3. Suggest relevant skills
4. Generate/update task lifecycle artifacts in `.tmp/task-lifecycle.json` for dependency-aware execution
5. For coding intents, execute core path: `TaskPlanner -> Coder -> Reviewer`
6. Return execution notes, safeguards, enforced skills, and delegation output

### Category-based routing

- Router accepts explicit task category or infers one from intent hints.
- If `delegationProfiles[category].preferredSubagent` exists and is registered, routing source is `profile`.
- If profile is missing/invalid, routing falls back to deterministic heuristic mapping (`source: heuristic`).
- Orchestrator surfaces `routingSource` and `matchedCategory` in its result contract.

## Diagnostics and Lifecycle

- `generateDiagnosticsReport()` builds diagnostics from settings checks, registry asset checks, command contract lint, skill artifact checks, and optional artifact presence.
- `formatDiagnosticsReport()` renders a compact text report.
- Task lifecycle helpers live in `src/tasks/task-lifecycle.ts` for status, resume, next, blocked, and completion transitions.

## Hook Runtime Summary

- Context injection hook appends markdown-first execution note when absent.
- Output truncation guard clips oversized output to configured character limits and annotates notes.
- Resume continuation hook adds dependency-order reminder unless lifecycle is already completed.
- Hook behavior is controlled by `settings.hookRuntime` (global enable + per-hook settings).

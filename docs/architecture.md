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

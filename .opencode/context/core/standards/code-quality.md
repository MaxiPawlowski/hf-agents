# Code Quality Standard

## Goals

- Keep changes scoped to requested behavior.
- Prefer simple, composable, and explicit logic.
- Preserve existing project patterns unless a change is requested.

## Rules

- Minimize file churn and avoid unrelated refactors.
- Add comments only for non-obvious logic.
- Favor deterministic behavior over hidden side effects.
- Surface constraints and trade-offs in completion notes.

## Review checklist

- Scope matched request exactly
- No hidden behavior changes
- Edge cases considered
- Risks documented

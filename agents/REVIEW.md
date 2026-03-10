# Agent Prompt Review Notes

Use these checks when editing the lean-core primary agents or extending the starter agent evals.

Keep shared review notes in `agents/REVIEW.md` and colocate starter fixtures in `agents/evals/evals.json` until a single agent needs dedicated coverage.

## Covered Prompt Surface

- `agents/hf-planner.md` for local-context-first planning and manual external-research escalation.
- `agents/hf-builder.md` for milestone execution, reviewer gating, and final verification before `status: complete`.

## Regression Checks

- Planner discipline: does `hf-planner` inspect local context first and ask only the highest-impact user questions?
- Manual research boundary: does `hf-planner` call out when manual external research is needed instead of dispatching built-in web or code-search scouts?
- Builder loop discipline: does `hf-builder` still require `hf-coder` -> `hf-reviewer` before milestone completion?
- Review gating: does `hf-builder` still refuse to mark a milestone complete without reviewer approval and plan-doc evidence?
- Completion gate: does `hf-builder` still require `hf-verification-before-completion` before `status: complete`?
- Blocked behavior: does coder-blocked or reviewer-escalated work stop and surface the smallest unblock step to the user?

## Adding Coverage

Add new cases in `agents/evals/evals.json` when prompt edits change:

- local-context-first planning behavior
- manual research escalation wording
- reviewer approval-loop rules
- final verification before plan completion

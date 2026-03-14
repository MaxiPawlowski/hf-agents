# Agent Prompt Review Notes

Use these checks when editing the lean-core primary agents or extending the starter agent evals.

Keep shared review notes in `agents/REVIEW.md` and colocate starter fixtures in `agents/evals/evals.json` until a single agent needs dedicated coverage.

## Covered Prompt Surface

- `agents/hf-planner.md` for local-context-first planning and manual external-research escalation.
- `agents/hf-builder.md` for milestone execution, reviewer gating, and final verification before `status: complete`.

## Regression Checks

- Planner discipline: does `hf-planner` inspect local context first and ask only the highest-impact user questions?
- Manual research boundary: does `hf-planner` call out when manual external research is needed instead of dispatching built-in web or code-search scouts?
- Context distribution: does `hf-planner` distribute local-context findings to individual milestones as `scope`, `conventions`, and `notes` metadata?
- Review policy assignment: does `hf-planner` assign `review: required`, `auto`, or `skip` to each milestone based on complexity and risk?
- Builder review policy: does `hf-builder` respect the milestone's `review` policy — dispatching `hf-reviewer` only for `required`, self-verifying for `auto`, and skipping for `skip`?
- Review gating: does `hf-builder` still refuse to mark a `review: required` milestone complete without reviewer approval and plan-doc evidence?
- Completion gate: does `hf-builder` still require `hf-verification-before-completion` before `status: complete`?
- Blocked behavior: does coder-blocked or reviewer-escalated work stop and surface the smallest unblock step to the user?
- Context forwarding: does `hf-builder` forward enriched milestone context (`scope`, `conventions`, `notes`) to `hf-coder`?

## Adding Coverage

Add new cases in `agents/evals/evals.json` when prompt edits change:

- local-context-first planning behavior
- manual research escalation wording
- context distribution across milestones
- review policy assignment and enforcement
- reviewer approval-loop rules
- final verification before plan completion

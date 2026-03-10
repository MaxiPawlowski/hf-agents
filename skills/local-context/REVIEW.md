# Local Context Review Notes

Use these checks when editing `skills/local-context/SKILL.md` or extending the starter evals.

## What Good Looks Like

- The skill loads only the files needed to answer the active planning question.
- Outputs explain both the inspected paths and why each path changes the plan.
- Missing targets are reported explicitly instead of being silently replaced with broader exploration.

## Regression Checks

- Research-brief discipline: does the skill stay anchored to `local_search_targets`?
- Scope control: does it stop after conventions and likely landing zones are evidence-backed?
- Output quality: does it return `context_files`, `patterns_found`, `missing_context`, and a credible `stop_point`?
- Gap handling: does it report not-found targets cleanly without guessing?

## Adding Coverage

Add new cases in `skills/local-context/evals/evals.json` when prompt edits change:

- what counts as enough local context
- how missing targets should be reported
- what evidence is required before handing off to synthesis

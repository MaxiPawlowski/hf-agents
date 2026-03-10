# Plan Synthesis Review Notes

Use these checks when editing `skills/plan-synthesis/SKILL.md`, changing plan format guidance, or adding new synthesis fixtures.

## What Good Looks Like

- The skill writes the canonical plan doc only after research and user decisions are plan-ready.
- Milestones are independently executable, independently reviewable, and end in checkable acceptance criteria.
- The plan doc format stays aligned with the current planning contract and completion reporting flow.

## Regression Checks

- Gate discipline: does the prompt still block on plan-shaping unknowns instead of silently defaulting them?
- Milestone quality: would each milestone support one focused coder-reviewer loop?
- Plan format: does the output still require `status: in-progress`, `## Milestones`, and explicit acceptance criteria?
- Contract clarity: can a builder report progress or blocked state without inventing missing context?

## Adding Coverage

Add new cases in `skills/plan-synthesis/evals/evals.json` when prompt edits change:

- plan preconditions
- milestone wording rules
- canonical plan structure
- blocked behavior for missing research

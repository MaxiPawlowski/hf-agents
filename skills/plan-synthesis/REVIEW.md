# Plan Synthesis Review Notes

Use these checks when editing `skills/plan-synthesis/SKILL.md`, changing plan format guidance, or adding new synthesis fixtures.

## What Good Looks Like

- The skill writes the canonical plan doc only after research and user decisions are plan-ready.
- Milestones are independently executable, independently reviewable, and end in checkable acceptance criteria.
- The plan doc format stays aligned with the current planning contract and completion reporting flow.
- Plans are self-contained: a builder reading only the plan doc has enough context to execute without re-exploring the repo.
- Acceptance criteria are specific enough that two different reviewers would agree on pass/fail.
- The Overview explains approach rationale, not just intent — a reader understands why this path was chosen.

## Regression Checks

- Gate discipline: does the prompt still block on plan-shaping unknowns instead of silently defaulting them?
- Milestone quality: would each milestone support one focused coder-reviewer loop?
- Plan format: does the output still require `status: in-progress`, `## Milestones`, and explicit acceptance criteria?
- Contract clarity: can a builder report progress or blocked state without inventing missing context?
- Context distribution: does each milestone carry `scope` and `conventions` metadata from local-context findings, rather than leaving them only in the Research Summary?
- Review policy: does each milestone declare `review: required`, `auto`, or `skip` based on risk and complexity?
- Loop milestones: are dynamic-set milestones expressed with `loop`, `per-item`, and optionally `skill` metadata instead of enumerating items?
- Backward compatibility: do milestones without metadata lines still match the valid format?
- Plan richness: does the Overview explain approach rationale and exclusions, not just restate the intent?
- Research depth: does the Research Summary contain specific file-level findings and key decisions, not just file names?
- Milestone descriptions: does each non-trivial milestone include a description paragraph explaining what and why, beyond just the title line?
- Acceptance criteria quality: does each non-trivial milestone have testable, multi-condition acceptance criteria?
- Proportionality: does the plan scale its detail level to match complexity (richer for complex, concise for simple)?

## Adding Coverage

Add new cases in `skills/plan-synthesis/evals/evals.json` when prompt edits change:

- plan preconditions
- milestone wording rules
- canonical plan structure
- blocked behavior for missing research
- context metadata distribution across milestones
- review policy assignment rationale
- loop milestone syntax for dynamic item sets
- plan richness, overview depth, or research summary structure
- milestone description and acceptance criteria expectations
- proportionality guidance for simple vs complex plans

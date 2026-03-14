# Workflow Eval Review Notes

Use these checks when editing `skills/workflow-eval/SKILL.md` or extending the eval fixtures.

## Covered Prompt Surface

- `skills/workflow-eval/SKILL.md` for three-pass evaluation behavior, report format, and scoring.

## What Good Looks Like

- Every finding cites a specific file path, not vague commentary.
- The report covers all three passes or explicitly notes which were skipped and why.
- Recommendations are prioritized and actionable — each one points to a file and a concrete next step.
- The skill gracefully handles missing artifacts (no runtime data, missing evals) without failing the entire run.

## Regression Checks

- Pass 1 coverage: does the skill still discover all eval fixture files across skills/, agents/, and subagents/?
- Semantic matching: does the skill use judgment rather than literal substring matching for must_include checks?
- Pass 2 graceful skip: does the skill handle missing runtime artifacts without blocking the entire report?
- Pass 2 thresholds: are the flagging thresholds documented and reasonable (>5 turns/milestone, >=3 no-progress)?
- Pass 3 cross-reference: does the skill cross-reference REVIEW.md checks against eval case focus topics to find coverage gaps?
- Pass 3 undocumented behavior: does the skill flag prompt behaviors not mentioned in any REVIEW.md?
- Report format: does the output match the documented template with three numbered sections plus recommendations?
- Scoring: does overall health use the documented thresholds (all pass = good, any warn = needs attention, any fail = action required)?
- Citation discipline: does every finding cite a specific file path?
- Partial results: can the skill produce a useful report even if one pass has no inputs?

## Adding Coverage

Add new cases in `skills/workflow-eval/evals/evals.json` when prompt edits change:

- eval fixture discovery patterns
- prompt-to-eval mapping conventions
- execution metric thresholds
- cross-reference logic between REVIEW.md and evals
- report format or scoring rules
- failure and partial-result behavior

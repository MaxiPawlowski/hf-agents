# Subagent Prompt Review Notes

Use these checks when editing lean-core subagent prompts or extending the starter subagent evals.

Keep shared review notes in `subagents/REVIEW.md` and colocate starter fixtures in `subagents/evals/evals.json`.

## Covered Prompt Surface

- `subagents/hf-coder.md` for milestone-scoped implementation behavior.
- `subagents/hf-reviewer.md` for approval gating and actionable rejection behavior.
- `skills/verification-before-completion/SKILL.md` for final verification behavior without local retry thresholds.

## Regression Checks

- Scope discipline: does `hf-coder` stay inside the supplied milestone scope and report precise evidence?
- Approval gate: does `hf-reviewer` refuse approval when required evidence is missing, stale, or not specific to the reviewed change?
- Action ownership: does `hf-reviewer` return the correct `next_action_owner` for coder, builder, and user follow-ups?
- Rejection quality: when not approved, does `hf-reviewer` return one concrete next action instead of broad rewrite guidance?
- Runtime-owned thresholds: does `hf-verification-before-completion` avoid local retry or circuit-breaker counts?

## Adding Coverage

Add new cases in `subagents/evals/evals.json` when prompt edits change:

- coder scope boundaries
- reviewer approval thresholds
- reviewer next-action ownership
- rejection loop payload shape
- final verification completion behavior

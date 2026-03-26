# Subagent Prompt Review Notes

Use these checks when editing lean-core subagent prompts or extending the starter subagent evals.

Keep shared review notes in `subagents/REVIEW.md` and colocate starter fixtures in `subagents/evals/evals.json`.

## Covered Prompt Surface

- `subagents/hf-coder.md` for milestone-scoped implementation behavior.
- `subagents/hf-reviewer.md` for approval gating and actionable rejection behavior.
- `skills/verification-before-completion/SKILL.md` for final verification behavior without local retry thresholds.

## Regression Checks

- does `hf-coder` still stay inside the supplied milestone scope and report precise evidence?
- does `hf-coder` still use `scope`, `conventions`, and `notes` from enriched milestones as starting points instead of re-exploring?
- does `hf-reviewer` still refuse approval when required evidence is missing, stale, or not specific to the reviewed change?
- does `hf-reviewer` still actively run or inspect the narrowest useful checks instead of behaving like a passive code approver?
- does `hf-reviewer` still return the correct `next_action_owner` for coder, builder, and user follow-ups?
- does `hf-reviewer` still return one concrete next action instead of broad rewrite guidance when not approved?
- does `hf-verification-before-completion` still avoid local retry or circuit-breaker counts?
- does `hf-reviewer` still refuse approval without execution evidence when the milestone implies running code?
- does `hf-reviewer` still reject avoidable complexity?
- does the plan-reviewer still check verification-readiness and technical-approach proportionality?

## Adding Coverage

Add new cases in `subagents/evals/evals.json` when prompt edits change:

- coder scope boundaries
- coder use of enriched milestone context
- reviewer approval thresholds
- reviewer technical-testing behavior
- reviewer next-action ownership
- rejection loop payload shape
- final verification completion behavior
- verification evidence adequacy
- reviewer complexity rejection thresholds
- plan-reviewer verification and approach checks

# Subagent Prompt Review Notes

Use these checks when editing high-risk subagent prompts or extending the starter subagent evals.

This lightweight fixture pattern is directory-level: keep shared review notes in `subagents/REVIEW.md` and colocate starter prompt fixtures in `subagents/evals/evals.json` for the approval-loop surfaces that work together.

## Covered Prompt Surface

- `subagents/hf-reviewer.md` for approval gating and actionable rejection behavior.
- `subagents/hf-build-validator.md` for fresh readiness evidence handed back into the same loop.

## Regression Checks

- Approval gate: does `hf-reviewer` still refuse approval when required evidence is missing, stale, or not specific to the reviewed change?
- Rejection quality: when not approved, does `hf-reviewer` return one concrete next action instead of broad rewrite guidance?
- Builder-owned validator boundary: does `hf-reviewer` still treat `hf-build-validator` output as supplied evidence rather than claiming validator dispatch ownership?
- Evidence freshness: does `hf-build-validator` still return fresh commands and diagnostics that a reviewer or plan doc can cite directly?
- Minimal validation scope: does `hf-build-validator` still prefer the narrowest commands that prove readiness?

## Adding Coverage

Add new cases in `subagents/evals/evals.json` when prompt edits change:

- reviewer approval thresholds
- rejection loop payload shape
- validator freshness or command-selection rules

# Verification Before Completion Review Notes

Use these checks when editing `skills/verification-before-completion/SKILL.md` or extending its starter evals.

## What Good Looks Like

- The skill maps the delivered work back to the exact requested scope before declaring completion.
- Verification evidence is fresh, narrow, and specific to the current change.
- Completion stays blocked when required evidence is stale, missing, or cannot be recorded in the plan doc.

## Regression Checks

- Scope-fit gate: does the prompt still require an explicit scope map before a `ready` decision?
- Freshness gate: does it reject reused or pre-change evidence when the completion claim needs current proof?
- Completion gating: does it still require final verification evidence to be ready for attachment under the last completed milestone before plan completion?
- Gap reporting: when not ready, does it report concrete verification gaps and the smallest unblock step?

## Adding Coverage

Add new cases in `skills/verification-before-completion/evals/evals.json` when prompt edits change:

- what counts as fresh evidence
- when docs-only inspection is enough
- when completion must stay blocked

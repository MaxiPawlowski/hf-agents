# Vault Bootstrap Review Notes

Use these checks when editing `skills/vault-bootstrap/SKILL.md` or extending its eval fixtures.

## What Good Looks Like

- The skill runs a short, high-value conversation instead of a giant intake questionnaire.
- It maps shared context into `vault/shared/` and uses `vault/plans/<slug>/` only when a plan slug is already known.
- It protects the boundary between vault context and canonical plan logic.

## Regression Checks

- Triggering guidance: does the description clearly cover vault initialization, kickoff context capture, and project bootstrap requests?
- Scope discipline: does the skill stay limited to allowed vault files and avoid plan synthesis or runtime bookkeeping?
- Mapping quality: does it explain where architecture, patterns, decisions, and plan-specific context belong?
- Conversation quality: does it reuse already-known context and ask only the smallest missing questions?

## Adding Coverage

Add new cases in `skills/vault-bootstrap/evals/evals.json` when prompt edits change:

- how much interviewing is enough before writing
- when plan-scoped files are allowed
- how strongly the skill guards against writing milestones into vault notes

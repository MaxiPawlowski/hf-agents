# Verification Before Completion Review Notes

Use these checks when editing `skills/verification-before-completion/SKILL.md` or extending its starter evals.

## What Good Looks Like

- The skill maps the delivered work back to the exact requested scope before declaring completion.
- Verification evidence is fresh, narrow, and specific to the current change.
- Completion stays blocked when required evidence is stale, missing, or cannot be recorded in the plan doc.

## Regression Checks

- does the prompt still require an explicit scope map before a `ready` decision?
- does the prompt still reject reused or pre-change evidence when the completion claim needs current proof?
- does the prompt still require final verification evidence to be ready for attachment under the last completed milestone before plan completion?
- does the prompt still report concrete verification gaps and the smallest unblock step when not ready?
- does the prompt still enforce the verification tier taxonomy when choosing verification expectations?
- does the prompt still prohibit downgrading the required verification tier?
- does the prompt still require a completion summary before `status: complete`?
- does the prompt still require `npm run lint` to exit 0 (command-execution tier) before `completion_decision: ready`?
- does the prompt still require `npm test` to exit 0 with no failing tests (command-execution tier) before `completion_decision: ready`?
- does the prompt still require `npm run sonar` to pass (command-execution when Docker+token available, manual-attestation with user escalation when not) before `completion_decision: ready`?

## Adding Coverage

Add new cases in `skills/verification-before-completion/evals/evals.json` when prompt edits change:

- what counts as fresh evidence
- when docs-only inspection is enough
- when completion must stay blocked
- verification tier taxonomy or tier-selection rules
- completion summary expectations

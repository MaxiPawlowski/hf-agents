# Agent Prompt Review Notes

Use these checks when editing high-risk agent prompts or extending the starter agent evals.

This lightweight fixture pattern is directory-level: keep shared review notes in `agents/REVIEW.md` and colocate starter prompt fixtures in `agents/evals/evals.json` until a single agent needs enough cases to justify its own folder.

## Covered Prompt Surface

- `agents/hf-builder-deep.md` for milestone completion gating and approval-loop orchestration.

## Regression Checks

- Approval loop discipline: does `hf-builder-deep` still require `hf-coder` -> optional `hf-build-validator` -> `hf-reviewer` in that order?
- Review gating: does it still refuse to mark a milestone complete without reviewer approval and plan-doc evidence?
- Validator ownership: does the builder remain responsible for deciding when to dispatch `hf-build-validator`?
- Plan completion gate: does it still require `hf-verification-before-completion` to pass before `status: complete` is allowed?
- Blocked behavior: does coder-blocked state escalate to the user instead of silently retrying or advancing milestones?

## Adding Coverage

Add new cases in `agents/evals/evals.json` when prompt edits change:

- reviewer approval-loop rules
- validator dispatch ownership
- final verification before plan completion

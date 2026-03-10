# Milestone Tracking Review Notes

Use these checks when editing `skills/milestone-tracking/SKILL.md` or extending its starter evals.

## What Good Looks Like

- The skill keeps the plan doc as the only milestone authority.
- Milestone evidence is appended directly under the completed milestone line.
- Final verification evidence is attached under the last completed milestone before `status: complete` is set.

## Regression Checks

- Completion gating: does the skill still block `status: complete` until every milestone is checked and final verification evidence is present?
- Evidence placement: does it keep milestone and final verification evidence under the milestone entry instead of inventing a sidecar tracker?
- Current-milestone discipline: does it still target the first unchecked milestone and stop after one plan-doc update?
- Failure clarity: does malformed plan state produce one concrete unblock step instead of guessed repairs?

## Adding Coverage

Add new cases in `skills/milestone-tracking/evals/evals.json` when prompt edits change:

- when a milestone can be marked complete
- where milestone or final verification evidence must be recorded
- when `status: complete` is allowed

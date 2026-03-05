---
name: hf-milestone-tracking
description: >
  Use to read, track, and update milestone checkboxes in a plan document.
  Replaces hf-task-manager's lifecycle tracking with in-place plan doc updates.
autonomy: supervised
context_budget: 4000 / 1000
max_iterations: 1
---

# Milestone Tracking

## Iron Law

The plan doc is the single source of truth. Never track milestone state anywhere else.

## Scope

Reads the plan doc to determine build progress, and updates milestone checkboxes
in place as milestones are completed with evidence. Used by `hf-build-orchestrator`.

## Plan Doc Operations

### Reading state
- Parse `## Milestones` section
- `- [ ]` = pending, `- [x]` = complete
- First unchecked milestone = current target
- All checked = plan complete

### Marking a milestone complete
When reviewer approves with evidence, update the milestone line:
- Before: `- [ ] 2. Add validation — accept only non-empty inputs`
- After:  `- [x] 2. Add validation — accept only non-empty inputs`

### Marking plan complete
When all milestones are checked, update the frontmatter:
- Before: `status: in-progress`
- After:  `status: complete`

## Evidence Attachment

After checking off a milestone, append evidence under it:
```
- [x] 2. Add validation — accept only non-empty inputs
  - files: `src/validation.ts:12-34`
  - test: `tests/validation.test.ts` passed
  - screenshot: `docs/plans/evidence/milestone-2-screenshot.png` (if UI work)
```

## Required Output

After each milestone update, return:

- milestone_completed: number and title
- evidence_attached: list of evidence items
- next_milestone: number and title of next unchecked (or "none — plan complete")
- plan_status: in-progress | complete

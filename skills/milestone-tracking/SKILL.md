---
name: hf-milestone-tracking
description: >
  Use when a builder needs to read milestone state or record milestone completion in a plan
  doc. Treat the plan doc as the canonical progress record and append milestone evidence
  directly under the completed milestone entry, including final verification evidence under
  the last completed milestone before setting `status: complete`.
autonomy: supervised
context_budget: 4000 / 1000
max_iterations: 1
---

# Milestone Tracking

Iron law: the plan doc is the source of truth for milestone state. Runtime status files may mirror progress, but they do not override the plan doc.

## Overview

Use this skill to read the active plan, determine the next unchecked milestone, mark milestones complete, and update overall plan status when the last milestone is done.

Evidence belongs in the plan doc itself so a later builder, reviewer, or runtime loop can understand progress without hidden state.

## When to Use

- A builder needs to identify the current milestone from the plan doc.
- A milestone has been approved and its completion needs to be recorded.
- The builder needs to determine whether the full plan is now complete.

## When Not to Use

- Planning new milestones; use `hf-plan-synthesis` for that.
- Tracking progress anywhere other than the active plan doc.
- Using runtime artifacts as milestone authority.

## Plan Doc Operations

### Reading state
- Parse `## Milestones`.
- `- [ ]` means pending.
- `- [x]` means complete.
- The first unchecked milestone is the current target.

### Marking a milestone complete
1. Change the milestone checkbox from `- [ ]` to `- [x]`.
2. Append evidence as indented bullets directly under that milestone line, after any existing metadata lines (`scope`, `conventions`, `notes`, `review`).
3. If this is the last milestone, append final verification evidence in that same indented evidence block before changing plan status.
4. Keep evidence concise and reviewable.

Standard milestone example:
```md
- [x] 2. Add validation - reject empty inputs and cover the behavior with tests
  - scope: `src/validation.ts`, `tests/validation.test.ts`
  - conventions: zod schemas
  - review: auto
  - files: `src/validation.ts`, `tests/validation.test.ts`
  - verification: `npm test -- validation` passed (auto-approved)
```

### Marking the plan complete
- When every milestone is checked, first confirm the last completed milestone includes the required final verification evidence.
- Only then update frontmatter from `status: in-progress` to `status: complete`.

## Workflow

1. Read the plan doc path supplied by the active builder.
2. Identify the first unchecked milestone.
3. After approval, mark that milestone complete and append evidence under the milestone line.
4. When no unchecked milestones remain, append final verification evidence under the last completed milestone if required, then update plan status to `complete`.
5. Do not create or reconcile runtime sidecars here.

## Verification

- Confirm the milestone checkbox state matches the recorded milestone outcome.
- Confirm new evidence is attached under the completed milestone line, not in a separate tracker.
- Confirm final verification evidence, when required for plan completion, is attached under the last completed milestone line before `status: complete` is set.
- Confirm plan frontmatter moves to `status: complete` only when all milestone checkboxes are checked and that final evidence is present.

## Failure Behavior

If blocked, return:

- blocked: what could not be read or updated
- why: missing plan path, malformed milestone section, or no actionable milestone state
- unblock: the smallest format fix or path needed

## Integration

- Loaded by `hf-builder`.
- Consumes the plan doc written by `hf-plan-synthesis`.
- Records reviewer-approved evidence (`review_result:` key) in the same plan doc the runtime reads.

## Required Output

Return after each update:

- milestone_completed: number and title, or `none`
- evidence_attached: evidence items added under the milestone, or `none`
- next_milestone: next unchecked milestone, or `none - plan complete`
- plan_status: `in-progress` or `complete`

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

Iron law: The plan doc is the single source of truth. Never track milestone state anywhere else.

## Overview

Reads the plan doc to determine build progress, and updates milestone checkboxes
in place as milestones are completed with evidence. Used by `hf-builder-light` and `hf-builder-deep`.

## When to Use

- At the start of a build session to determine the current unchecked milestone.
- After a milestone's reviewer approves, to mark it complete and attach evidence.
- When checking whether all milestones are done (plan complete).

## When Not to Use

- During planning — milestones are written by `hf-plan-synthesis`, not this skill.
- For tracking state outside the plan doc — the plan doc is the only state store.

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

## Workflow

1. Read the plan doc at the path provided by the active builder agent.
2. Parse `## Milestones` section to determine current state.
3. On milestone completion: update checkbox and append evidence under the milestone line.
4. When all milestones checked: update frontmatter `status: complete`.

## Evidence Attachment

After checking off a milestone, append evidence under it:
```
- [x] 2. Add validation — accept only non-empty inputs
  - files: `src/validation.ts:12-34`
  - test: `tests/validation.test.ts` passed
  - screenshot: `plans/evidence/milestone-2-screenshot.png` (if UI work)
```

## Verification

- Run: `grep -c "\- \[ \]" <plan-doc-path>` to count remaining unchecked milestones.
- Run: `grep "status:" <plan-doc-path>` to confirm frontmatter status is updated correctly.

## Failure Behavior

If blocked, return:

- blocked: what cannot be updated
- why: plan doc not found, malformed milestones section, or no unchecked milestone
- unblock: smallest specific step (path to plan doc, or format fix needed)

## Integration

- **Loaded by:** `hf-builder-light` and `hf-builder-deep` at the start of every build session.
- **Plan doc written by:** `hf-planner-light` or `hf-planner-deep` via `hf-plan-synthesis`.
- **Milestone completion triggered by:** coder completion (builder-light) or `hf-reviewer` approval (builder-deep).

## Examples

### Correct

Build session starts. Load plan doc. Find first unchecked milestone: `- [ ] 3. Add export button`. After coder+reviewer approve with evidence, update to `- [x] 3. Add export button` with file refs and test result. This works because progress is visible in the plan doc without any external state.

### Anti-pattern

Tracking milestone state in a separate file or in memory. This fails because state is lost between sessions and diverges from the plan doc.

## Red Flags

- "I'll remember which milestone we're on without updating the doc."
- "I'll mark it done before the reviewer approves."
- "Evidence attachment is optional."

## Required Output

After each milestone update, return:

- milestone_completed: number and title
- evidence_attached: list of evidence items
- next_milestone: number and title of next unchecked (or "none — plan complete")
- plan_status: in-progress | complete

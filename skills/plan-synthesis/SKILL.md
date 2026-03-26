---
name: hf-plan-synthesis
description: >
  Use when the required research inputs are in hand and the next step is to write the
  canonical plan doc. Synthesize findings into a milestone-based plan with explicit
  acceptance criteria and language that builders can execute without guessing.
autonomy: supervised
context_budget: 14000 / 5000
max_iterations: 2
---

# Plan Synthesis

Iron law: do not write milestones from partial research or unresolved user decisions. Missing inputs create faulty milestones.

## Overview

Use this skill once the research phase is complete enough to support planning. It writes the canonical plan doc at `plans/YYYY-MM-DD-<slug>-plan.md` and makes that doc the source of truth for milestone order, acceptance criteria, and completion state.

The plan must be specific enough that a builder can execute one milestone at a time and report a precise `TurnOutcome` without inventing missing context.

## When to Use

- Required research inputs have returned and the remaining gaps are understood.
- The user-confirmed intent is stable enough to turn into milestones.
- A builder needs an executable plan doc rather than loose notes.

## When Not to Use

- Brainstorming is still in progress.
- Material design unknowns are unresolved.
- Research is missing in ways that would change milestone boundaries or acceptance criteria.

## Workflow

1. Check preconditions: intent is confirmed, major unknowns are resolved, and required research inputs are present or explicitly missing.
2. Synthesize the research into a detailed overview covering the chosen approach, why it was chosen over alternatives, key constraints, and what was explicitly excluded from scope.
3. Write the research summary with specific file-level findings, not just file names — include patterns discovered, conventions in use, dependencies that affect milestone ordering, and the key design decisions that shaped milestone boundaries.
4. Break the work into as many milestones as needed for full coverage. Each milestone must be independently executable, independently reviewable, and paired with concrete acceptance criteria.
5. For each milestone, write a description paragraph explaining what it does, why it's needed, and any design context that helps the builder and coder. Follow with multi-condition acceptance criteria for non-trivial milestones.
6. For milestones with `review: required` or `review: auto`, add a `Verify:` block describing what needs to be verified. Each step should state the verification intent clearly enough that a builder or reviewer can determine the right approach — e.g., "run the parser tests", "confirm the export exists in `src/validation.ts`", "build completes without errors". Do not write exact commands; the builder decides how to verify. `review: skip` milestones may omit `Verify:`.
7. Word milestones so the current scope is obvious, the done state is testable, and a builder can report progress or blocked status cleanly.
8. Record residual risks and open questions that remain outside milestone scope. Each risk should cite a specific file or area and name what could go wrong.

## Incremental Writing Strategy

Never write the full plan doc in a single Write tool call — large plans timeout when the LLM generates the entire document from context at once.

**Step 1 — Skeleton**: Write the plan file with frontmatter, all section headers, milestone title lines (`- [ ] N. Title - brief summary`), and placeholder text for each section. No descriptions, acceptance criteria, or metadata yet.

**Step 2 — Fill sections**: Use Edit to expand each section individually:
1. `## User Intent`
2. `## Overview`
3. `## Research Summary`
4. Each milestone's body (description, acceptance criteria, metadata) — one Edit per milestone
5. `## Risks & Open Questions`

Each Edit call is small and completes without timeout. The parser handles partial plans gracefully since it only requires `## Milestones` with checkbox lines.

## Milestone Quality Rules

- The plan doc is the canonical planning artifact. Do not rely on runtime sidecars or hidden state to make the plan intelligible.
- Each milestone should fit one focused coder-reviewer loop.
- Each milestone title line carries a brief summary: `- [ ] N. Title - brief summary`. The title line alone should make the milestone's purpose clear.
- After the title line, include a **description paragraph** (1-3 sentences) explaining what the milestone does, why it's needed, and any important design context the builder should know. This paragraph is not parsed by the runtime but is visible to the builder and coder through the raw plan text.
- After the description, include **acceptance criteria** as a labeled sub-list for non-trivial milestones. Each criterion should be independently verifiable — specific enough that two different reviewers would agree on pass/fail.
- Add a `Verify:` sub-list after `Acceptance:` for every milestone with `review: required` or `review: auto`. Each step describes the verification intent — what to check and why — so the builder or reviewer can determine the appropriate method. `review: skip` milestones may omit `Verify:`.
- Each milestone must carry enough context for the coder to start implementing without re-exploring the repo. Use indented metadata lines (`scope`, `conventions`, `notes`) to attach the planner's discoveries directly to the milestone that needs them.
- Avoid vague continuation language such as "keep wiring", "finish leftovers", or "polish" without a checkable end state.
- Milestones should not assume undocumented tool behavior or placeholder rendering.

### Proportionality

Scale detail to match complexity:

- **Complex plans** (architectural changes, multi-file refactors, new features): full description paragraphs, multi-condition acceptance criteria, detailed research summary with key decisions, at least 3 risks.
- **Simple plans** (config changes, doc edits, single-file fixes): brief descriptions are fine, single acceptance criterion is fine, but still require approach justification in the Overview and at least `scope` + `review` metadata.

### Review Policy

Each milestone may declare a `review` policy as an indented metadata line:

- `review: required` — full coder then reviewer cycle. Use for milestones with architectural changes, complex logic, or security-sensitive code. This is the default when no review policy is specified.
- `review: auto` — builder runs verification directly after the coder finishes. No reviewer dispatch. Use for straightforward changes where automated checks are sufficient.
- `review: skip` — mark complete immediately after coder output. No verification. Use only for trivial changes like documentation updates, config key additions, or comment edits.

`Verify:` blocks are required for `review: required` and `review: auto` milestones. They may be omitted for `review: skip` milestones.

### Exhaustive Enumeration

When the request implies exhaustive coverage, such as “review all files and apply X”, discover the full target set and enumerate it explicitly in the plan. Do not defer knowable work behind loop-style placeholders. If the user expects all files to be covered, the milestone list must make that coverage auditable before execution begins.

## Verification

- Confirm the plan doc exists at `plans/YYYY-MM-DD-<slug>-plan.md`.
- Confirm frontmatter includes `status: planning` until the plan reviewer approves the draft.
- Confirm the doc contains a `## User Intent` section.
- Confirm the doc contains `## Milestones` with unchecked milestone lines.
- Confirm every milestone has a clear acceptance criterion and can be completed without hidden assumptions.
- Confirm each `review: required` or `review: auto` milestone includes a `Verify:` block with at least one verification intent.
- Confirm each `Verify:` step describes what to check clearly enough that a builder can determine the right verification method.

## Failure Behavior

If blocked, return:

- blocked: what cannot be synthesized yet
- why: the missing research, unresolved decision, or conflicting constraint
- unblock: one targeted question or the specific missing research result

Do not resolve plan-shaping unknowns by silent defaulting.

## Integration

- Loaded by `hf-planner` after local exploration and any needed user clarification.
- Consumes the planner's local findings plus any user-supplied manual research.
- Produces the draft plan doc reviewed by `hf-plan-reviewer`, then used by `hf-builder` and `hf-milestone-tracking`.

## Plan Document Format

Write:

```md
---
plan: <slug>
created: YYYY-MM-DD
status: planning
---

# Plan: <Feature Name>

## User Intent
<requested outcome, explicit constraints, required breadth such as “all files”,
success criteria, and anything explicitly out of scope>

## Overview
<4-8 sentences covering: what the plan accomplishes; the chosen approach and why
it was chosen over alternatives; key constraints that shaped the approach; what was
explicitly excluded from scope and why.>

## Research Summary
- **Local context**: <specific file-level findings — patterns discovered, conventions
  in use, dependencies, edge cases — not just file names>
- **External research**: <specific findings from user-supplied docs, API refs, or
  note "none needed">
- **Key decisions**: <rationale for design choices that shaped milestone boundaries —
  which approach, which ordering, which tradeoffs>

## Milestones
- [ ] 1. <Title> - <brief summary>
  <1-3 sentence description explaining what this milestone does, why it's needed,
  and any design context that helps the builder and coder understand the intent.>
  Acceptance:
  - <first testable condition>
  - <second testable condition>
  - <third testable condition, if needed>
  Verify:
  - run the validation tests
  - confirm `src/validation.ts` exports a `validateInput` function
  - build completes without errors
  - scope: <target files from local context, with backtick-quoted paths>
  - conventions: <patterns to follow, with refs to example files>
  - notes: <additional guidance that helps the coder, optional>
  - review: required | auto | skip

- [ ] 2. <Title> - <brief summary>
  <another concrete milestone. For exhaustive file-review tasks, continue enumerating
  one explicit milestone per file until the discovered scope is fully covered.>
  Acceptance:
  - <testable condition>
  Verify:
  - <what to check — clear enough for the builder to determine the method>
  - scope: <target files from local context, with backtick-quoted paths>
  - review: required | auto | skip

## Risks & Open Questions
- <specific file or area>: <what could go wrong and what the fallback is>
- <specific file or area>: <what could go wrong and what the fallback is>
```

### Milestone metadata keys

Context keys carry planner knowledge into execution:
- `scope`: backtick-quoted file paths the coder should target. Map these from local-context findings.
- `conventions`: patterns, naming conventions, or architectural constraints to follow. Reference specific files as examples.
- `notes`: any additional guidance that saves the coder from re-exploring.

Policy keys control execution flow:
- `review`: `required` (default), `auto`, or `skip`. See Review Policy above.

Verification keys:
- `Verify:`: a labeled block at the same indentation level as `Acceptance:`. Required for `review: required` and `review: auto`; optional for `review: skip`. Each step describes the verification intent — the builder or reviewer determines the exact method.

Evidence keys are appended by the builder on completion (not written by the planner):
- `files`: paths modified during implementation.
- `verification`: command and result.
- `review_result: approved by hf-reviewer - <reason>`

Metadata lines are optional enrichments. A milestone with only the checkbox line is still valid (backward compatible). But every milestone should carry at least `scope` and `review` when the planner has the information.

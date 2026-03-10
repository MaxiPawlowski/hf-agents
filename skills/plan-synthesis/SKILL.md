---
name: hf-plan-synthesis
description: >
  Use when the required research inputs are in hand and the next step is to write the
  canonical plan doc. Synthesize findings into a milestone-based plan with explicit
  acceptance criteria and language that builders can execute without guessing.
autonomy: supervised
context_budget: 10000 / 3000
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
2. Synthesize the research into a short overview and research summary grounded in local context and any user-supplied external research when available.
3. Break the work into 3-7 milestones. Each milestone must be independently executable, independently reviewable, and paired with a concrete acceptance criterion.
4. Word milestones so the current scope is obvious, the done state is testable, and a builder can report progress or blocked status cleanly.
5. Record residual risks and open questions that remain outside milestone scope.

## Milestone Quality Rules

- The plan doc is the canonical planning artifact. Do not rely on runtime sidecars or hidden state to make the plan intelligible.
- Each milestone should fit one focused coder-reviewer loop.
- Each milestone line should carry the title plus a one-line scope and acceptance criterion.
- Avoid vague continuation language such as "keep wiring", "finish leftovers", or "polish" without a checkable end state.
- Milestones should not assume undocumented tool behavior or placeholder rendering.

## Verification

- Confirm the plan doc exists at `plans/YYYY-MM-DD-<slug>-plan.md`.
- Confirm frontmatter includes `status: in-progress`.
- Confirm the doc contains `## Milestones` with unchecked milestone lines.
- Confirm every milestone has a clear acceptance criterion and can be completed without hidden assumptions.

## Failure Behavior

If blocked, return:

- blocked: what cannot be synthesized yet
- why: the missing research, unresolved decision, or conflicting constraint
- unblock: one targeted question or the specific missing research result

Do not resolve plan-shaping unknowns by silent defaulting.

## Integration

- Loaded by `hf-planner` after local exploration and any needed user clarification.
- Consumes the planner's local findings plus any user-supplied manual research.
- Produces the plan doc used by `hf-builder` and `hf-milestone-tracking`.

## Plan Document Format

Write:

```md
---
plan: <slug>
created: YYYY-MM-DD
status: in-progress
---

# Plan: <Feature Name>

## Overview
<2-4 sentence synthesis of intent, chosen approach, and key constraints>

## Research Summary
- **Local context**: <key files, patterns, and repo conventions>
- **External research**: <user-supplied docs, specs, or note none>

## Milestones
- [ ] 1. <Title> - <one-line scope + acceptance criterion>
- [ ] 2. <Title> - <one-line scope + acceptance criterion>
- [ ] 3. <Title> - <one-line scope + acceptance criterion>

## Risks & Open Questions
- <risk or unresolved item>
```

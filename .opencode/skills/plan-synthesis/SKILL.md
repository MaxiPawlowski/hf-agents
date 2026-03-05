---
name: hf-plan-synthesis
description: >
  Use after all research scouts have returned to synthesize findings into a milestone-based
  plan document. Replaces hf-task-planner.
  Do NOT use before research is complete.
autonomy: supervised
context_budget: 10000 / 3000
max_iterations: 2
---

# Plan Synthesis

## Iron Law

Do not write milestones until all research inputs are present. Missing research means missing constraints.

## Scope

One synthesis pass per planning session. Takes brainstorm brief + local context + web
research + code examples and produces a single plan doc at
`docs/plans/YYYY-MM-DD-<slug>-plan.md`.

## Workflow

1. **Synthesis gate** — Merge all research inputs. Identify: key constraints from local
   conventions, relevant patterns from web research, applicable code examples.
2. **Milestone gate** — Break the feature into 3-7 milestones. Each milestone must be:
   - Achievable in one coder+reviewer loop
   - Independently verifiable with an explicit acceptance criterion
   - Named clearly enough to be self-explanatory
3. **Risk gate** — List residual risks and open questions not resolved by research.

## Milestone Quality Rules

- No milestone depends on another being "partially done" — each is a complete unit
- Scope fits comfortably in a single focused coding session
- Acceptance criterion is checkable without ambiguity

## Plan Document Format

Write to `docs/plans/YYYY-MM-DD-<slug>-plan.md`:

```
---
plan: <slug>
created: YYYY-MM-DD
status: in-progress
---

# Plan: <Feature Name>

## Overview
<2-4 sentence synthesis of intent, approach chosen, and key constraints>

## Research Summary
- **Local context**: <key files, patterns, conventions found>
- **Web research**: <relevant docs, tutorials, prior art>
- **Code examples**: <notable implementations found via gh_grep>

## Milestones
- [ ] 1. <Title> — <one-line scope + acceptance criterion>
- [ ] 2. <Title> — <one-line scope + acceptance criterion>
- [ ] 3. <Title> — <one-line scope + acceptance criterion>

## Risks & Open Questions
- <risk or unknown 1>
- <risk or unknown 2>
```

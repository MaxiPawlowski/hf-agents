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

Iron law: Do not write milestones until all research inputs are present. Missing research means missing constraints.

## Overview

One synthesis pass per planning session. Takes brainstorm brief + local context + web
research + code examples and produces a single plan doc at
`docs/plans/YYYY-MM-DD-<slug>-plan.md`.

## When to Use

- After all three research scouts have returned results.
- When merging multi-source research findings into a structured, actionable milestone plan.

## When Not to Use

- Before research scouts have returned — incomplete research produces incomplete milestones.
- When feature intent is still ambiguous — run `hf-brainstormer` first.

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

## Verification

- Run: `ls docs/plans/` and confirm the new plan doc is present with correct YYYY-MM-DD prefix.
- Confirm plan doc contains `## Milestones` section with at least one `- [ ]` checkbox.
- Confirm frontmatter has `status: in-progress`.

## Failure Behavior

If blocked, return:

- blocked: what cannot be synthesized
- why: missing research input or unresolvable constraint conflict
- unblock: one targeted question or the specific missing scout result

## Integration

- **Loaded by:** `hf-planner-light` (Phase 2) and `hf-planner-deep` (Phase 3).
- **Input from:** `hf-brainstormer` output + all 3 scout results (deep) or local scout only (light).
- **Output consumed by:** `hf-builder-light` and `hf-builder-deep` read the produced plan doc.

## Examples

### Correct

Three scouts return results. Synthesis merges local conventions, API docs, and idiomatic patterns. Writes plan doc with 4 milestones, each with a clear acceptance criterion. This works because every milestone is grounded in evidence from research.

### Anti-pattern

Writing milestones from memory before scouts return. This fails because local project conventions and library-specific patterns are missed, producing milestones that conflict with the codebase.

## Red Flags

- "I can guess the milestones without waiting for scouts."
- "The research brief is close enough — I'll fill in gaps during coding."
- "Acceptance criterion is implicit — it's obvious when done."

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

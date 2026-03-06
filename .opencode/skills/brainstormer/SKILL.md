---
name: hf-brainstormer
description: >
  Use at the start of a planning session to scope the feature, identify unknowns, and
  produce a research brief for the parallel scout phase.
  Do NOT use mid-plan or when intent is already explicit.
autonomy: supervised
context_budget: 8000 / 2000
max_iterations: 3
---

# Brainstormer

Iron law: Do not start research or planning until feature intent, constraints, and top unknowns are explicit.

## Overview

One brainstorming pass per planning session. Converts a feature request into a scoped
research brief that `hf-planner-deep` uses to target the parallel scout agents.
No implementation side effects. No file edits.

## When to Use

- At the start of a new planning session when the feature intent is not yet explicit.
- When multiple implementation directions are possible and the best one is unknown.
- When you need to produce a structured research brief for parallel scout agents.

## When Not to Use

- Mid-plan when intent and approach are already defined.
- When the user has provided an explicit, detailed specification.
- As a replacement for implementation — this skill produces research briefs, not code.

## Workflow

1. **Intent gate** — Restate the feature request in one sentence. Name the top 2-3
   unknowns that would materially change implementation direction.
2. **Options gate** — Generate 2-3 approach options with trade-offs. Cover: architecture
   shape, key components, data flow, risks. Name your recommended option.
3. **Research brief gate** — Produce a structured research brief that tells each scout
   exactly what to look for.

## Verification

- Run: `ls docs/plans/` to confirm no plan doc was created prematurely during brainstorm.
- Confirm research brief contains all three target lists: `local_search_targets`, `web_search_targets`, `code_search_targets`.

## Failure Behavior

If blocked, return:

- blocked: what cannot be scoped
- why: missing input
- unblock: one targeted question

## Integration

- **Loaded by:** `hf-planner-deep` in Phase 1 (inline, sequential).
- **Output consumed by:** `hf-local-context-scout`, `hf-web-research-scout`, `hf-code-search-scout` via the research brief.
- **Followed by:** Phase 2 parallel research scouts, then `hf-plan-synthesis`.

## Examples

### Correct

User asks to "add pagination to the results list." Brainstormer states intent as "add cursor-based pagination to search results," identifies unknowns (server-side vs. client-side, existing pagination patterns), proposes 2 options with trade-offs, produces a research brief with specific targets. This works because each scout now has a concrete target list.

### Anti-pattern

Immediately writing milestones without scoping. This fails because missing constraints produce milestones that conflict with existing codebase patterns.

## Red Flags

- "The intent is obvious — skip brainstorm."
- "I'll generate the plan while brainstorming at the same time."
- "I'll write milestones now and research later."

## Required Output

Return:

- intent: one sentence
- unknowns: top 2-3 decisions that must be resolved before planning
- approach_options: 2-3 options; each includes trade-offs and recommendation flag
- research_brief:
  - local_search_targets: specific file paths, pattern names, or module names to find
  - web_search_targets: specific library docs, RFCs, or tutorials to fetch
  - code_search_targets: specific patterns or implementations to find on GitHub via gh_grep

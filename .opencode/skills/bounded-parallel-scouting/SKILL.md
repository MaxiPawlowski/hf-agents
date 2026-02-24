---
name: hf-bounded-parallel-scouting
description: Use to run short parallel discovery bursts before planning.
---

# Bounded Parallel Scouting

## Overview

Run a lightweight parallel context discovery burst, then converge into one scoped plan.

This skill is optimized for speed and low overhead.

Iron law: Scout only for decision-critical signals; stop once enough evidence exists to route safely.

## When to Use

- Scope-unclear implementation requests.
- Cross-cutting tasks where context is unclear.
- External dependency questions that need both local and docs signals.

Do not use when the task is already narrowly scoped to one file or one known fix.

## When Not to Use

- Tasks where solution path is already explicit.
- Work requiring immediate coding with no discovery uncertainty.

## Burst limits

- Launch at most 3 scouting units in parallel.
- Keep each unit focused on one question.
- Stop scouting after first strong signal match per unit.
- Prefer ContextScout and ExternalDocsScout; avoid broad sweeps.

## Recommended burst pattern

1. Local standards/pattern scout (ContextScout)
2. Relevant code location scout (ContextScout)
3. External API behavior scout (ExternalDocsScout) only if needed

Then synthesize one short decision block:

- assumptions
- likely file targets
- routing decision (TaskManager vs direct path)

## Workflow

1. Question gate
   - Define up to 3 scouting questions, one per unit.
   - Exit gate: each question maps to one scout owner.
2. Burst gate
   - Run units in parallel with strict scope and stop-on-signal behavior.
   - Exit gate: each unit returns one actionable finding.
3. Convergence gate
   - Merge findings into one route decision and target file set.
   - Exit gate: next workflow is explicit.

## Guardrails

- No git operations.
- No worktree creation.
- No coding during scouting.
- Keep total scouting output compact and actionable.

## Verification

- Run: `git status --short`
- Expect: scouting produces no repository modifications.
- Run: `npm run build`
- Expect: not required unless scouting transitioned into implementation and code changed.

## Failure Behavior

- Stop burst when units exceed scope or return conflicting signals.
- Report conflict points and the single follow-up scout needed.
- Escalate to orchestrator for tie-break routing decision.

## Examples

- Good: 3 scouts, each answers one question, then one concise route decision.
- Anti-pattern: 8 concurrent scouts with overlapping questions and transcript dumps.

## Red Flags

- "Let's keep scouting just in case."
- "I launched parallel units with overlapping file edits."
- Corrective action: collapse to bounded units and reconverge before any coding.

## Integration

- Used by: `hf-core-agent`.
- Typically fans out: `hf-context-scout` and `hf-external-docs-scout`.
- Required after: convergence, hand off to `hf-task-planner`.

---
name: hf-bounded-parallel-scouting
description: Use in fast profile to run short parallel discovery bursts before planning.
---

# Bounded Parallel Scouting

## Overview

Run a lightweight parallel context discovery burst, then converge into one scoped plan.

This skill is optimized for speed and low overhead.

## When to use

- `fast` profile implementation requests.
- Cross-cutting tasks where context is unclear.
- External dependency questions that need both local and docs signals.

Do not use when the task is already narrowly scoped to one file or one known fix.

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

## Guardrails

- No git operations.
- No worktree creation.
- No coding during scouting.
- Keep total scouting output compact and actionable.

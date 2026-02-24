---
name: hf-dispatching-parallel-agents
description: Use when tasks are independent and can be executed concurrently.
---

# Dispatching Parallel Agents

## Overview

Speed up delivery by parallelizing only truly independent workstreams.

Iron law: Never parallelize tasks that can conflict on shared mutable state, shared files, or sequential data dependencies.

## When to Use

- Multiple independent work units with no overlap.
- Separate streams where each unit can be validated independently.

## When Not to Use

- Shared file edits or state-coupled logic.
- Any flow where output A is required to define output B.

## Rules

- Parallelize only tasks with no shared mutable state.
- Merge outputs through a single coordinator summary.
- If conflicts appear, switch back to sequential execution.

## Workflow

1. Partition gate
   - Define unit boundaries and conflict risk per unit.
   - Exit gate: each unit has isolated scope and owner.
2. Parallel execution gate
   - Launch units concurrently with explicit output contract.
   - Exit gate: each unit returns complete result payload.
3. Merge gate
   - Consolidate outputs and resolve conflicts centrally.
   - Exit gate: one coherent final summary with risk notes.

## Good candidates

- Separate documentation and implementation tracks
- Independent module updates
- Isolated refactors with no overlapping files

## Bad candidates

- Shared file edits
- State-coupled logic changes
- Sequenced changes where output A is input B

## Verification

- Run: `git status --short`
- Expect: resulting changes align with planned unit boundaries.
- Run: `npm run build`
- Expect: merged result remains build-clean.

## Failure Behavior

- Stop fan-out when overlap or merge conflict risk is detected.
- Report conflicting units, overlap area, and sequential fallback order.
- Escalate to orchestrator for re-partition when ambiguity remains.

## Required Output

Return:

- partition: unit -> scope-in/scope-out and owner
- conflict_risk: per-unit risk notes and why it's independent
- results: per-unit output payloads
- merge_summary: one coherent summary + any conflicts resolved

## Project Defaults

- Do not create worktrees by default.
- Do not perform git management operations unless requested.

## Examples

- Good: docs update and isolated module refactor run in parallel, then merged by coordinator.
- Anti-pattern: two agents editing same router file concurrently.

## Red Flags

- "Parallel is always faster."
- "I can merge overlap later if needed."
- Corrective action: cancel overlap streams and re-run sequentially.

## Integration

- Used by: `hf-core-agent` for parallel scouting or independent verification streams.
- Required before: `hf-core-delegation` planning/execution when parallel discovery is needed.
- Required after: `hf-verification-before-completion` if parallel execution modified code.
- Prefer pairing with: `hf-bounded-parallel-scouting` for discovery-only fan-out.

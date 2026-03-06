---
name: hf-dispatching-parallel-agents
description: >
  Use when multiple independent work units can execute concurrently with no shared mutable state.
  Do NOT use when tasks share files, state-coupled logic, or sequential data dependencies.
autonomy: supervised
context_budget: 10000 / 3000
max_iterations: 5
---

# Dispatching Parallel Agents

Iron law: Never parallelize tasks that can conflict on shared mutable state, shared files, or sequential data dependencies.

## Overview

One parallel execution cycle: partition independent units, execute concurrently, merge into one coherent result.

## When to Use

- When multiple independent work units can execute concurrently with no shared mutable state.

## When Not to Use

- When tasks share files, state-coupled logic, or sequential data dependencies.

## Scope

One parallel execution cycle: partition independent units, execute concurrently, merge into one coherent result. Concurrency model: fan-out by isolated scope boundaries, each unit has explicit output contract, single coordinator merges all results. Constraints: no worktrees by default; no git management unless requested; if conflicts appear, switch to sequential fallback. Each unit receives only its partition scope (minimal context handoff). Emit per-unit: step name, inputs, outputs, decision rationale (observable state).

## Workflow

1. **Partition gate** — Entry: multiple independent tasks identified. Define unit boundaries and conflict risk per unit. Prove independence: no shared files, no shared mutable state, no data dependency between units. Exit: each unit has isolated scope, owner, and explicit output contract.
2. **Parallel execution gate** — Entry: partition validated. Launch units concurrently. Each unit returns complete result payload per its output contract. Exit: all units returned with complete payloads.
3. **Merge gate** — Entry: all unit results received. Consolidate outputs and resolve any unexpected conflicts centrally. Exit: one coherent final summary with risk notes and per-unit results.

## Verification

- Run: `git status --short`
- Expect: resulting changes align with planned unit boundaries.
- Run: `npm run validate:assets`
- Expect: merged result passes all validators.

## Failure Behavior

- On overlap detected during partition: return `{ blocked: "shared state overlap", why: "<units A and B both touch <resource>>", unblock: "re-partition to isolate <resource> or execute sequentially" }`.
- On merge conflict: return `{ blocked: "merge conflict", why: "<conflicting outputs from units>", unblock: "cancel overlapping units, re-run sequentially in order: <fallback order>" }`.
- On unit failure: return `{ blocked: "unit failed", why: "<unit> returned <error>", unblock: "re-run <unit> individually or escalate" }`.
- On ambiguous partition: escalate to orchestrator for re-partition decision.

## Circuit Breaker

- Warning at 3 iterations (expect most work done by then).
- Hard stop at 5 — report completed and incomplete units.
- On merge conflict detected: immediately switch to sequential fallback.

## Examples

### Correct
Docs update and isolated module refactor run in parallel, then merged by coordinator with one coherent summary. This works because the units have zero file overlap, so merge is trivial and both complete faster than sequential execution.

### Anti-pattern
Two agents editing the same router file concurrently. This fails because concurrent edits to the same file produce merge conflicts that are harder to resolve than sequential execution would have been.

## Red Flags

- "Parallel is always faster."
- "I can merge overlap later if needed."

## Integration

- **Before:** partitioned task list with independence proof per unit from `hf-core-delegation` or `hf-core-agent`.
- **After:** `{ partition: [{ unit, scope_in, scope_out, owner }], conflict_risk: [per-unit notes], results: [per-unit payloads], merge_summary }`.

## Rollback

1. Revert all parallel unit file changes via `git checkout -- <files>`.
2. Discard merge summary.
3. Report which units completed vs. which need re-execution.

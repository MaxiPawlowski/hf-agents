---
name: hf-bounded-parallel-scouting
description: >
  Use when scope is unclear and a lightweight parallel discovery burst is needed before planning.
  Do NOT use when the task is already narrowly scoped to one file or one known fix, or when no discovery uncertainty exists.
autonomy: autonomous
context_budget: 8000 / 2000
max_iterations: 4
---

# Bounded Parallel Scouting

## Iron Law

Scout only for decision-critical signals; stop once enough evidence exists to route safely.

## Scope

One discovery burst answering up to 3 focused questions, converging into one routing decision. Read-only — no code modifications, no git operations, no worktree creation. Concurrency model: max 3 units in fan-out, stop-on-first-strong-signal per unit, merge at convergence. Each unit gets one question only (minimal context handoff).

## Workflow

1. **Question gate** — Entry: scope-unclear request or cross-cutting context need. Define up to 3 scouting questions, one per unit. Recommended pattern: (a) local standards/pattern scout via ContextScout, (b) relevant code location scout via ContextScout, (c) external API behavior scout via ExternalDocsScout (only if needed). Exit: each question maps to one scout owner.
2. **Burst gate** — Entry: questions defined with owners. Run units in parallel with strict scope and stop-on-signal behavior. Prefer ContextScout and ExternalDocsScout; avoid broad sweeps. Exit: each unit returns one actionable finding.
3. **Convergence gate** — Entry: all units returned. Merge findings into one route decision and target file set. Synthesize: assumptions, likely file targets, routing decision (TaskManager vs direct path). Exit: next workflow is explicit.

## Verification

- Run: `git status --short`
- Expect: scouting produces no repository modifications.

## Error Handling

- On units exceed scope: return `{ blocked: "scout scope exceeded", why: "<unit> expanded beyond its question", unblock: "narrow unit scope to original question and re-run" }`.
- On conflicting signals between units: return `{ blocked: "conflicting scout signals", why: "<unit A says X, unit B says Y>", unblock: "<single follow-up scout to resolve conflict>" }`.
- On no actionable signal from any unit: escalate to orchestrator for alternative routing or user clarification.

## Circuit Breaker

- Warning at 3 scout units dispatched.
- Hard stop at 4 — no re-scouting. Emit findings and route.
- On conflicting signals from units: stop burst and escalate to orchestrator for tie-break.

## Examples

### Correct
3 scouts, each answers one question, then one concise route decision with assumptions and file targets. This works because bounded scouting converges fast — each unit contributes exactly one signal, and the merge is deterministic.

### Anti-pattern
8 concurrent scouts with overlapping questions and transcript dumps. This fails because overlapping scouts waste tokens, produce conflicting signals, and delay convergence instead of accelerating it.

## Red Flags

- "Let's keep scouting just in case."
- "I launched parallel units with overlapping file edits."

## Handoffs

- **Before:** unresolved questions from orchestrator (max 3) via `hf-core-delegation` or `hf-core-agent`.
- **After:** `{ assumptions, file_targets[], routing_decision, per_unit_findings[] }`. Consumed by `hf-task-planner` or `hf-core-delegation` planning gate.

## Rollback

1. No side effects. Discard scout findings.
2. Return to pre-scout state — orchestrator re-routes or asks user.

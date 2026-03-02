# Skill Excellence Guide

## Core Principles

1. **Explicit trigger contract**
   - Start with concrete "Use when..." conditions and "Do NOT use when..." exclusions.
   - Diagnostic test: if a competent human can't tell which skill applies, neither can the agent.

2. **One iron law**
   - A single non-negotiable constraint. Falsifiable in under 30 seconds.
   - Place it at the top of the skill. Models lose mid-context constraints.

3. **Description quality**
   - Write as if onboarding a new hire: make formats, terminology, and resource relationships explicit.
   - Namespace with prefixes when multiple skills coexist (`db_migrate`, `db_backup`).
   - One skill = one meaningful unit of work, not a raw API wrapper.

4. **Deterministic workflow**
   - Ordered phases with entry/exit gates and escalation conditions.
   - Default pattern: **gather context → take action → verify results**.

5. **Evidence-backed completion**
   - Every success claim ties to verifiable output. No "should work."

6. **Structured error design**
   - Errors are returned results, never thrown exceptions.
   - Include: what failed, why, expected format with example, and when to escalate.

7. **Scope discipline**
   - One unit of work per invocation. No bundled speculative fixes.

8. **Autonomy level**
   - Declare tier: **gated** (human approves), **supervised** (human monitors), or **autonomous** (within guardrails).
   - Irreversible operations require confirmation regardless of tier. When in doubt, stay read-only.

9. **Context discipline**
   - Declare token budgets. Cap tool responses (e.g., 25k tokens), truncate with pointer to full source.
   - Prefer just-in-time retrieval over bulk pre-loading. Write intermediates to storage, pass pointers forward.

10. **Loop termination**
    - Hard max iteration count per invocation.
    - Dual-threshold circuit breaker: **warning** ("time to deliver") + **hard stop** (force completion/escalate).
    - Detect repetition: same action with same inputs three times → stop and report.

11. **Handoff contracts**
    - Typed and validated. Free-text handoffs are the primary context-loss vector.
    - Include: task definition, artifact paths, decisions made, current state, next steps.

12. **Runnable interface**
    - Executable commands or scripts. A skill that can't be run is a suggestion.

13. **Contrasting examples**
    - One correct pattern, one anti-pattern. Show *why* the anti-pattern fails.

14. **Drift prevention**
    - Document rationalizations that lead to skipping steps.
    - After context compaction, re-inject the iron law and scope constraints — they are silently lost otherwise.

15. **Re-verification**
    - Re-check outputs against original criteria after every fix. Never assume closure on first pass.

## Orchestration Extensions

Apply when skills are composed, parallelized, or automated.

16. **Minimal context handoff** — Pass pointers and metadata, not transcripts. Child skills assemble their own minimum viable context.

17. **Typed artifacts** — Schema-validated, backward-compatible. On validation failure, retry with the error as feedback before escalating.

18. **Concurrency model** — Define work-unit granularity, fan-out strategy, and merge behavior.

19. **Automation gates** — All safety criteria met → proceed. Otherwise → human.

20. **Rollback contracts** — Each side-effecting step has a compensating undo. On failure at step N, compensate N-1 through 1 in reverse. Treat agent output as proposal → validate → persist → execute.

21. **Collection completeness** — Pagination and exhaustiveness rules are explicit for list/API workflows.

22. **Observable state** — Emit per-item: step name, inputs, outputs, duration, decision rationale. No silent progress.

23. **Stable output paths** — Deterministic artifact locations. Generated content is preserved; enhancements append, never overwrite.

## Skill Template

```md
---
name: <skill-name>
description: >
  Use when <trigger conditions>.
  Do NOT use when <exclusions>.
autonomy: <gated | supervised | autonomous>
context_budget: <max input tokens> / <max output tokens>
max_iterations: <hard limit>
---

# <Skill Name>

## Iron Law
<Non-negotiable constraint. Falsifiable in 30 seconds.>

## Scope
<One unit of work.>

## Workflow
1. **Gather context** — Entry: <condition>. Exit: <condition>.
2. **Take action** — Entry: <condition>. Exit: <condition>.
3. **Verify results** — Entry: <condition>. Exit: <condition>.

## Verification
- Run: `<command>`
- Expect: <evidence>

## Error Handling
- On <failure>: return `<structured error with guidance>`.
- On <ambiguity>: escalate to <human | upstream skill>.

## Circuit Breaker
- Warning at <N iterations>.
- Hard stop at <N iterations>.
- On repetition: stop and report.

## Examples
### Correct
<Pattern + why it works>

### Anti-pattern
<Pattern + why it fails>

## Red Flags
- "<rationalization phrase>"
- <misapplication indicator>

## Handoffs
- Before: <upstream artifact + schema>
- After: <downstream artifact + schema>

## Rollback
- Step 1: <undo action>
- Step 2: <undo action>
```
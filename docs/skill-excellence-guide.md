# Skill Excellence Guide

## Curated Canon (Non-Negotiable)

1. **Trigger contract is explicit**
   - The description starts with concrete "Use when..." conditions.
   - It names symptoms and includes when *not* to use the skill.

2. **One core rule is unambiguous**
   - Include an iron law that blocks partial compliance and loopholes.

3. **Workflow is deterministic**
   - Ordered phases, entry/exit gates, and stop/escalation conditions are explicit.

4. **Evidence is required for claims**
   - Completion/success statements are tied to fresh verification output.

5. **Failure behavior is defined**
   - The skill states exactly when to stop, what to report, and who must decide next.

6. **Safety defaults are conservative**
   - Irreversible operations require explicit confirmation.
   - Read-only analysis boundaries are documented where relevant.

7. **Scope discipline is built in**
   - One unit of work at a time; no bundled speculative fixes.

8. **Integration and handoff contracts are explicit**
   - Required upstream/downstream skills, input artifacts, and output artifacts are named.

9. **Executable interface exists**
   - The skill includes runnable commands/scripts, not just conceptual guidance.

10. **Examples include contrast**
    - At least one good pattern and one anti-pattern are shown.

11. **Process drift is actively prevented**
    - Red flags, common rationalizations, and corrective action are documented.

12. **Review loops are mandatory when quality matters**
    - Re-check after fixes; do not assume closure after first pass.

## Curated Advanced Patterns (Automation/Orchestration)

13. **Minimal context handoff**
    - Pass pointers + metadata, not full transcript dumps.

14. **Typed artifacts with compatibility**
    - Machine-readable schemas validate structure and preserve backward compatibility.

15. **Explicit concurrency model**
    - Define work-unit granularity (e.g., 1 item = 1 worker), fan-out, and result merge behavior.

16. **Strict action gates for automation**
    - Auto-merge/release paths require all safety criteria; otherwise escalate to human.

17. **Exhaustive collection guarantees**
    - Pagination and completeness rules are explicit for list/API workflows.

18. **Observable execution state**
    - Per-item status updates stream as work completes.

19. **Stable output path conventions**
    - Artifact locations are deterministic and standardized.

20. **No-content-loss release updates**
    - Generated release content is preserved; enhancements are additive only.

## Why This Curated Set Works

- It removes duplication and separates foundational quality from advanced orchestration concerns.
- It is enforceable: each item can be checked in review or automation.
- It scales from simple single-skill docs to large multi-agent workflows.

## Curated Quality Checklist

- Trigger conditions are concrete and include exclusion criteria.
- One iron law exists and cannot be interpreted loosely.
- Workflow has deterministic phase gates and stop conditions.
- Verification evidence is required before success claims.
- Escalation and failure reporting behavior are explicit.
- Irreversible actions are confirmation-gated.
- Scope is constrained to clear units of work.
- Upstream/downstream handoffs and artifact contracts are documented.
- Runnable commands/scripts are included.
- Good vs bad examples are present.
- Red flags and anti-rationalization controls are documented.
- Re-review loops are required where correctness/quality can regress.
- (Advanced) Context handoff is minimal and role-specific.
- (Advanced) Schema validation and backward compatibility are defined.
- (Advanced) Concurrency, pagination, and state reporting are explicit.
- (Advanced) Release/merge automation has strict gates and human fallback.

## Minimal Template for a Great Skill

```md
---
name: <skill-name>
description: Use when <specific trigger conditions and symptoms>
---

# <Skill Title>

## Overview
<Core principle + one iron law>

## When to Use
- <Signals that this applies>
- <When not to use>

## Workflow
1. <Phase 1>
2. <Phase 2>
3. <Phase 3>

## Verification
- Run: <command>
- Expect: <evidence>

## Red Flags
- <rationalization phrase>
- <drift indicator>

## Integration
- Required before: <skill>
- Required after: <skill>
```

## Bottom Line

A great skill is not just informative; it is executable, enforceable, and verifiable. If it cannot reliably drive correct behavior under ambiguity, pressure, and iteration, it is not done.

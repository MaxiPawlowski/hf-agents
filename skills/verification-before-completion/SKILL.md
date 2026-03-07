---
name: hf-verification-before-completion
description: >
  Use before declaring work done to verify scope coverage, constraint compliance, and output quality.
  Do NOT use for pure brainstorming or exploration with no completion claim.
autonomy: autonomous
context_budget: 8000 / 2000
max_iterations: 3
---

# Verification Before Completion

Iron law: Never claim completion without fresh verification evidence tied to the exact requested scope.

## Overview

One verification pass for one completion claim. Read-only evidence gathering — no code changes. Verifies scope coverage, constraint compliance, and output quality before declaring work done.

## When to Use

- Before declaring any implementation task done.
- Before committing or creating a PR when the plan requires verification evidence.
- When a reviewer or gate requires fresh evidence of completion.

## When Not to Use

- For pure brainstorming or exploration with no completion claim.
- When verification has already been run in this session with no subsequent changes.

## Scope

One verification pass for one completion claim. Read-only evidence gathering — no code changes. Constraints: verify against original request, not assumptions; respect runtime toggle states.

## Workflow

1. **Scope-fit gate** — Entry: implementation claims completion. Map user request to delivered behavior. Verify: does behavior match user intent exactly? Were defaults respected (no worktrees, no auto-git, no forced tests)? Are changed files clearly documented? Are known trade-offs disclosed? Exit: all requested items are accounted for.
2. **Constraint gate** — Entry: scope-fit confirmed. Validate runtime preferences and safety defaults were respected. Exit: no policy drift remains.
3. **Evidence gate** — Entry: constraints validated. Attach fresh command outputs relevant to the change. Exit: completion claim is evidence-backed.

## Verification

- Run: `git status --short`
- Expect: changed file list matches reported implementation scope.
- Run: `npm run build`
- Expect: successful build for code-changing tasks.

## Failure Behavior

- On unresolved scope item: return `{ blocked: "scope gap", why: "<requested item> not delivered or not verified", unblock: "<implement or verify specific item>" }`.
- On constraint violation: return `{ blocked: "policy drift", why: "<constraint> was violated by <action>", unblock: "<revert or correct specific violation>" }`.
- On ambiguous trade-off: escalate to user for waiver or prioritization decision.

## Circuit Breaker

- Warning at 2 re-checks on the same gap.
- Hard stop at 3 — stop and escalate unresolved items.
- On same gap identified twice with no new evidence: stop and escalate.

## Examples

### Correct
Includes what changed, why it satisfies request, explicit scope mapping, and fresh build/status evidence. This works because the completion claim is falsifiable — anyone can verify it by re-running the commands.

### Anti-pattern
"Done" with no verification or explicit scope mapping. This fails because undetected scope gaps or constraint violations propagate downstream and become expensive to fix.

## Red Flags

- "This is small enough to skip verification."
- "I already know this part works from earlier runs."

## Integration

- **Before:** implementation summary + fresh evidence from the active builder flow, reviewer output, and `hf-build-validator` when build or type checks were required.
- **After:** `{ scope_map, evidence: { commands_run[], pass_fail[] }, gates: { toggle_gate, status }[], gaps[], residual_risks[] }`. Completion message: what changed, why it satisfies request, what was intentionally not done, optional next steps.

## Rollback

1. No side effects to revert.
2. Retract completion claim.
3. Report unresolved items with their last evidence state.

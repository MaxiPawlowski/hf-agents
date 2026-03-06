---
name: hf-core-delegation
description: >
  Use when implementing tasks that need end-to-end orchestration through discovery, planning, coding, and review with explicit review gates.
  Do NOT use when plan is already finalized and only execution remains (use hf-subagent-driven-development), or for single-file edits with no delegation benefit.
autonomy: supervised
context_budget: 15000 / 3000
max_iterations: 8
---

# Core Delegation

## Iron Law

No implementation starts until scope, constraints, and delegation chain are explicit.

## Scope

One end-to-end delegation cycle: from intent classification through review signoff for one user request. Routing: use `hf-core-delegation` for end-to-end orchestration; use `hf-subagent-driven-development` when plan is already approved. Constraints: no implicit git operations; no implicit worktree creation; no mandatory tests unless explicitly requested. Brainstorming is orchestrator-led via `hf-brainstorming` unless explicitly delegated. Use `@.opencode/context/project/subagent-handoff-template.md` for all delegation handoffs (typed artifacts). Emit per-gate: step name, inputs, outputs, decision rationale (observable state).

## Workflow

1. **Intent gate** (optional but recommended) — Entry: new user request. Use `hf-intent-scout` to classify intent/risk and select safest workflow. Exit: risk level and evidence expectations are explicit.
2. **Context gate** — Entry: intent classified or skipped. `hf-local-context-scout` identifies minimum relevant local context. Exit: constraints + candidate files are explicit.
3. **Planning gate** — Entry: context gathered. Produce a small, verifiable plan. Include review signoff in plan when quality gate is needed. Exit: scope-in/scope-out + acceptance criteria + verify steps are explicit.
4. **Execution gate** — Entry: plan approved. `hf-coder` implements scoped changes only. Exit: files touched and rationale are captured.
5. **Verification gate** (conditional) — Entry: code changes complete. Use `hf-build-validator` and/or `hf-reviewer` for verification signoff when quality gate is active. Exit: evidence is fresh and tied to requested scope.
6. **Review gate** — Entry: verification evidence collected. `hf-reviewer` validates scope-fit (pass 1: fail fast on scope drift) and gate compliance (pass 2: quality/risk/runtime fit). Exit: approved yes/no + next action.

## Verification

- Run: `npm run validate:assets`
- Expect: all validators pass.
- Run: `git status --short`
- Expect: scope of file changes matches delegation summary.

## Error Handling

- On unresolved ambiguity at any gate: return `{ blocked: "ambiguity at <gate>", why: "<specific ambiguity>", unblock: "<specific clarification needed>" }`.
- On failed review pass: return `{ blocked: "review failed", why: "<pass 1 or 2 findings>", unblock: "<re-scope or re-implement specific items>" }`.
- On scope trade-off needed: escalate to user for prioritization.
- On policy override needed: escalate to user for explicit approval.

## Circuit Breaker

- Warning at 6 iterations.
- Hard stop at 8 — report current state across all gates and escalate.
- On coder-reviewer loop cycling same finding 3 times: stop and escalate to user.

## Examples

### Correct
Context scout → planner → coder → two-pass review with gate-aware completion note and fresh evidence. This works because each gate narrows scope and builds evidence, so the final review validates a well-defined, well-evidenced change.

### Anti-pattern
Direct coding before routing decision and without review artifacts. This fails because skipping discovery and planning gates means scope is assumed, not verified, leading to unrequested changes and missing evidence.

## Red Flags

- Starting implementation before scope is explicit.
- Adding unrequested functionality.
- Running git actions without explicit instruction.

## Handoffs

- **Before:** user request (raw or via `hf-brainstorming` design brief).
- **After:** `{ plan_summary, implementation_summary: { files_changed[], rationale }, review_findings: { approved: bool, findings[], evidence_gaps[], next_action } }`. Per-role contracts: Coder → changes + files + commands + results + gaps; BuildValidator/Reviewer → commands + results + evidence + approved + findings + next_action. Pairs with `hf-git-workflows` when workspace strategy matters.

## Rollback

1. Revert coder changes via `git checkout -- <files>`.
2. Report incomplete state to orchestrator with gate-by-gate progress.

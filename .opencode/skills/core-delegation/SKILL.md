---
name: hf-core-delegation
description: >
  Use when implementing tasks that need end-to-end orchestration through discovery, planning, coding, and review with toggle-aware gates.
  Do NOT use when plan is already finalized and only execution remains (use hf-subagent-driven-development), or for single-file edits with no delegation benefit.
autonomy: supervised
context_budget: 15000 / 3000
max_iterations: 8
---

# Core Delegation

## Iron Law

No implementation starts until scope, constraints, and delegation chain are explicit.

## Scope

One end-to-end delegation cycle: from intent classification through review signoff for one user request. Routing: use `hf-core-delegation` for end-to-end orchestration; use `hf-subagent-driven-development` when plan is already approved; use `hf-bounded-parallel-scouting` for lightweight discovery bursts. Constraints: no implicit git operations; no implicit worktree creation; no mandatory tests unless toggle gates or user request require them. Brainstorming is orchestrator-led via `hf-brainstorming` unless explicitly delegated. Use `@.opencode/context/project/subagent-handoff-template.md` for all delegation handoffs (typed artifacts). Emit per-gate: step name, inputs, outputs, decision rationale (observable state).

## Workflow

1. **Intent gate** (optional but recommended) — Entry: new user request. Use `hf-intent-scout` to classify intent/risk and select safest workflow. Exit: risk level and evidence expectations are explicit.
2. **Context gate** — Entry: intent classified or skipped. `hf-context-scout` identifies minimum relevant local context. Use `hf-external-docs-scout` when external library behavior is uncertain. Exit: constraints/toggles + candidate files are explicit.
3. **Planning gate** — Entry: context gathered. `hf-task-planner` produces a small, verifiable plan. Use `hf-task-manager` when dependency-heavy. If review required by runtime policy (`require_verification`, `require_code_review`), include review signoff in plan. Exit: scope-in/scope-out + acceptance criteria + verify steps are explicit.
4. **Execution gate** — Entry: plan approved. `hf-coder` implements scoped changes only. Exit: files touched and rationale are captured.
5. **Verification gate** (conditional) — Entry: code changes complete.{{#if toggle.require_tests}} Use `hf-testing-gate` + `hf-tester` for test evidence.{{/if}}{{#if toggle.require_verification}} Use `hf-approval-gates` + `hf-build-validator` / `hf-reviewer` for verification signoff.{{/if}}{{#if toggle.task_artifacts}} Use `hf-task-artifact-gate` for lifecycle tracking.{{/if}} Exit: evidence is fresh and tied to requested scope.
6. **Review gate** — Entry: verification evidence collected. `hf-reviewer` validates scope-fit (pass 1: fail fast on scope drift) and gate compliance (pass 2: quality/risk/runtime fit). Exit: approved yes/no + next action.

## Verification

- Run: `npm run build`
- Expect: build passes after code changes.
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
- **After:** `{ plan_summary, implementation_summary: { files_changed[], rationale }, review_findings: { approved: bool, findings[], evidence_gaps[], next_action } }`. Per-role contracts: TaskPlanner → objective + scope + steps + risks; TaskManager → featureId + subtasks + dependencies; Coder → changes + files + commands + results + gaps; Tester/BuildValidator → commands + results + evidence; Reviewer → approved + findings + evidence_gaps + next_action. Pairs with `hf-git-workflows` when workspace strategy matters.{{#if toggle.task_artifacts}} Keep `.tmp/task-lifecycle.json` current.{{/if}}

## Rollback

1. Revert coder changes via `git checkout -- <files>`.
{{#if toggle.task_artifacts}}2. Remove task artifact entries for this delegation.
{{/if}}{{#if toggle.task_artifacts}}3.{{else}}2.{{/if}} Report incomplete state to orchestrator with gate-by-gate progress.

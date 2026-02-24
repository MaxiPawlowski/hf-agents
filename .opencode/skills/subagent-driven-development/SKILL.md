---
name: hf-subagent-driven-development
description: Use when executing a plan through TaskPlanner -> Coder -> Reviewer in one session.
---

# Subagent-Driven Development

## Overview

Execute implementation with focused subagent handoffs in one session and minimal orchestration overhead.

Use this only after scope and plan are explicit.

Iron law: Every delegation must preserve scope boundaries; any ambiguity returns to orchestrator before coding.

## When to Use

- Plan is approved and execution is the primary remaining work.
- Work can run through deterministic TaskPlanner -> Coder -> Reviewer chain.

## When Not to Use

- Discovery is still open-ended.
- Requirements are ambiguous in ways that change implementation materially.

## Workflow

1. Handoff gate
   - Build a minimal handoff using `@.opencode/context/project/subagent-handoff-template.md`.
   - Exit gate: objective + scope-in/scope-out + constraints + acceptance + evidence-required are explicit.
2. Planning refinement gate
   - `hf-task-planner` refines steps only (no scope expansion).
   - Exit gate: steps are deterministic and each has a verify command.
3. Implementation gate
   - `hf-coder` applies only scoped changes.
   - Exit gate: files touched + commands run + results are reported.
4. Review gate
   - `hf-reviewer` runs pass 1 (spec-fit) and pass 2 (quality/risk) for non-trivial changes.
   - Exit gate: approved yes/no with findings and next action.

Rules:

- Use the handoff template for every delegation.
- Keep one active implementation stream unless tasks are independent.
- Re-run both review passes after non-trivial fixes.
- Stop when scope is satisfied; avoid extra "nice to have" additions.

If multiple tasks are independent, batch them and use parallel delegation.

## Reviewer focus

- Confirm requested behavior is present.
- Confirm no unrequested behavior was added.
- Confirm project runtime preferences were respected.
- Return clear pass/fail with concise findings.

Pass 1 should fail fast on scope drift. Pass 2 should prioritize risk and quality issues by severity.

## Guardrails

- No worktrees unless explicitly requested.
- No automatic git actions unless explicitly requested.
- Tests are optional unless user or runtime toggle gates require them.
- Subagents do not run unsolicited brainstorming loops.

## Verification

- Run: `npm run build`
- Expect: build success after implementation.
- Run: `git status --short`
- Expect: changed files match coder and reviewer summaries.

## Escalation path

- Requirement ambiguity -> return question to orchestrator before coding.
- Brainstorming need -> return to orchestrator unless explicit delegation is provided.
- Scope conflict -> prioritize explicit user instruction.
- Missing context -> call ContextScout before proceeding.

## Failure Behavior

- Stop delegation chain on pass 1 scope failure.
- Report blocking finding and route back to Coder or orchestrator.
- Escalate to user when requirement conflict cannot be resolved from repository context.

## When to use this vs core delegation

- Use `hf-subagent-driven-development` when planning is complete and the remaining work is execution.
- Use `hf-core-delegation` when discovery, routing, and planning still need orchestration.

## Examples

- Good: approved plan, one coder pass, two reviewer passes, then concise pass/fail summary.
- Anti-pattern: skipping reviewer pass 2 after meaningful code changes.

## Red Flags

- "Plan is clear enough" without explicit handoff fields.
- "One review pass is probably enough."
- Corrective action: restore full sequence and rerun required review pass(es).

## Integration

- Used by: `hf-core-agent` when plan is already explicit.
- Required before: `hf-verification-before-completion` when making a completion claim.
- Inputs: handoff bundle fields from `@.opencode/context/project/subagent-handoff-template.md`.
- Outputs: coder patch summary + reviewer approval report.

---
name: hf-brainstorming
description: >
  Use when a request has unresolved design choices that materially change architecture, data flow, or risk profile, or when user asks for options and trade-offs before coding.
  Do NOT use when scope is already explicit and implementable, or user asks for direct implementation with no unresolved design branch.
autonomy: gated
context_budget: 12000 / 4000
max_iterations: 5
---

# Brainstorming

## Iron Law

Do not start implementation while material design choices remain unresolved.

## Scope

One brainstorming session converts one ambiguous request into one implementation-ready design brief. Orchestrator-led only — subagents do not initiate brainstorming unless explicitly delegated. Constraints: keep planning lightweight and fast; no coding side effects; no approval gates for each question; no worktrees.

## Workflow

1. **Clarification gate** — Entry: request has material ambiguity. Ask one focused question at a time (prefer multiple-choice). Keep to 3-5 questions (max 5). Focus on decisions that materially change implementation. For low-ambiguity requests, ask 0-2 confirmation questions. Stop when scope, constraints, and success criteria are explicit enough to plan safely, OR 5 questions have been asked. Before proceeding, emit a short decision log: what changed from user answers, assumptions that remain, unresolved unknowns. Exit: scope, constraints, and success criteria are explicit.
2. **Options gate** — Entry: clarification complete. Present 2-3 viable approaches with trade-offs. Cover: architecture shape, components/responsibilities, data flow/state boundaries, error handling/fallback behavior, validation strategy (manual by default; tests only when requested). Exit: one recommended option is justified.
3. **Confirmation gate** — Entry: recommendation presented. Confirm in-scope/out-of-scope boundaries with user. Exit: implementation-ready design brief is produced.
4. **Handoff gate** — Entry: design confirmed. Produce a design brief that a planner/coder can execute without guessing. Exit: objective + scope + constraints + acceptance criteria are explicit.

## Verification

- Run: `git status --short`
- Expect: no coding side effects during brainstorming-only sessions.

## Error Handling

- On 5 questions reached with scope still unclear: return `{ blocked: "clarification limit", why: "5 questions asked, scope still has <unresolved items>", unblock: "user must clarify <specific decision>" }`.
- On user selects no option: return `{ blocked: "no option selected", why: "user did not confirm an approach", unblock: "user must select one approach or provide alternative direction" }`.
- On ambiguity in constraints: escalate to user — never guess on constraints that change implementation.

## Circuit Breaker

- Warning at 3 questions asked.
- Hard stop at 5 questions — emit decision log with assumptions and proceed to recommendation.
- On same clarification question asked twice: stop and emit decision log with the assumption.

## Examples

### Correct
Three targeted questions, two alternatives with trade-offs, one recommendation, explicit scope boundaries, and a design brief that a coder can execute. This works because each question narrows the design space, and the brief eliminates guessing downstream.

### Anti-pattern
Ten broad questions and no concrete recommendation. This fails because question fatigue causes the user to disengage, and without a recommendation, the design remains unresolved.

## Red Flags

- Jumping into implementation without explicit scope.
- Presenting one option only.
- Treating constraints as optional.
- Asking a long list of questions in one message.
- Continuing clarification after scope is already explicit.

## Handoffs

- **Before:** user request with unresolved design choices.
- **After:** design brief with `{ recommended_approach, alternatives_considered, scope_in, scope_out, risks, assumptions, decision_log }`. Consumed by `hf-core-delegation` or `hf-task-planner`.

## Rollback

1. Discard design brief.
2. Return to original user request. No code or artifact side effects to revert.

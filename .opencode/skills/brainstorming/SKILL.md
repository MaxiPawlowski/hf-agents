---
name: hf-brainstorming
description: Use when a request needs design clarification before implementation.
---

# Brainstorming

## Overview

Convert rough intent into a validated design with clear scope, constraints, and success criteria.

Iron law: Do not start implementation while material design choices remain unresolved.

Orchestrator ownership: this skill is led by the primary orchestrator in direct conversation with the user.
Subagents should use this flow only when brainstorming is explicitly delegated or explicitly requested.

## When to Use

- Request ambiguity materially changes architecture, data flow, or risk profile.
- User asks for options/trade-offs before coding.

## When Not to Use

- Scope is already explicit and implementable safely.
- User asks for direct implementation with no unresolved design branch.

## Why this exists

Skipping design causes the same failures repeatedly: wrong scope, wrong assumptions, and expensive rework.
This skill keeps planning lightweight while still forcing the core decisions to be explicit.

## Workflow

1. Clarification gate
   - Ask one focused question at a time (max 5 total).
   - Exit gate: scope, constraints, and success criteria are explicit.
2. Options gate
   - Present 2-3 viable approaches with trade-offs.
   - Exit gate: one recommended option is justified.
3. Confirmation gate
   - Confirm in-scope/out-of-scope boundaries.
   - Exit gate: implementation-ready design brief is produced.

Then:

4. Handoff gate
   - Produce a design brief that a planner/coder can execute without guessing.
   - Exit gate: objective + scope + constraints + acceptance criteria are explicit.

## Conversational clarification loop

- Ask exactly one question at a time.
- Prefer multiple-choice questions where possible.
- Keep the loop to 3-5 questions (max 5).
- Focus questions on decisions that materially change implementation.
- For low-ambiguity requests, ask 0-2 confirmation questions and proceed.

Stop the loop when either condition is met:
- scope, constraints, and success criteria are explicit enough to plan safely
- five questions have been asked

Before proposing approaches, emit a short decision log:
- what changed from user answers
- assumptions that remain
- unresolved unknowns (if any)

## Design sections to cover

- Architecture shape
- Components and responsibilities
- Data flow and state boundaries
- Error handling and fallback behavior
- Validation strategy (manual by default; tests only when requested)

## Required Output

Return:
- Recommended approach
- Alternatives considered
- Explicit scope in and out
- Risks and assumptions
- Decision log from conversational loop

## Verification

- Run: `git status --short`
- Expect: no coding side effects occurred during brainstorming-only sessions.
- Run: `npm run build`
- Expect: only when design confirmation includes immediate implementation handoff and code changed.

## Failure Behavior

- Stop questioning at 5 questions or when scope is explicit.
- Report unresolved unknowns and the minimum decision needed from user.
- Escalate to implementation only after confirmation gate is complete.

## Project Defaults

- Keep planning lightweight and fast.
- Do not force approval gates for each action.
- Do not introduce worktrees unless user asks.

## Red Flags

- Jumping into implementation without explicit scope
- Presenting one option only
- Treating constraints as optional
- Asking a long list of questions in one message
- Continuing clarification after scope is already explicit

Corrective action: emit decision log, recommend approach, and transition out of brainstorming.

## Examples

- Good: three targeted questions, two alternatives, one recommendation, explicit scope boundaries.
- Anti-pattern: ten broad questions and no concrete recommendation.

## Integration

- Used by: `hf-core-agent` only (orchestrator-led).
- Required before: `hf-core-delegation` when ambiguity materially changes implementation.
- Required after: `hf-task-planner` once the design brief is finalized.

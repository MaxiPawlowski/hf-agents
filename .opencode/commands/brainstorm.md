---
name: hf-brainstorm
description: HF: Clarify design scope and choose an implementation approach before coding.
argument-hint: <problem or feature idea>
---

## Purpose

Run lightweight design clarification before planning or implementation.
This command is orchestrator-led and user-facing.

## Preconditions

- Problem statement is provided.
- `hf-brainstorming` skill is available.

## Execution Contract

Use `hf-brainstorming` directly in the orchestrator conversation and follow it exactly.
Do not route this command through subagents unless the user explicitly asks for delegated brainstorming.

## Required Output

- Recommended approach.
- Alternatives and trade-offs.
- In-scope and out-of-scope boundaries.
- Key risks and assumptions.
- Decision log from the one-question-at-a-time clarification loop.

## Failure Contract

- If skill invocation fails, return failure reason and next-step fallback command.

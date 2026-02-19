---
name: hf-brainstorm
description: Clarify design scope and choose an implementation approach before coding.
argument-hint: <problem or feature idea>
disable-model-invocation: true
---

## Purpose

Run lightweight design clarification before planning or implementation.

## Preconditions

- Problem statement is provided.
- `hf-brainstorming` skill is available.

## Execution Contract

Invoke `hf-brainstorming` skill and follow it exactly.

## Required Output

- Recommended approach.
- Alternatives and trade-offs.
- In-scope and out-of-scope boundaries.
- Key risks and assumptions.
- Decision log from the one-question-at-a-time clarification loop.

## Failure Contract

- If skill invocation fails, return failure reason and next-step fallback command.

---
name: hf-brainstorming
description: Use when a request needs design clarification before implementation.
---

# Brainstorming

## Overview

Convert rough intent into a validated design with clear scope, constraints, and success criteria.

## Why this exists

Skipping design causes the same failures repeatedly: wrong scope, wrong assumptions, and expensive rework.
This skill keeps planning lightweight while still forcing the core decisions to be explicit.

## Flow

1. Run a conversational clarification loop when request ambiguity is non-trivial.
2. Propose 2-3 approaches with practical trade-offs.
3. Recommend one approach and explain why.
4. Confirm design sections before implementation.

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

## Output format

Return:
- Recommended approach
- Alternatives considered
- Explicit scope in and out
- Risks and assumptions
- Decision log from conversational loop

## Project Defaults

- Keep planning lightweight and fast.
- Do not force approval gates for each action.
- Do not introduce worktrees unless user asks.

## Red flags

- Jumping into implementation without explicit scope
- Presenting one option only
- Treating constraints as optional
- Asking a long list of questions in one message
- Continuing clarification after scope is already explicit

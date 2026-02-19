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

1. Clarify problem, constraints, and success conditions.
2. Propose 2-3 approaches with practical trade-offs.
3. Recommend one approach and explain why.
4. Confirm design sections before implementation.

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

## Project Defaults

- Keep planning lightweight and fast.
- Do not force approval gates for each action.
- Do not introduce worktrees unless user asks.

## Red flags

- Jumping into implementation without explicit scope
- Presenting one option only
- Treating constraints as optional

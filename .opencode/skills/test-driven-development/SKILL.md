---
name: hf-test-driven-development
description: Use when strict quality mode or user explicitly asks for test-first implementation.
---

# Test-Driven Development

## Overview

Provide test-first implementation when explicitly requested by the user or policy.

## Project Note

In this repository, tests are not mandatory by default. Use this skill only when:
- User asks for it, or
- Policy profile explicitly requires it.

## Flow

1. Write failing test.
2. Implement minimum fix.
3. Re-run checks.
4. Refactor if needed.

## Guardrails

- Do not force this flow for users who requested manual validation.
- Keep tests focused on requested behavior.
- Avoid introducing test-only production behavior.

## Completion output

Return:
- Test added/updated
- Minimal implementation summary
- Verification result

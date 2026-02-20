---
name: hf-testing-gate
description: Use when the `requireTests` runtime toggle gate is enabled.
---

# Testing Gate

## Scope

- Toggle state `require_tests`: {{toggle.require_tests}}
- {{rule.require_tests}}

## Behavior

- Define minimum test commands before completion.
- Report pass/fail evidence for executed tests.
- Block readiness when required tests are missing.

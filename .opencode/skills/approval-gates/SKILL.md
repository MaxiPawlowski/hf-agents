---
name: hf-approval-gates
description: Use when approval, verification, or review runtime toggle gates are enabled.
---

# Approval Gates

## Scope

- Toggle state `require_verification`: {{toggle.require_verification}}
- {{rule.require_verification}}

## Behavior

- Require explicit verification evidence before ready state.
- Require review signoff when review gate is enabled.
- Keep gate outcomes explicit in final output.

---
name: hf-status
description: Show framework readiness status for agents, skills, policies, and tasks.
argument-hint: [feature] [--task-loop=on|off]
---

## Purpose

Provide a fast health snapshot to identify missing pieces before execution.

## Preconditions

- Workspace path is readable.
- Optional feature key is valid if provided.

## Execution Contract

1. Report command, agent, and skill availability.
2. Report active profile and key gates.
3. Report active execution profile.
4. If feature is provided and `--task-loop=on`, run lifecycle status check from `.tmp/task-lifecycle.json`.
5. Report workflow phase readiness (discovery/planning/implementation/review).
6. Surface warnings with highest-risk-first ordering.

## Required Output

- `System Status`: ready/degraded/not-ready.
- `Components`: available vs missing agents/skills/commands.
- `Policy`: active profile and enforced gates.
- `Profile`: active execution profile.
- `Task Status`: progress summary for selected feature when task loop is enabled.
- `Next Command`: best next command for current state.

## Failure Contract

- If status cannot be computed, return which subsystem failed and manual verification steps.

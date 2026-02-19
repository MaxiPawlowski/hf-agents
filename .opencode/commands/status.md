---
name: hf-status
description: Show framework readiness status for agents, skills, policies, and tasks.
argument-hint: [feature]
---

## Purpose

Provide a fast health snapshot to identify missing pieces before execution.

## Preconditions

- Workspace path is readable.
- Optional feature key is valid if provided.

## Execution Contract

1. Report command, agent, and skill availability.
2. Report active policy mode and key gates.
3. If feature is provided, run task status check via hf-task-management routing.
4. Surface warnings with highest-risk-first ordering.

## Required Output

- `System Status`: ready/degraded/not-ready.
- `Components`: available vs missing agents/skills/commands.
- `Policy`: active mode and enforced gates.
- `Task Status`: progress summary for selected feature.
- `Next Command`: best next command for current state.

## Failure Contract

- If status cannot be computed, return which subsystem failed and manual verification steps.

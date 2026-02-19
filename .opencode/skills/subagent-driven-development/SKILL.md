---
name: hf-subagent-driven-development
description: Use when executing a plan through TaskPlanner -> Coder -> Reviewer in one session.
---

# Subagent-Driven Development

## Overview

Execute implementation with focused subagent handoffs in one session and minimal orchestration overhead.

## Default sequence

1. TaskPlanner: refine implementation steps
2. Coder: apply scoped changes
3. Reviewer pass 1: validate scope/spec fit
4. Reviewer pass 2: validate quality and residual risk

## Execution rules

- Provide full task context to each subagent.
- Keep one active implementation stream unless tasks are independent.
- Re-run both review passes after non-trivial fixes.
- Stop when scope is satisfied; avoid extra "nice to have" additions.

If multiple tasks are independent, batch them and use parallel delegation.

## Reviewer focus

- Confirm requested behavior is present.
- Confirm no unrequested behavior was added.
- Confirm project runtime preferences were respected.
- Return clear pass/fail with concise findings.

Pass 1 should fail fast on scope drift. Pass 2 should prioritize risk and quality issues by severity.

## Guardrails

- No worktrees unless explicitly requested.
- No automatic git actions unless explicitly requested.
- Tests are optional unless user/policy requires them.

## Escalation path

- Requirement ambiguity -> return question to orchestrator before coding.
- Scope conflict -> prioritize explicit user instruction.
- Missing context -> call ContextScout before proceeding.

---
name: hf-executing-plans
description: Use when you have an implementation plan and need controlled batch execution with checkpoints.
---

# Executing Plans

## Overview

Execute approved plans in bounded batches while preserving policy-mode quality requirements.

## Flow

1. Load the plan and identify dependencies.
2. Execute the next small batch (default 2-3 tasks).
3. Verify according to policy mode.
4. Report outcomes and blockers.

## Verification by mode

- fast: scope-fit and obvious regressions.
- balanced: hf-verification-before-completion + reviewer check.
- strict: tests + reviewer check + completion verification.

## Output

- Completed tasks
- Verification evidence
- Open blockers
- Recommended next batch

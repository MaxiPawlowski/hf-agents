---
name: hf-executing-plans
description: Use when you have an implementation plan and need controlled batch execution with checkpoints.
---

# Executing Plans

## Overview

Execute approved plans in bounded batches while preserving policy-mode quality requirements.

## Flow

1. Load the plan and identify dependencies.
2. Select the next batch of ready tasks (default 2-3 tasks).
3. Run independent tasks in parallel when they do not share edited files.
4. Verify according to policy mode.
5. Report outcomes, blockers, and next ready set.

## Verification by mode

- fast: scope-fit and obvious regressions.
- balanced: hf-verification-before-completion + reviewer check.
- strict: tests + reviewer check + completion verification.

## Output

- Completed tasks
- Parallelized tasks (if any)
- Verification evidence
- Open blockers
- Recommended next batch

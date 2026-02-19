---
name: hf-using-git-worktrees
description: Use when isolation is explicitly requested or strict governance requires a separate workspace.
---

# Using Git Worktrees

## Overview

Create isolated workspaces for risky or parallel feature work while preserving main workspace safety.

## When to use

- User explicitly requests isolation
- Concurrent feature streams would conflict
- Strict governance requires branch isolation

## Safety rules

- Never create worktrees implicitly in fast mode.
- Verify target branch and path before creation.
- Confirm cleanup intent before deleting a worktree.

## Output

- worktree path
- branch used
- setup status
- cleanup recommendation

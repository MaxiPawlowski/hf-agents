---
name: hf-git-workflows
description: Use when git/worktree runtime toggle gates are enabled.
---

# Git Workflows

## Scope

- Toggle state `use_worktree`: {{toggle.use_worktree}}
- {{rule.use_worktree}}
- Keep git changes explicit, scoped, and reversible.

## Behavior

- Prepare safe branch/worktree strategy before edits.
- Prefer non-destructive git operations.
- Surface git risks early in the output.

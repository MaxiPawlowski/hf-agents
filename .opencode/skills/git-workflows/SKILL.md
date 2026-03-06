---
name: hf-git-workflows
description: >
  Use when branch, worktree setup, or git safety decisions are needed before or during implementation.
  Do NOT use for read-only analysis with no git interaction.
autonomy: gated
context_budget: 8000 / 2000
max_iterations: 3
---

# Git Workflows

Iron law: Never run destructive or irreversible git commands unless the user explicitly requests them in this session.

## Overview

One git workflow decision and execution cycle per implementation session. Handles branch prep, worktree strategy, and git safety decisions before and during implementation.

## When to Use

- When branch setup, worktree creation, or git safety decisions are needed before or during implementation.
- When committing, pushing, or preparing a branch for review.

## When Not to Use

- For read-only analysis with no git interaction.
- When the user has not requested any git operations in this session.

## Scope

One git workflow decision and execution cycle for one implementation session. Constraints: non-destructive commands only by default; no implicit worktree creation; no implicit branch management.

## Workflow

1. **Preflight** — Entry: implementation task requires git awareness. Record current branch and working tree status. {{#if toggle.use_worktree}}Worktree strategy is active — create an isolated worktree unless the user requests otherwise.{{else}}Direct edit is the default — do not create a worktree unless explicitly requested.{{/if}} Exit: safety plan is explicit before any edits.
2. **Execution** — Entry: safety plan approved (gated). Use non-destructive commands only. Keep scope limited to requested files and operations. Exit: operations complete with no unresolved git conflicts.
3. **Verification** — Entry: execution complete. Re-check repository status and summarize risk. Exit: output includes what changed and why it is safe.

## Verification

- Run: `git status --short --branch`
- Expect: current branch, ahead/behind state, and exact changed files.
- Run: `git log -1 --oneline`
- Expect: latest commit context when relevant to workflow decisions.

## Failure Behavior

- On destructive command required but not explicitly requested: return `{ blocked: "destructive git command needed", why: "<command> would <irreversible effect>", unblock: "user must explicitly approve <command>" }`.
- On merge conflict: return `{ blocked: "merge conflict", why: "<conflicting files>", unblock: "resolve conflicts in <files> or abort merge" }`.
- On ambiguous workspace strategy: escalate to user for explicit decision.

## Circuit Breaker

- Warning at 2 failed git operations.
- Hard stop at 3 — report failures and escalate.
- On destructive command attempted without explicit user request: immediate stop regardless of iteration count.

## Examples

### Correct
User asks for branch prep. Run `git status --short --branch`, choose safe workflow based on toggles and user request, execute non-destructive operations, and report risk summary. This works because every git action is traceable and reversible.

### Anti-pattern
Creating worktrees or resetting state implicitly because it seems faster. This fails because implicit destructive operations can lose uncommitted work and violate the user's workspace expectations.

## Red Flags

- "I will just hard reset and continue."
- "I assumed worktree usage without checking toggles."

## Integration

- **Before:** user request + {{#if toggle.use_worktree}}worktree strategy active{{else}}direct edit strategy (no worktree){{/if}} + current git status from caller or `hf-core-delegation`.
- **After:** safety decision log + commands executed + final git state summary. Schema: `{ branch, safety_plan, commands_run[], final_status, risk_notes }`.

## Rollback

1. `git stash` uncommitted changes (if any).
2. `git checkout <original-branch>` to restore starting branch.
3. `git stash pop` to restore working state.
4. Report what was reverted and confirm repository is back to pre-execution state.

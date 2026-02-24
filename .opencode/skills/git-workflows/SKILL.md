---
name: hf-git-workflows
description: Git and workspace safety workflows.
---

# Git Workflows

## Overview

Iron law: Never run destructive or irreversible git commands unless the user explicitly requests them in this session.

## When to Use

- You need branch/worktree setup before implementation.
- You need to report git risk and workspace safety decisions.

## When Not to Use

- Pure read-only analysis with no branch/worktree implications.
- Tasks with no git interaction at all.

## Workflow

1. Preflight gate
   - Record current branch and working tree status.
   - Decide direct edit vs worktree using runtime toggle and user request.
   - Exit gate: safety plan is explicit before edits.
2. Execution gate
   - Use non-destructive commands only.
   - Keep scope limited to requested files and operations.
   - Exit gate: operations are complete with no unresolved git conflicts.
3. Verification gate
   - Re-check repository status and summarize risk.
   - Exit gate: output includes what changed and why it is safe.

## Verification

- Run: `git status --short --branch`
- Expect: current branch, ahead/behind state, and exact changed files.
- Run: `git log -1 --oneline`
- Expect: latest commit context when relevant to workflow decisions.

## Failure Behavior

- Stop immediately if the task requires a destructive command that was not explicitly requested.
- Report blocked action, reason, and one safe alternative.
- Escalate decision to user for any irreversible action.

## Integration

- Required before: `hf-core-delegation` when implementation will modify files.
- Required after: `hf-verification-before-completion` for completion claims.
- Input artifacts: user request, toggle states, current git status.
- Output artifacts: safety decision log, commands executed, final git state summary.

## Examples

- Good: user asks for branch prep, you run `git status --short --branch`, choose safe workflow, and report risk.
- Anti-pattern: creating worktrees or resetting state implicitly because it feels faster.

## Red Flags

- "I will just hard reset and continue."
- "I assumed worktree usage without checking toggles."
- Corrective action: stop, restore conservative path, and request explicit user decision.

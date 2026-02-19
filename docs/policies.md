# Policies

## fast

- Max autonomy
- No approval gates
- Worktrees off by default
- Git management off by default
- Tests optional/manual
- Verification optional
- Code review optional
- Task artifacts enabled

## balanced

- Worktrees off by default
- Git management off by default
- Tests optional/manual
- Verification required before completion
- Explicit review required before completion
- Task artifacts enabled

## strict

- Worktrees off by default unless explicitly requested
- Git management off by default unless explicitly requested
- Tests required
- Approval gates required
- Verification required
- Explicit review required
- Task artifacts enabled

## Why these defaults

This repository is configured to avoid automatic git/worktree behavior unless explicitly requested.

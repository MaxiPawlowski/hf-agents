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
- Background concurrency/timeouts configured via `backgroundTask`
- Hook runtime config via `hookRuntime` (per-hook enable/settings)
- MCP integrations for Exa and gh-grep via `mcp`

## balanced

- Worktrees off by default
- Git management off by default
- Tests optional/manual
- Verification required before completion
- Explicit review required before completion
- Task artifacts enabled
- Background concurrency/timeouts configured via `backgroundTask`
- Hook runtime config via `hookRuntime` (per-hook enable/settings)
- MCP integrations for Exa and gh-grep via `mcp`

## strict

- Worktrees off by default unless explicitly requested
- Git management off by default unless explicitly requested
- Tests required
- Approval gates required
- Verification required
- Explicit review required
- Task artifacts enabled
- Background concurrency/timeouts configured via `backgroundTask`
- Hook runtime config via `hookRuntime` (per-hook enable/settings)
- MCP integrations for Exa and gh-grep via `mcp`

## Why these defaults

This repository is configured to avoid automatic git/worktree behavior unless explicitly requested.

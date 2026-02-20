# Runtime Settings

Runtime gates are toggle-first and resolved by settings, not CLI modes.

Default local settings file:

- `settings/framework-settings.json`

## Canonical toggles

- `useWorktreesByDefault`
- `manageGitByDefault`
- `requireTests`
- `requireApprovalGates`
- `requireVerification`
- `requireCodeReview`
- `enableTaskArtifacts`

Resolution precedence:

1. built-in defaults
2. `toggles` overrides

## Built-in defaults

- Max autonomy with minimal context
- No approval gates
- Worktrees off by default
- Git management off by default
- Tests optional/manual
- Verification optional
- Code review optional
- Task artifacts disabled by default
- Hook runtime config via `hookRuntime` (per-hook enable/settings)

## Why these defaults

This repository is configured to avoid automatic git/worktree behavior unless explicitly requested.

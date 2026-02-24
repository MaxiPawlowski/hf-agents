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

These live under `toggles` in `settings/framework-settings.json`:

```json
{
  "toggles": {
    "requireTests": false,
    "requireVerification": false
  }
}
```

## OpenCode toggle commands

When using OpenCode with this framework installed, the plugin exposes short toggle commands that write to `settings/framework-settings.json` in the current working directory:

- `/toggle-worktree on|off` -> sets `useWorktreesByDefault` and `manageGitByDefault`
- `/toggle-tests on|off` -> sets `requireTests`
- `/toggle-verification on|off` -> sets `requireApprovalGates`, `requireVerification`, and `requireCodeReview`
- `/toggle-artifacts on|off` -> sets `enableTaskArtifacts`

The command names use `snake_case` internally (`use_worktree`, `require_tests`, `require_verification`, `task_artifacts`) and are mapped to the nested runtime settings toggle keys shown above.

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

# Claude Adapter

This folder has two roles depending on where you are reading it:

- In this package repo, `.claude/` contains the tracked Claude hook reference surface.
- In a consumer project after `hf-setup --command install`, `hf-setup --command init`, or `hf-setup --command sync`, `.claude/` is generated managed output derived from the installed package.

Claude-specific material belongs here; the framework itself lives at the repo root:

- `agents/`
- `subagents/`
- `skills/` for the active reusable procedures only
- `src/`
- `schemas/`

See `../README.md` for the canonical framework surface and `../plans/README.md` for the active plan-doc format.

`settings.local.json` is intentionally local-only and ignored by git.

`settings.example.json` is the tracked reference for wiring the current Claude hook surface implemented by `../src/claude/hook-handler.ts`.

## Consumer Project Behavior

For the general consumer install and lifecycle contract, see [`docs/consumer-install.md`](../docs/consumer-install.md).

When a consumer project runs the Claude install or init lifecycle, the package manages `.claude/` in the target project by:

- merging the framework hook groups into `.claude/settings.local.json`
- preserving unrelated user-owned Claude settings
- optionally generating `.claude/agents/` and `.claude/skills/` when `assets.claude.copy` requests adapter-local markdown mirrors

Re-running the Claude sync lifecycle refreshes the managed Claude surface from the installed package without re-scaffolding `plans/` or `vault/`.

`hf-setup --command install --platform claude` merges the framework hook groups into `settings.local.json`; it does not overwrite unrelated local settings.

### Claude lifecycle commands

Use `hf-setup` with `--platform claude` when a consumer project only needs Claude and should not install OpenCode at all:

| Purpose | `hf-setup` command | Combined equivalent |
|---|---|---|
| Install Claude wiring into an existing project | `hf-setup --command install --platform claude` | `hf-setup --command install` |
| Scaffold `plans/` + `vault/`, then install Claude wiring | `hf-setup --command init --platform claude` | `hf-setup --command init` |
| Refresh managed Claude output | `hf-setup --command sync --platform claude` | `hf-setup --command sync` |
| Remove managed Claude output | `hf-setup --command uninstall --platform claude` | `hf-setup --command uninstall` |

The combined commands remain valid when the project wants both adapters. The `--platform claude` flag exists so a Claude-only consumer never needs to think about OpenCode.

Claude does not have a default generated prompt surface the way OpenCode does. The only always-managed Claude file is the hook wiring in `settings.local.json`.

If a consumer project sets `assets.claude.copy` in `hybrid-framework.json`, `scripts/sync-opencode-assets.mjs` can also materialize selected canonical markdown assets into adapter-local reference folders:

- `agents/` and `subagents/` entries are written to `.claude/agents/`
- `skills/` entries mirror their canonical path under `.claude/skills/`
- `assets.mode` uses the same `copy` / `symlink` / `references` rules as OpenCode, with `references` falling back to copies when symlinks are unavailable

Those Claude markdown mirrors are generated references for the consumer project; the root package assets remain canonical.

In consumer projects, treat `.claude/` as generated output:

- customize behavior through `hybrid-framework.json`
- run `hf-setup --command sync --platform claude` (or `hf-setup --command sync`) after changing adapter asset settings or upgrading the package
- run `hf-setup --command uninstall --platform claude` (or `hf-setup --command uninstall`) to remove managed Claude wiring cleanly while preserving unrelated local settings

The tracked example covers the currently supported Claude hook events:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PreCompact`
- `Stop`
- `SubagentStart`
- `SubagentStop`

# Installing Hybrid Framework for OpenCode

## Prerequisites

- OpenCode installed
- Git installed
- Node.js installed

Recommended: run commands from this repository root.

## Recommended Global Install

Install the framework assets into your OpenCode config directory (cross-platform):

```bash
npm run install:opencode:global -- --collision backup
```

This installs OpenCode assets (agents, commands, skills, plugin, context, prompts). Default mode is `symlink`, so updates stay in sync with this repository.

Windows note: symlink installs may require Administrator privileges or Developer Mode. If symlinks fail, retry with `--mode copy`.

## Local Install (Project Sandbox)

Install assets into a repo-local directory for testing:

```bash
npm run install:opencode -- --target .opencode.local --collision backup
```

## Install Options

- `--mode copy|symlink` (default `symlink`)
- `--collision skip|overwrite|backup|cancel` (default `backup`)
- `--dry-run` previews actions without writing anything
- `--help` prints installer usage

## Uninstall

Remove framework-managed assets from a target:

```bash
npm run uninstall:opencode:global:dry
npm run uninstall:opencode:global
```

Uninstall options:

- `--force` removes matching target paths even if they no longer match source content

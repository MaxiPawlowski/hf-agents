# Installing Hybrid Framework for OpenCode

## Prerequisites

- OpenCode installed
- Git installed
- Node.js installed

## Recommended Global Install (Symlink Mode)

1) Clone the framework repository into your global OpenCode config directory:

```bash
git clone <your-repo-url> ~/.config/opencode/hybrid-framework
```

2) Run the installer (symlink mode is the default):

```bash
cd ~/.config/opencode/hybrid-framework
node scripts/install/install-opencode-assets.mjs --target ~/.config/opencode --collision backup --open-env
```

This creates global OpenCode assets (agents, commands, skills, plugin, context, prompts) as symlinks to this repository so updates stay in sync.

## Agent-Friendly Install Command

You can ask OpenCode to run:

```text
Run: node scripts/install/install-opencode-assets.mjs --target ~/.config/opencode --collision backup --open-env
```

## Install Options

- `--mode copy|symlink` (default `symlink`)
- `--collision skip|overwrite|backup|cancel` (default `backup`)
- `--open-env` opens `<target>/.env` in your default editor
- `--dry-run` previews actions without writing anything

## Uninstall

Remove framework-managed assets from a target:

```bash
node scripts/install/uninstall-opencode-assets.mjs --target ~/.config/opencode --dry-run
node scripts/install/uninstall-opencode-assets.mjs --target ~/.config/opencode
```

Uninstall options:

- `--force` removes matching target paths even if they no longer match source content
- `--remove-env` also removes `<target>/.env`

## Environment

Installer seeds `<target>/.env` when missing.

Use this file for any local runtime overrides your project needs.

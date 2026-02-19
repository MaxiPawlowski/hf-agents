# Install and Validation Operations

This project includes safe install/update and asset validation utilities.

## Validation Commands

```bash
node scripts/validation/validate-registry.mjs
node scripts/validation/check-dependencies.mjs
node scripts/validation/validate-context-refs.mjs
```

## Safe Installer

Install `.opencode` assets to a target path with collision handling:

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup
```

Collision modes:

- `skip`: keep existing files, install only missing files
- `overwrite`: replace existing files
- `backup`: copy old files to `.opencode.backup.<timestamp>` then overwrite
- `cancel`: abort install when collision is detected

Use `--dry-run` to preview actions without writing files.

## Context Reference Transform

Markdown files using `@.opencode/context/...` are transformed during install for custom targets.

## Hook Wrapper

Cross-platform wrapper files are available in `scripts/hooks/` and hook declaration is in `hooks/hooks.json`.

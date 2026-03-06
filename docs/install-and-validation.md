# Install and Validation Operations

This project includes safe install/update and asset validation utilities.

## Validation Commands

```bash
npm run validate:registry
npm run validate:deps
npm run validate:context-refs
npm run validate:command-contracts
npm run validate:agent-contracts
npm run validate:skill-contracts
```

Or run the combined asset validation pipeline:

```bash
npm run validate
```

## Safe Installer

Install `.opencode` assets to a target path with collision handling:

```bash
npm run install:opencode -- --target .opencode.local --collision backup
```

Default install mode is `symlink`.

Windows note: symlink installs may require Administrator privileges or Developer Mode. If symlinks fail, retry with `--mode copy`.

Install modes:

- `symlink` (default): creates symlinks from target files back to this repository's `.opencode` assets.
- `copy`: copies files into the target path.

Recommended global setup:

```bash
npm run install:opencode:global -- --collision backup
```

Collision modes:

- `skip`: keep existing files, install only missing files
- `overwrite`: replace existing files
- `backup`: move old files to `.opencode.backup.<timestamp>` then overwrite
- `cancel`: abort install when collision is detected

Use `--dry-run` to preview actions without writing files.

Discover supported flags:

```bash
npm run install:opencode -- --help
npm run uninstall:opencode -- --help
```

## Uninstall

Remove previously installed framework assets from a target path:

```bash
npm run uninstall:opencode:dry -- --target .opencode.local
npm run uninstall:opencode -- --target .opencode.local
```

Uninstall options:

- `--force`: remove matching target paths even when file/symlink content does not match source
- `--dry-run`: preview removals without writing

## Context Reference Transform

Markdown files using `@.opencode/context/...` are transformed during install for custom targets.


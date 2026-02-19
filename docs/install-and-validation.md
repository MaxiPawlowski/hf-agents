# Install and Validation Operations

This project includes safe install/update and asset validation utilities.

## Validation Commands

```bash
node scripts/validation/validate-registry.mjs
node scripts/validation/check-dependencies.mjs
node scripts/validation/validate-context-refs.mjs
node scripts/validation/lint-command-contracts.mjs
```

Or run the combined asset validation pipeline:

```bash
npm run validate:assets
```

## Safe Installer

Install `.opencode` assets to a target path with collision handling:

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup
```

Default install mode is `symlink`.

The installer also seeds a `.env` file in the target directory if missing.

Open that `.env` file automatically with your default editor:

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --open-env
```

Install modes:

- `symlink` (default): creates symlinks from target files back to this repository's `.opencode` assets.
- `copy`: copies files into the target path.

Recommended global setup (Superpowers-style):

```bash
git clone <your-repo-url> ~/.config/opencode/hybrid-framework
cd ~/.config/opencode/hybrid-framework
node scripts/install/install-opencode-assets.mjs --target ~/.config/opencode --mode symlink --collision backup --open-env
```

This lets agents run the installer safely while keeping global assets linked to your local framework checkout.

Collision modes:

- `skip`: keep existing files, install only missing files
- `overwrite`: replace existing files
- `backup`: copy old files to `.opencode.backup.<timestamp>` then overwrite
- `cancel`: abort install when collision is detected

Use `--dry-run` to preview actions without writing files.

## Uninstall

Remove previously installed framework assets from a target path:

```bash
node scripts/install/uninstall-opencode-assets.mjs --target .opencode.local --dry-run
node scripts/install/uninstall-opencode-assets.mjs --target .opencode.local
```

Uninstall options:

- `--force`: remove matching target paths even when file/symlink content does not match source
- `--remove-env`: also remove `<target>/.env`
- `--dry-run`: preview removals without writing

## Context Reference Transform

Markdown files using `@.opencode/context/...` are transformed during install for custom targets.

## Hook Wrapper

Cross-platform wrapper files are available in `scripts/hooks/` and hook declaration is in `hooks/hooks.json`.

## Lifecycle and Diagnostics

Use runtime APIs instead of CLI wrappers:

- `generateDiagnosticsReport()` and `formatDiagnosticsReport()`
- task lifecycle helpers in `src/tasks/task-lifecycle.ts`

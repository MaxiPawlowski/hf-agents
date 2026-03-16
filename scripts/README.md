# Packaging verification

Run `npm run pack:check` (or `npm pack --dry-run`) before publishing.

The published file set is controlled by `package.json#files` and intentionally keeps only the runtime JS under `dist/src/`, the canonical root markdown assets used for adapter generation, the installer and sync scripts, the JSON schemas, and `vault/templates/`.

The root `src/`, `tests/`, local `plans/`, and source maps are excluded from the package so the tarball stays limited to the supported consumer runtime surface.

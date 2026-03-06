# Architecture

Related docs:
- `docs/architecture-contracts.md`
- `docs/portability-matrix.md`
- `docs/install-and-validation.md`

## OpenCode Integration

Framework assets are authored under `.opencode/` and installed into an OpenCode config target (usually `<home>/.config/opencode`):

- No plugin layer — all behavior is encoded in markdown agent/skill/command files.
- `agents/hf-*.md`: agent contracts.
- `commands/*.md`: command contracts.
- `context/**`: indexed context used by agents via `@.opencode/context/...` references.

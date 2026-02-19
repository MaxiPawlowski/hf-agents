# Portability Matrix

Compatibility snapshot for this framework's configuration model.

| Capability | OpenCode | Claude Code Plugin | Cursor | Windsurf |
|---|---|---|---|---|
| Multiple agents | Yes | Yes | No | Partial |
| Skill modules | Yes | Yes | No | Partial |
| Command markdown contracts | Yes | Yes | Partial | Partial |
| Asset registry validation | Yes | Yes (scripted) | Partial | Partial |
| Context reference transform | Yes | Yes | No | Partial |
| Hook wrappers (cross-platform) | Yes | Yes | No | No |
| Transcript token harness | Yes | Yes | Partial | Partial |
| Prompt variant files | Yes | Yes | Partial | Partial |

## Notes

- Cursor lacks first-class multi-agent routing and markdown skill loading.
- Windsurf can support variants and commands but typically with lower feature parity.
- Claude Code plugin can reuse most scripts with minor path/tooling adaptation.

## Migration Guidance

1. Keep contracts in markdown-first files (`.opencode/...`) whenever possible.
2. Keep automation in portable Node scripts under `scripts/`.
3. Validate registry/dependencies/context references before migration.

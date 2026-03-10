# Claude Adapter

Claude-specific material belongs here; the framework itself lives at the repo root:

- `agents/`
- `subagents/`
- `skills/` for the active reusable procedures only
- `src/`
- `schemas/`

See `../README.md` for the canonical framework surface and `../plans/README.md` for the active plan-doc format.

`settings.local.json` is intentionally local-only and ignored by git.

`settings.example.json` is the tracked reference for wiring the current Claude hook surface implemented by `../src/claude/hook-handler.ts`.

`scripts/install-runtime.mjs --tool claude` merges those hook groups into `settings.local.json`; it does not overwrite unrelated local settings.

The tracked example covers the currently supported Claude hook events:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PreCompact`
- `Stop`
- `SubagentStart`
- `SubagentStop`

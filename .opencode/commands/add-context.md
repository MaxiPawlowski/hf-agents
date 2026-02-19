---
name: hf-add-context
description: Add or register project context from local or remote sources.
argument-hint: <source> [--category=<core|team|custom|external>] [--priority=<critical|high|medium>] [--dry-run]
---

## Purpose

Improve context coverage for future delegation by adding validated context resources.

## Preconditions

- A valid source is provided (`github:`, `worktree:`, `file:`, `url:`).
- Destination context root exists or can be created.
- Write permission exists for context destination.

## Execution Contract

1. Parse and validate source descriptor.
2. Resolve context destination (`.opencode/context/...`).
3. Validate markdown format and structure of incoming files.
4. Add/update navigation entries for discoverability.
5. If `--dry-run`, report only planned actions with no writes.

## Required Output

- `Source`: normalized source descriptor.
- `Destination`: resolved target path.
- `Validation`: passed/warnings/errors per file.
- `Navigation Updates`: changed indexes or sections.
- `Discoverability`: confirmation of where the new context appears.

## Failure Contract

- Never mutate files when validation fails unless user explicitly requests partial import.
- Return failed step, bad inputs, and corrected command example.

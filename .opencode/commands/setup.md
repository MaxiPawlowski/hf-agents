---
name: hf-setup
description: Initialize command, context, and policy prerequisites for this framework.
argument-hint: [--mode=<fast|balanced|strict>] [--with-sample-context]
---

## Purpose

Prepare a repository to use the framework command workflow safely.

## Preconditions

- Repository root is writable.
- `.opencode/` directory exists or can be created.

## Execution Contract

1. Verify required directories (`.opencode/agents`, `.opencode/commands`, `.opencode/skills`, `.opencode/context`).
2. Verify policy files exist and resolve selected mode.
3. Optionally seed sample context when `--with-sample-context` is supplied.
4. Return next-step commands for planning and verification.

## Required Output

- `Installed/Verified`: required directories and files.
- `Policy Mode`: selected mode and rationale.
- `Missing Items`: any blockers to normal workflow.
- `Next Steps`: concrete command sequence.

## Failure Contract

- If setup is incomplete, return exact missing paths and minimal fixes.

---
name: hf-writing-plans
description: Use when an approved design needs an implementation checklist.
---

# Writing Plans

## Overview

Transform approved design into a concrete implementation plan with small, executable tasks.

## Plan quality standard

- Every task should be executable in minutes, not hours.
- Reference exact file paths wherever possible.
- Keep dependencies explicit between tasks.
- Prefer minimal scope and avoid overbuilding.

## Required sections

- Goal and architecture summary
- Task list in strict order
- File-level change targets
- Risks and assumptions
- Verification approach (manual by default unless user asks for tests)

## Task format

For each task include:
- Purpose
- Files to create/modify
- Step-by-step actions
- Expected output
- Potential rollback note if risky

## Output

- Task list with dependencies
- Risks and assumptions
- Suggested execution order

## Project Defaults

- No worktree creation unless explicitly requested.
- No git operations unless explicitly requested.

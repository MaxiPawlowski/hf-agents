---
name: hf-local-context
description: >
  Use to find the minimum relevant local project files for a given research brief.
  Replaces hf-context-scout as a subagent.
autonomy: supervised
context_budget: 8000 / 2000
max_iterations: 2
---

# Local Context

Iron law: Load only what changes implementation decisions. Stop as soon as the file set is sufficient.

## Overview

One context pass per planning session. Given a research brief from `hf-brainstormer`,
identify the minimum local files needed to answer: what conventions apply here, and where
should changes land.

## When to Use

- When `hf-local-context-scout` needs to find project files, patterns, or conventions for a feature.
- When building context for a planning session based on a research brief's `local_search_targets`.

## When Not to Use

- For general exploration without a focused research brief.
- When the required conventions are already loaded in context.
- For searching external sources — use `hf-web-research-scout` instead.

## Search Order

1. `.opencode/context/navigation.md` — always first
2. `.opencode/context/core/standards/*` — coding standards and conventions
3. `.opencode/context/project-intelligence/*` — domain and pattern intelligence
4. `.opencode/context/project/*` — project-specific context
5. Source files matching the research brief's `local_search_targets`

## Workflow

1. Load navigation index.
2. Follow `local_search_targets` from the research brief — grep/glob for specific file
   paths, pattern names, or module names listed.
3. Stop when you can answer: "what conventions apply" and "where should changes land."
4. Report missing context as explicit questions rather than guessing.

## Verification

- Run: `ls .opencode/context/navigation.md` to confirm navigation index is accessible.
- Confirm each `local_search_target` was either found (with path) or explicitly reported as not found.

## Failure Behavior

If blocked, return:

- blocked: what cannot be determined
- why: what specific input is missing
- unblock: the smallest specific detail needed

## Integration

- **Loaded by:** `hf-local-context-scout` (the subagent that runs this skill).
- **Input from:** research brief's `local_search_targets` produced by `hf-brainstormer`.
- **Output consumed by:** `hf-planner-light` (Phase 2) or `hf-planner-deep` (Phase 3) via `hf-plan-synthesis`.

## Examples

### Correct

Research brief lists `local_search_targets: ["src/api/routes", "validation patterns"]`. Load navigation.md, grep for route files and validation utilities, stop once patterns are clear. Report 3 files found, 2 naming patterns, 1 gap (no existing pagination pattern). This works because search was targeted, not exhaustive.

### Anti-pattern

Loading entire `src/` directory "to be thorough." This fails because it floods context with irrelevant files, making the planning summary less accurate.

## Red Flags

- "I'll load all source files to be safe."
- "I'll skip navigation.md and go straight to grep."
- "I found enough — I won't report the gaps."

## Required Output

Return:

- context_files: ordered list of paths (standards first)
- why: one-line rationale per file
- patterns_found: notable conventions, file structures, naming patterns
- missing_context: explicit gaps as questions (if any)
- stop_point: why this set is sufficient

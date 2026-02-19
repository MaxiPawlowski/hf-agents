---
name: hf-dispatching-parallel-agents
description: Use when tasks are independent and can be executed concurrently.
---

# Dispatching Parallel Agents

## Overview

Speed up delivery by parallelizing only truly independent workstreams.

## Rules

- Parallelize only tasks with no shared mutable state.
- Merge outputs through a single coordinator summary.
- If conflicts appear, switch back to sequential execution.

## Good candidates

- Separate documentation and implementation tracks
- Independent module updates
- Isolated refactors with no overlapping files

## Bad candidates

- Shared file edits
- State-coupled logic changes
- Sequenced changes where output A is input B

## Output format

Return:
- Parallel task map
- Conflict risk notes
- Consolidated final summary

## Project Defaults

- Do not create worktrees by default.
- Do not perform git management operations unless requested.

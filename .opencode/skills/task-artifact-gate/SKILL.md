---
name: hf-task-artifact-gate
description: Use when the `enableTaskArtifacts` runtime toggle gate is enabled.
---

# Task Artifact Gate

## Scope

- Toggle state `task_artifacts`: {{toggle.task_artifacts}}
- {{rule.task_artifacts}}

## Behavior

- Maintain dependency-aware task artifacts for active work.
- Keep artifact status synced with implementation progress.
- Include artifact summary in completion output.

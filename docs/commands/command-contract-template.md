# Command Contract Template

Use this template for all markdown command definitions in `.opencode/commands/`.

```md
---
name: <command-name>
description: <one-line description>
argument-hint: <args>
# optional: disable-model-invocation: true
---

## Purpose

<one to two lines>

## Preconditions

- <condition>

## Execution Contract

1. <step>

## Required Output

- `<Section Name>`: <expected content>

## Failure Contract

- <failure behavior and remediation>
```

Notes:
- Keep command files concise and deterministic.
- Move long walkthroughs and examples to `hybrid-framework/docs/commands/README.md`.
- Never hide failure states; always return explicit blockers and next actions.

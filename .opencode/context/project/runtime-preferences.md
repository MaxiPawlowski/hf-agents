<!--
id: runtime-preferences
owner: team
updated: 2026-03-06
-->

# Runtime Preferences

This project is OpenCode-configured and markdown-first.

## Non-negotiable defaults

- Do not use worktrees unless explicitly requested by the user.
- Do not manage git unless explicitly requested by the user.
- Do not force test execution; manual validation is the default.

## Preferred execution style

- Fast autonomous delegation
- Minimal overhead
- Clear summaries of what changed

## Planning modes

Mode is selected by agent choice — no toggles, no runtime state.

| Agent | When to use |
|---|---|
| `hf-planner-light` | Feature is well-understood, local context is sufficient |
| `hf-planner-deep` | Feature requires external research, brainstorming, or online code examples |

## Build modes

| Agent | When to use |
|---|---|
| `hf-builder-light` | Fast iteration, trust the coder, no review gate needed |
| `hf-builder-deep` | Quality gate required — coder→reviewer loop + verification before completion |

## Skill loading policy (context efficient)

- Do not load skills by default.
- Load a skill only when it changes the next decision or imposes a gate.
- Prefer the smallest relevant skill for the current stage:
  - debugging unexpected behavior: `hf-systematic-debugging`
  - parallel discovery bursts: `hf-dispatching-parallel-agents`
  - completion claims: `hf-verification-before-completion`

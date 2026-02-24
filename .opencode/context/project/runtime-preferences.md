<!--
id: runtime-preferences
owner: team
updated: 2026-02-19
-->

# Runtime Preferences

This project is OpenCode-configured and markdown-first.

## Non-negotiable defaults

- Do not use worktrees unless explicitly requested by the user.
- Do not manage git unless explicitly requested by the user.
- Do not force test execution; manual validation is the default.
- Do not use approval-gate blocking as default workflow.

## Preferred execution style

- Fast autonomous delegation
- Minimal overhead
- Clear summaries of what changed
- Toggle-aware quality gates from runtime settings
- Dependency-aware task artifacts for complex work

## Runtime interpolation contract

- Markdown assets may include runtime placeholders resolved by plugin hooks.
- Supported forms:
  - `&#123;&#123;toggle.&lt;key&gt;&#125;&#125;` for ON/OFF state
  - `&#123;&#123;rule.&lt;key&gt;&#125;&#125;` for conditional guidance text
  - `&#123;&#123;#if toggle.&lt;key&gt;&#125;&#125; ... &#123;&#123;/if&#125;&#125;` for conditional sections
  - `&#123;&#123;#unless toggle.&lt;key&gt;&#125;&#125; ... &#123;&#123;/unless&#125;&#125;` for inverse conditional sections
  - `&#123;&#123;else&#125;&#125;` is supported inside `if`/`unless` blocks
- Current keys:
  - `use_worktree`, `require_tests`, `require_verification`, `task_artifacts`

## Skill loading policy (context efficient)

- Do not load skills by default.
- Load a skill only when it changes the next decision or imposes a gate.
- Prefer the smallest relevant skill for the current stage:
  - planning/execution orchestration: `hf-core-delegation` (end-to-end) or `hf-subagent-driven-development` (plan already approved)
  - debugging unexpected behavior: `hf-systematic-debugging`
  - parallel discovery bursts: `hf-bounded-parallel-scouting` / `hf-dispatching-parallel-agents`
  - completion claims: `hf-verification-before-completion`

Toggle-gated skills (load only when the toggle is ON and the stage needs it):

- `use_worktree=ON`: `hf-git-workflows` when making workspace/git strategy decisions.
- `require_tests=ON`: `hf-testing-gate` / `hf-tester` when shipping code changes.
- `require_verification=ON`: `hf-approval-gates` and evidence checks when making readiness/completion decisions.
- `task_artifacts=ON`: `hf-task-artifact-gate` / `hf-task-management` when work spans multiple steps or delegated units.

## Optional task loop (v2)

- Task lifecycle tracking automation is optional by default.
- Lifecycle artifacts in `.tmp/task-lifecycle.json` are required when task artifacts are required; `hf-task-loop` is the recommended helper.

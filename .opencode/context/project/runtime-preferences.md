<!--
id: runtime-preferences
owner: team
updated: 2026-03-01
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
  - `&#123;&#123;skill.&lt;name&gt;&#125;&#125;` includes the body of `skills/<name>/SKILL.md` (frontmatter stripped, tokens resolved)
- Current keys:
  - `useWorktreesByDefault`, `manageGitByDefault`, `requireTests`, `requireApprovalGates`, `requireVerification`, `requireCodeReview`, `enableTaskArtifacts`

## Skill loading policy (context efficient)

- Do not load skills by default.
- Load a skill only when it changes the next decision or imposes a gate.
- Prefer the smallest relevant skill for the current stage:
  - planning/execution orchestration: `hf-core-delegation` (end-to-end) or `hf-subagent-driven-development` (plan already approved)
  - debugging unexpected behavior: `hf-systematic-debugging`
  - parallel discovery bursts: `hf-bounded-parallel-scouting` / `hf-dispatching-parallel-agents`
  - completion claims: `hf-verification-before-completion`

Active toggle-gated skills:

{{#if toggle.use_worktree}}- Load `hf-git-workflows` when making workspace/git strategy decisions.{{/if}}
{{#if toggle.require_tests}}- Load `hf-testing-gate` / `hf-tester` when shipping code changes.{{/if}}
{{#if toggle.require_verification}}- Load `hf-approval-gates` + `hf-verification-before-completion` when making readiness/completion decisions.{{/if}}
{{#if toggle.task_artifacts}}- Load `hf-task-artifact-gate` / `hf-task-management` when work spans multiple steps or delegated units.{{/if}}

## Optional task loop (v2)

- Task lifecycle tracking automation is optional by default.
- Lifecycle artifacts in `.tmp/task-lifecycle.json` are required when task artifacts are required; `hf-task-loop` is the recommended helper.

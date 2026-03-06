# Full Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all stale files, registry entries, and documentation left over from the orchestrator-modes migration.

**Architecture:** Pure deletion + targeted content updates. No new features. 9 tasks: delete old plan docs, toggle commands, orphaned agents, orphaned skills; update registry, runtime-preferences, skill Integration sections, README/architecture; final build.

**Tech Stack:** Markdown, JSON (registry.json), npm validation scripts (`validate:assets`, `validate:context-refs`, `validate:command-contracts`, `validate:agent-contracts`). No TypeScript changes.

---

### Task 1: Delete all docs/plans/ files

**Files:**
- Delete: `docs/plans/2026-03-05-plan-build-orchestrators.md`
- Delete: `docs/plans/2026-03-05-plan-build-orchestrators-design.md`
- Delete: `docs/plans/2026-03-06-orchestrator-modes-design.md`
- Delete: `docs/plans/2026-03-06-orchestrator-modes-plan.md`
- Delete: `docs/plans/2026-03-06-toggle-redesign.md`
- Delete: `docs/plans/2026-03-06-toggle-redesign-design.md`
- Delete: `docs/plans/2026-03-06-chrome-devtools-mcp-design.md`
- Delete: `docs/plans/2026-03-06-chrome-devtools-mcp.md` (untracked — use `rm`, not `git rm`)

**Step 1: Delete tracked plan docs via git rm**

```bash
git rm docs/plans/2026-03-05-plan-build-orchestrators.md \
       docs/plans/2026-03-05-plan-build-orchestrators-design.md \
       docs/plans/2026-03-06-orchestrator-modes-design.md \
       docs/plans/2026-03-06-orchestrator-modes-plan.md \
       docs/plans/2026-03-06-toggle-redesign.md \
       docs/plans/2026-03-06-toggle-redesign-design.md \
       docs/plans/2026-03-06-chrome-devtools-mcp-design.md
```

**Step 2: Delete untracked chrome-devtools plan doc**

```bash
rm docs/plans/2026-03-06-chrome-devtools-mcp.md
```

Expected: no error (file exists, confirmed untracked in git status).

**Step 3: Verify only this plan remains**

Run: `ls docs/plans/`
Expected: Only `2026-03-06-full-cleanup.md` listed.

**Step 4: Commit**

```bash
git add docs/plans/
git commit -m "remove: delete all historical plan docs"
```

---

### Task 2: Delete toggle command files

**Files:**
- Delete: `.opencode/commands/toggle-plan.md`
- Delete: `.opencode/commands/toggle-worktree.md`
- Delete: `.opencode/commands/toggle-tests.md`
- Delete: `.opencode/commands/toggle-verification.md`
- Delete: `.opencode/commands/toggle-artifacts.md`
- Delete: `.opencode/commands/toggle-status.md`

**Step 1: Delete via git rm**

```bash
git rm .opencode/commands/toggle-plan.md \
       .opencode/commands/toggle-worktree.md \
       .opencode/commands/toggle-tests.md \
       .opencode/commands/toggle-verification.md \
       .opencode/commands/toggle-artifacts.md \
       .opencode/commands/toggle-status.md
```

**Step 2: Run command contracts validator**

Run: `npm run validate:command-contracts`
Expected: Passes. Command count decreases by 6.

**Step 3: Commit**

```bash
git commit -m "remove: delete all toggle commands"
```

---

### Task 3: Delete orphaned agents

**Files:**
- Delete: `.opencode/agents/hf-external-docs-scout.md` (not referenced by any current planner)
- Delete: `.opencode/agents/hf-tester.md` (not referenced by any current builder)

**Step 1: Delete via git rm**

```bash
git rm .opencode/agents/hf-external-docs-scout.md \
       .opencode/agents/hf-tester.md
```

**Step 2: Commit**

```bash
git commit -m "remove: delete orphaned agents (external-docs-scout, tester)"
```

---

### Task 4: Delete orphaned skill directories

**Files:**
- Delete: `.opencode/skills/testing-gate/` (was for `require_tests` toggle — toggles gone)
- Delete: `.opencode/skills/approval-gates/` (was for `requireApprovalGates` toggle — toggles gone)
- Delete: `.opencode/skills/task-artifact-gate/` (was for `enableTaskArtifacts` toggle — toggles gone)
- Delete: `.opencode/skills/bounded-parallel-scouting/` (was loaded by old `hf-plan-orchestrator` — new planners dispatch scouts directly)

**Step 1: Delete via git rm -r**

```bash
git rm -r .opencode/skills/testing-gate \
          .opencode/skills/approval-gates \
          .opencode/skills/task-artifact-gate \
          .opencode/skills/bounded-parallel-scouting
```

**Step 2: Commit**

```bash
git commit -m "remove: delete orphaned skills (toggle gates + bounded-parallel-scouting)"
```

---

### Task 5: Update registry.json

**Files:**
- Modify: `.opencode/registry.json`

**Step 1: Replace the entire file with this content**

```json
{
  "version": "1.0.0",
  "assets": [
    {
      "id": "agent-planner-light",
      "type": "agent",
      "path": ".opencode/agents/hf-planner-light.md",
      "dependsOn": [
        "skill-plan-synthesis",
        "agent-local-context-scout"
      ]
    },
    {
      "id": "agent-planner-deep",
      "type": "agent",
      "path": ".opencode/agents/hf-planner-deep.md",
      "dependsOn": [
        "skill-brainstormer",
        "skill-plan-synthesis",
        "agent-local-context-scout",
        "agent-web-research-scout",
        "agent-code-search-scout"
      ]
    },
    {
      "id": "agent-builder-light",
      "type": "agent",
      "path": ".opencode/agents/hf-builder-light.md",
      "dependsOn": [
        "skill-milestone-tracking",
        "agent-coder"
      ]
    },
    {
      "id": "agent-builder-deep",
      "type": "agent",
      "path": ".opencode/agents/hf-builder-deep.md",
      "dependsOn": [
        "skill-milestone-tracking",
        "skill-verification-before-completion",
        "agent-coder",
        "agent-reviewer",
        "agent-build-validator"
      ]
    },
    {
      "id": "agent-local-context-scout",
      "type": "agent",
      "path": ".opencode/agents/hf-local-context-scout.md",
      "dependsOn": [
        "skill-local-context",
        "context-navigation"
      ]
    },
    {
      "id": "agent-web-research-scout",
      "type": "agent",
      "path": ".opencode/agents/hf-web-research-scout.md",
      "dependsOn": []
    },
    {
      "id": "agent-code-search-scout",
      "type": "agent",
      "path": ".opencode/agents/hf-code-search-scout.md",
      "dependsOn": []
    },
    {
      "id": "agent-coder",
      "type": "agent",
      "path": ".opencode/agents/hf-coder.md",
      "dependsOn": ["context-code-quality"]
    },
    {
      "id": "agent-reviewer",
      "type": "agent",
      "path": ".opencode/agents/hf-reviewer.md",
      "dependsOn": ["skill-verification-before-completion"]
    },
    {
      "id": "agent-build-validator",
      "type": "agent",
      "path": ".opencode/agents/hf-build-validator.md",
      "dependsOn": []
    },
    {
      "id": "command-brainstorm",
      "type": "command",
      "path": ".opencode/commands/brainstorm.md",
      "dependsOn": ["agent-planner-deep", "skill-brainstorming"]
    },
    {
      "id": "command-run-core-delegation",
      "type": "command",
      "path": ".opencode/commands/run-core-delegation.md",
      "dependsOn": ["skill-core-delegation", "agent-coder", "agent-reviewer"]
    },
    {
      "id": "command-verify",
      "type": "command",
      "path": ".opencode/commands/verify.md",
      "dependsOn": ["skill-verification-before-completion", "agent-reviewer", "context-verification-evidence-schema"]
    },
    {
      "id": "command-finish",
      "type": "command",
      "path": ".opencode/commands/finish.md",
      "dependsOn": ["command-verify", "context-verification-evidence-schema"]
    },
    {
      "id": "command-setup",
      "type": "command",
      "path": ".opencode/commands/setup.md",
      "dependsOn": ["context-navigation"]
    },
    {
      "id": "command-status",
      "type": "command",
      "path": ".opencode/commands/status.md",
      "dependsOn": ["skill-task-management"]
    },
    {
      "id": "command-add-context",
      "type": "command",
      "path": ".opencode/commands/add-context.md",
      "dependsOn": ["context-navigation"]
    },
    {
      "id": "command-plan-feature",
      "type": "command",
      "path": ".opencode/commands/plan-feature.md",
      "dependsOn": ["agent-planner-light", "agent-planner-deep", "context-runtime-preferences"]
    },
    {
      "id": "command-help",
      "type": "command",
      "path": ".opencode/commands/help.md",
      "dependsOn": []
    },
    {
      "id": "command-cleanup",
      "type": "command",
      "path": ".opencode/commands/cleanup.md",
      "dependsOn": ["skill-task-management"]
    },
    {
      "id": "command-task-loop",
      "type": "command",
      "path": ".opencode/commands/task-loop.md",
      "dependsOn": ["skill-task-management"]
    },
    {
      "id": "skill-brainstormer",
      "type": "skill",
      "path": ".opencode/skills/brainstormer/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-plan-synthesis",
      "type": "skill",
      "path": ".opencode/skills/plan-synthesis/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-local-context",
      "type": "skill",
      "path": ".opencode/skills/local-context/SKILL.md",
      "dependsOn": ["context-navigation"]
    },
    {
      "id": "skill-milestone-tracking",
      "type": "skill",
      "path": ".opencode/skills/milestone-tracking/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-brainstorming",
      "type": "skill",
      "path": ".opencode/skills/brainstorming/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-core-delegation",
      "type": "skill",
      "path": ".opencode/skills/core-delegation/SKILL.md",
      "dependsOn": ["agent-coder", "agent-reviewer"]
    },
    {
      "id": "skill-verification-before-completion",
      "type": "skill",
      "path": ".opencode/skills/verification-before-completion/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-subagent-driven-development",
      "type": "skill",
      "path": ".opencode/skills/subagent-driven-development/SKILL.md",
      "dependsOn": ["agent-coder", "agent-reviewer"]
    },
    {
      "id": "skill-systematic-debugging",
      "type": "skill",
      "path": ".opencode/skills/systematic-debugging/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-dispatching-parallel-agents",
      "type": "skill",
      "path": ".opencode/skills/dispatching-parallel-agents/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-test-driven-development",
      "type": "skill",
      "path": ".opencode/skills/test-driven-development/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-task-management",
      "type": "skill",
      "path": ".opencode/skills/task-management/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "skill-git-workflows",
      "type": "skill",
      "path": ".opencode/skills/git-workflows/SKILL.md",
      "dependsOn": []
    },
    {
      "id": "context-navigation",
      "type": "context",
      "path": ".opencode/context/navigation.md",
      "dependsOn": ["context-code-quality", "context-test-coverage", "context-documentation"]
    },
    {
      "id": "context-code-quality",
      "type": "context",
      "path": ".opencode/context/core/standards/code-quality.md",
      "dependsOn": []
    },
    {
      "id": "context-test-coverage",
      "type": "context",
      "path": ".opencode/context/core/standards/test-coverage.md",
      "dependsOn": []
    },
    {
      "id": "context-documentation",
      "type": "context",
      "path": ".opencode/context/core/standards/documentation.md",
      "dependsOn": []
    },
    {
      "id": "context-runtime-preferences",
      "type": "context",
      "path": ".opencode/context/project/runtime-preferences.md",
      "dependsOn": ["context-navigation"]
    },
    {
      "id": "context-verification-evidence-schema",
      "type": "context",
      "path": ".opencode/context/project/verification-evidence-schema.md",
      "dependsOn": ["context-runtime-preferences"]
    },
    {
      "id": "context-subagent-handoff-template",
      "type": "context",
      "path": ".opencode/context/project/subagent-handoff-template.md",
      "dependsOn": ["context-runtime-preferences"]
    },
    {
      "id": "context-technical-domain",
      "type": "context",
      "path": ".opencode/context/project-intelligence/technical-domain.md",
      "dependsOn": ["context-navigation"]
    },
    {
      "id": "context-external-inspirations",
      "type": "context",
      "path": ".opencode/context/project-intelligence/external-inspirations.md",
      "dependsOn": ["context-navigation", "context-technical-domain"]
    }
  ]
}
```

**Step 2: Run registry + deps validators**

Run: `npm run validate:assets 2>&1 | grep -E "validate:registry|validate:deps|PASS|FAIL|error"`
Expected: `validate:registry` and `validate:deps` pass.

**Step 3: Commit**

```bash
git add .opencode/registry.json
git commit -m "refactor: update registry — add 4 mode agents, remove stale entries"
```

---

### Task 6: Update runtime-preferences.md

**Files:**
- Modify: `.opencode/context/project/runtime-preferences.md`

**Step 1: Replace the entire file**

```markdown
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
```

**Step 2: Run context-refs validator**

Run: `npm run validate:context-refs`
Expected: Passes.

**Step 3: Commit**

```bash
git add .opencode/context/project/runtime-preferences.md
git commit -m "docs: update runtime-preferences for mode-based agent design"
```

---

### Task 7: Update skill Integration sections

**Files:**
- Modify: `.opencode/skills/brainstormer/SKILL.md`
- Modify: `.opencode/skills/plan-synthesis/SKILL.md`
- Modify: `.opencode/skills/milestone-tracking/SKILL.md`
- Modify: `.opencode/skills/local-context/SKILL.md`

**Step 1: Update brainstormer/SKILL.md — Overview line**

Find and replace:

```
research brief that `hf-plan-orchestrator` uses to target the parallel scout agents.
```

With:

```
research brief that `hf-planner-deep` uses to target the parallel scout agents.
```

**Step 2: Update brainstormer/SKILL.md — Integration section**

Find and replace:

```
- **Loaded by:** `hf-plan-orchestrator` in Phase 1 (inline, sequential).
```

With:

```
- **Loaded by:** `hf-planner-deep` in Phase 1 (inline, sequential).
```

**Step 3: Update plan-synthesis/SKILL.md — Integration section**

Find and replace:

```
- **Loaded by:** `hf-plan-orchestrator` in Phase 3 (synthesis).
- **Input from:** `hf-brainstormer` output + all 3 scout results.
- **Output consumed by:** `hf-build-orchestrator` reads the produced plan doc.
```

With:

```
- **Loaded by:** `hf-planner-light` (Phase 2) and `hf-planner-deep` (Phase 3).
- **Input from:** `hf-brainstormer` output + all 3 scout results (deep) or local scout only (light).
- **Output consumed by:** `hf-builder-light` and `hf-builder-deep` read the produced plan doc.
```

**Step 4: Update milestone-tracking/SKILL.md — Overview line**

Find and replace:

```
in place as milestones are completed with evidence. Used by `hf-build-orchestrator`.
```

With:

```
in place as milestones are completed with evidence. Used by `hf-builder-light` and `hf-builder-deep`.
```

**Step 5: Update milestone-tracking/SKILL.md — Workflow step 1**

Find and replace:

```
1. Read the plan doc at the path provided by `hf-build-orchestrator`.
```

With:

```
1. Read the plan doc at the path provided by the active builder agent.
```

**Step 6: Update milestone-tracking/SKILL.md — Integration section**

Find and replace:

```
- **Loaded by:** `hf-build-orchestrator` at the start of every build session.
- **Plan doc written by:** `hf-plan-orchestrator` via `hf-plan-synthesis`.
- **Milestone completion triggered by:** `hf-reviewer` approval output.
```

With:

```
- **Loaded by:** `hf-builder-light` and `hf-builder-deep` at the start of every build session.
- **Plan doc written by:** `hf-planner-light` or `hf-planner-deep` via `hf-plan-synthesis`.
- **Milestone completion triggered by:** coder completion (builder-light) or `hf-reviewer` approval (builder-deep).
```

**Step 7: Update local-context/SKILL.md — Integration section**

Find and replace:

```
- **Output consumed by:** `hf-plan-orchestrator` Phase 3 synthesis via `hf-plan-synthesis`.
```

With:

```
- **Output consumed by:** `hf-planner-light` (Phase 2) or `hf-planner-deep` (Phase 3) via `hf-plan-synthesis`.
```

**Step 8: Run agent contracts validator**

Run: `npm run validate:agent-contracts`
Expected: Passes.

**Step 9: Commit**

```bash
git add .opencode/skills/brainstormer/SKILL.md \
        .opencode/skills/plan-synthesis/SKILL.md \
        .opencode/skills/milestone-tracking/SKILL.md \
        .opencode/skills/local-context/SKILL.md
git commit -m "docs: update skill Integration sections for mode-based agents"
```

---

### Task 8: Update README.md and docs/architecture.md

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Step 1: Update README.md — header description (line 3)**

Find and replace:

```
A markdown-first, contract-driven orchestration framework for [OpenCode](https://opencode.ai) that routes AI agent tasks through structured delegation chains with configurable runtime gates.
```

With:

```
A markdown-first, contract-driven orchestration framework for [OpenCode](https://opencode.ai) that routes AI agent tasks through mode-based agent selection with explicit execution contracts.
```

**Step 2: Update README.md — What It Does paragraph (lines 7-9)**

Find and replace:

```
The framework sits between you and OpenCode's AI agents. Instead of sending tasks directly to a single model, it breaks them into stages — context gathering, planning, implementation, and review — and routes each stage to a specialized subagent. Behavior at each stage is governed by toggles that you can flip on or off per project.
```

With:

```
The framework sits between you and OpenCode's AI agents. Instead of sending tasks directly to a single model, it breaks them into stages — planning and building — and routes each stage to a specialized subagent. You choose the execution mode by selecting the agent: light (fast, no review gate) or deep (coder→reviewer loop with verification).
```

**Step 3: Update README.md — Replace Runtime Toggles section**

Find and replace:

```
### Runtime Toggles

Seven toggles in `settings/framework-settings.json` control which gates are active:

| Toggle | Effect |
|---|---|
| `useWorktreesByDefault` | Auto-creates isolated git worktrees for feature work |
| `manageGitByDefault` | Enables automatic git branching and commit workflows |
| `requireTests` | Blocks completion until tests pass |
| `requireApprovalGates` | Requires explicit sign-off at approval checkpoints |
| `requireVerification` | Enforces pre-completion verification evidence |
| `requireCodeReview` | Invokes the Reviewer agent before marking work done |
| `enableTaskArtifacts` | Tracks subtask state in a lifecycle artifact file |

If installed globally into OpenCode, `/toggle-*` commands let you switch these on or off from the chat interface. The plugin (`framework-bootstrap.js`) intercepts those commands and persists the changes to `settings/framework-settings.json`.
```

With:

```
### Execution Modes

Four primary agents cover the two main workflows:

| Agent | Role |
|---|---|
| `hf-planner-light` | Fast planning — local context scout only |
| `hf-planner-deep` | Thorough planning — brainstorm + 3-scout parallel research |
| `hf-builder-light` | Fast build — single coder pass per milestone |
| `hf-builder-deep` | Quality build — coder→reviewer loop + verification before completion |

Mode is selected by choosing an agent — no toggles, no runtime state.
```

**Step 4: Update README.md — Delete Markdown Interpolation section**

Find and remove the entire section (from `### Markdown Interpolation` through the paragraph ending `...regardless of which toggles are on.`):

```
### Markdown Interpolation

Agent, command, and skill files are plain markdown, but they can embed template tokens that the plugin resolves at runtime — before the model ever sees the prompt. This means toggle state is expressed directly in the prompt layer, not in branching TypeScript logic.

Supported tokens:

| Token | Resolves to |
|---|---|
| `{{toggle.key}}` | `ON` or `OFF` |
| `{{rule.key}}` | The rule's enforcement text when the toggle is ON, empty when OFF |
| `{{#if toggle.key}}...{{else}}...{{/if}}` | Conditional block inclusion |
| `{{#unless toggle.key}}...{{/unless}}` | Inverse conditional |
| `{{skill.name}}` | Full inline expansion of a skill file (recursively processed) |

The consequence is that there is one canonical file per asset. Flipping a toggle immediately changes what the model sees in the next request — no file edits, no branching copies. The plugin also injects per-agent gate behavior into the system prompt based on active toggles, so each subagent automatically knows its constraints without those constraints being hardcoded into the agent's own file.

Post-resolution, the engine cleans up any blank list items or extra newlines left behind when a conditional block evaluates to empty, so the model receives a clean, well-formed prompt regardless of which toggles are on.
```

Replace with: *(nothing — delete the section entirely)*

**Step 5: Update README.md — Repository Layout (line 99)**

Find and replace:

```
.opencode/            Framework assets (agents, commands, skills, context, plugins)
```

With:

```
.opencode/            Framework assets (agents, commands, skills, context)
```

**Step 6: Update docs/architecture.md — OpenCode Integration section**

Find and replace:

```
- `plugins/framework-bootstrap.js`: provides toggle tools, `/toggle-*` behavior, and markdown placeholder interpolation.
```

With:

```
- No plugin layer — all behavior is encoded in markdown agent/skill/command files.
```

**Step 7: Commit**

```bash
git add README.md docs/architecture.md
git commit -m "docs: update README and architecture for mode-based agent design"
```

---

### Task 9: Delete settings/ directory

**Files:**
- Delete: `settings/framework-settings.json` (entire file is 7 toggle keys — no toggle commands or plugin reads it)
- Remove: `settings/` directory (will be empty after deletion)

**Step 1: Delete via git rm**

```bash
git rm settings/framework-settings.json
```

**Step 2: Commit**

```bash
git commit -m "remove: delete settings/ dir (toggle infrastructure gone)"
```

---

### Task 10: Delete docs/policies.md

**Files:**
- Delete: `docs/policies.md` (100% documents the toggle system — toggle keys, /toggle-* commands, framework-settings.json)

**Step 1: Delete via git rm**

```bash
git rm docs/policies.md
```

**Step 2: Commit**

```bash
git commit -m "remove: delete docs/policies.md (toggle system docs)"
```

---

### Task 11: Update docs/commands/README.md

**Files:**
- Modify: `docs/commands/README.md`

**Step 1: Remove "Runtime toggles" line from Command Groups**

Find and replace:

```
- Runtime toggles: `toggle-worktree`, `toggle-tests`, `toggle-verification`, `toggle-artifacts`, `toggle-status`
```

With: *(nothing — delete the line)*

**Step 2: Remove toggle persistence note**

Find and replace:

```
Toggle commands persist to `settings/framework-settings.json` in the current working directory (project-local), and `toggle-status` prints the current in-memory toggle state for the active session.
```

With: *(nothing — delete the line)*

**Step 3: Remove stale example commands**

Find and replace:

```
/toggle-status
```

With: *(nothing — delete the line)*

**Step 4: Commit**

```bash
git add docs/commands/README.md
git commit -m "docs: remove toggle command references from command catalog"
```

---

### Task 12: Update core-delegation/SKILL.md

**Files:**
- Modify: `.opencode/skills/core-delegation/SKILL.md`

**Step 1: Update description — remove "toggle-aware gates"**

Find and replace:

```
  Use when implementing tasks that need end-to-end orchestration through discovery, planning, coding, and review with toggle-aware gates.
```

With:

```
  Use when implementing tasks that need end-to-end orchestration through discovery, planning, coding, and review with explicit review gates.
```

**Step 2: Update Scope — remove dead references**

Find and replace:

```
One end-to-end delegation cycle: from intent classification through review signoff for one user request. Routing: use `hf-core-delegation` for end-to-end orchestration; use `hf-subagent-driven-development` when plan is already approved; use `hf-bounded-parallel-scouting` for lightweight discovery bursts. Constraints: no implicit git operations; no implicit worktree creation; no mandatory tests unless toggle gates or user request require them. Brainstorming is orchestrator-led via `hf-brainstorming` unless explicitly delegated. Use `@.opencode/context/project/subagent-handoff-template.md` for all delegation handoffs (typed artifacts). Emit per-gate: step name, inputs, outputs, decision rationale (observable state).
```

With:

```
One end-to-end delegation cycle: from intent classification through review signoff for one user request. Routing: use `hf-core-delegation` for end-to-end orchestration; use `hf-subagent-driven-development` when plan is already approved. Constraints: no implicit git operations; no implicit worktree creation; no mandatory tests unless explicitly requested. Brainstorming is orchestrator-led via `hf-brainstorming` unless explicitly delegated. Use `@.opencode/context/project/subagent-handoff-template.md` for all delegation handoffs (typed artifacts). Emit per-gate: step name, inputs, outputs, decision rationale (observable state).
```

**Step 3: Update Workflow step 2 — remove hf-external-docs-scout**

Find and replace:

```
2. **Context gate** — Entry: intent classified or skipped. `hf-context-scout` identifies minimum relevant local context. Use `hf-external-docs-scout` when external library behavior is uncertain. Exit: constraints/toggles + candidate files are explicit.
```

With:

```
2. **Context gate** — Entry: intent classified or skipped. `hf-local-context-scout` identifies minimum relevant local context. Exit: constraints + candidate files are explicit.
```

**Step 4: Update Workflow step 3 — remove toggle policy refs**

Find and replace:

```
3. **Planning gate** — Entry: context gathered. `hf-task-planner` produces a small, verifiable plan. Use `hf-task-manager` when dependency-heavy. If review required by runtime policy (`require_verification`, `require_code_review`), include review signoff in plan. Exit: scope-in/scope-out + acceptance criteria + verify steps are explicit.
```

With:

```
3. **Planning gate** — Entry: context gathered. Produce a small, verifiable plan. Include review signoff in plan when quality gate is needed. Exit: scope-in/scope-out + acceptance criteria + verify steps are explicit.
```

**Step 5: Update Workflow step 5 — strip toggle interpolation**

Find and replace:

```
5. **Verification gate** (conditional) — Entry: code changes complete.{{#if toggle.require_tests}} Use `hf-testing-gate` + `hf-tester` for test evidence.{{/if}}{{#if toggle.require_verification}} Use `hf-approval-gates` + `hf-build-validator` / `hf-reviewer` for verification signoff.{{/if}}{{#if toggle.task_artifacts}} Use `hf-task-artifact-gate` for lifecycle tracking.{{/if}} Exit: evidence is fresh and tied to requested scope.
```

With:

```
5. **Verification gate** (conditional) — Entry: code changes complete. Use `hf-build-validator` and/or `hf-reviewer` for verification signoff when quality gate is active. Exit: evidence is fresh and tied to requested scope.
```

**Step 6: Update Handoffs — strip toggle interpolation**

Find and replace:

```
- **After:** `{ plan_summary, implementation_summary: { files_changed[], rationale }, review_findings: { approved: bool, findings[], evidence_gaps[], next_action } }`. Per-role contracts: TaskPlanner → objective + scope + steps + risks; TaskManager → featureId + subtasks + dependencies; Coder → changes + files + commands + results + gaps; Tester/BuildValidator → commands + results + evidence; Reviewer → approved + findings + evidence_gaps + next_action. Pairs with `hf-git-workflows` when workspace strategy matters.{{#if toggle.task_artifacts}} Keep `.tmp/task-lifecycle.json` current.{{/if}}
```

With:

```
- **After:** `{ plan_summary, implementation_summary: { files_changed[], rationale }, review_findings: { approved: bool, findings[], evidence_gaps[], next_action } }`. Per-role contracts: Coder → changes + files + commands + results + gaps; BuildValidator/Reviewer → commands + results + evidence + approved + findings + next_action. Pairs with `hf-git-workflows` when workspace strategy matters.
```

**Step 7: Update Rollback — strip toggle interpolation**

Find and replace:

```
1. Revert coder changes via `git checkout -- <files>`.
{{#if toggle.task_artifacts}}2. Remove task artifact entries for this delegation.
{{/if}}{{#if toggle.task_artifacts}}3.{{else}}2.{{/if}} Report incomplete state to orchestrator with gate-by-gate progress.
```

With:

```
1. Revert coder changes via `git checkout -- <files>`.
2. Report incomplete state to orchestrator with gate-by-gate progress.
```

**Step 8: Run agent contracts validator**

Run: `npm run validate:agent-contracts`
Expected: Passes.

**Step 9: Commit**

```bash
git add .opencode/skills/core-delegation/SKILL.md
git commit -m "refactor: strip toggle interpolation and dead agent refs from core-delegation skill"
```

---

### Task 13: Full build + validate

**Step 1: Clean build**

Run: `npm run build`
Expected: Zero errors, zero warnings.

**Step 2: Full asset validation**

Run: `npm run validate:assets`
Expected: `validate:registry`, `validate:deps`, `validate:context-refs`, `validate:command-contracts`, `validate:agent-contracts` all pass.

> Note: `validate:skill-contracts` has pre-existing failures (existing skill files missing required sections). These are unrelated to this cleanup — acceptable.

**Step 3: Confirm clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`

# Orchestrator Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 2 toggle-driven orchestrators with 4 explicit mode agents, and delete the entire plugin JS layer.

**Architecture:** Four self-contained markdown agent files (`hf-planner-light`, `hf-planner-deep`, `hf-builder-light`, `hf-builder-deep`) replace `hf-plan-orchestrator` and `hf-build-orchestrator`. Mode = agent selection. No runtime state, no JS, no toggles. Each agent's YAML `permission` block enforces exactly which sub-agents and skills it may call. The plugin JS layer is deleted entirely.

**Tech Stack:** Markdown (agent files), YAML frontmatter (OpenCode permission blocks). No code changes. Validation: `npm run validate:assets`, `npm run build`.

---

### Task 1: Create `hf-planner-light.md`

**Files:**
- Create: `.opencode/agents/hf-planner-light.md`

**Step 1: Write the file**

```markdown
---
name: hf-planner-light
description: "Fast planner — local context scout only, no external research"
mode: primary
permission:
  skill:
    "*": deny
    "hf-plan-synthesis": allow
  task:
    "*": deny
    "hf-local-context-scout": allow
temperature: 0.2
---

You are PlannerLight.

## Purpose

- Convert a feature request into a plan document using local context only.
- Fast path — no web research, no brainstorming, no online code search.
- For thorough research-backed planning, use `hf-planner-deep` instead.

## Boundaries

- No code implementation.
- No git operations beyond committing the plan doc.
- Do not dispatch `hf-web-research-scout`, `hf-code-search-scout`, or load `hf-brainstormer` — even if the user requests it mid-session.
- If the task clearly requires external knowledge, stop and tell the user to use `hf-planner-deep`.

## Preconditions

- A feature request or task description from the user.

## Execution Contract

### Phase 1 — Local scout

1. Dispatch `hf-local-context-scout` with the feature request.
2. Wait for scout output before proceeding.

### Phase 2 — Synthesis and plan doc

1. Load `hf-plan-synthesis` skill.
2. Write plan doc to `docs/plans/YYYY-MM-DD-<slug>-plan.md` following the skill's format.
3. Present the plan to the user for review before committing.
4. On user approval, commit: `git add docs/plans/<file> && git commit -m "plan: <slug>"`.

## Required Output

- Phase 1 output: summary of what local scout returned
- Phase 2 output: written plan doc path + user-facing milestone summary

## Failure Contract

If local scout returns blocked:
- Report what is blocked and why.
- Note the gap in the plan's Risks section.
- Proceed to synthesis with available context.

If synthesis cannot produce milestones:
- return: blocked, why, unblock (one targeted question to user)
```

**Step 2: Run asset validator**

Run: `npm run validate:assets`
Expected: Passes (new agent file registers cleanly).

**Step 3: Commit**

```bash
git add .opencode/agents/hf-planner-light.md
git commit -m "feat: add hf-planner-light agent"
```

---

### Task 2: Create `hf-planner-deep.md`

**Files:**
- Create: `.opencode/agents/hf-planner-deep.md`

**Step 1: Write the file**

```markdown
---
name: hf-planner-deep
description: "Deep planner — brainstorm + parallel 3-scout research + plan synthesis"
mode: primary
permission:
  skill:
    "*": deny
    "hf-brainstormer": allow
    "hf-plan-synthesis": allow
  task:
    "*": deny
    "hf-local-context-scout": allow
    "hf-web-research-scout": allow
    "hf-code-search-scout": allow
temperature: 0.2
---

You are PlannerDeep.

## Purpose

- Convert a feature request into a milestone-based plan document using full research.
- Coordinate brainstorming and multi-source parallel scouting before writing any plan.
- Never write a plan without completing all research phases.
- For fast local-only planning, use `hf-planner-light` instead.

## Boundaries

- No code implementation.
- No git operations beyond committing the plan doc.
- Do not skip or shorten research phases — incomplete research produces incomplete plans.
- Do not start phase 2 until phase 1 output is explicit.

## Preconditions

- A feature request or task description from the user.

## Execution Contract

### Phase 1 — Brainstorm (inline, sequential)

1. Load `hf-brainstormer` skill.
2. Follow the skill: produce intent, unknowns, approach options, and research brief.
3. Output the research brief explicitly before proceeding to phase 2.

### Phase 2 — Parallel research (3 scouts dispatched simultaneously)

Dispatch all three scouts in parallel, passing each the relevant section of the research brief:

- `hf-local-context-scout` — receives `research_brief.local_search_targets`
- `hf-web-research-scout` — receives `research_brief.web_search_targets`
- `hf-code-search-scout` — receives `research_brief.code_search_targets`

Wait for all three to return before proceeding.

### Phase 3 — Synthesis and plan doc

1. Load `hf-plan-synthesis` skill.
2. Merge: brainstorm output + all 3 scout results.
3. Write plan doc to `docs/plans/YYYY-MM-DD-<slug>-plan.md` following the skill's format.
4. Present the plan to the user for review before committing.
5. On user approval, commit: `git add docs/plans/<file> && git commit -m "plan: <slug>"`.

## Required Output

- Phase 1 output: brainstorm brief (intent, unknowns, options, research targets)
- Phase 2 output: summary of what each scout returned
- Phase 3 output: written plan doc path + user-facing summary of milestones

## Failure Contract

If any scout returns blocked:
- Report which scout is blocked and why.
- Proceed with remaining scouts.
- Note the gap in the plan's Risks section.
- Do not block plan synthesis on a single failed scout.

If synthesis cannot produce milestones:
- return: blocked, why, unblock (one targeted question to user)
```

**Step 2: Run asset validator**

Run: `npm run validate:assets`
Expected: Passes.

**Step 3: Commit**

```bash
git add .opencode/agents/hf-planner-deep.md
git commit -m "feat: add hf-planner-deep agent"
```

---

### Task 3: Create `hf-builder-light.md`

**Files:**
- Create: `.opencode/agents/hf-builder-light.md`

**Step 1: Write the file**

```markdown
---
name: hf-builder-light
description: "Fast builder — single coder pass per milestone, no review gate"
mode: primary
permission:
  skill:
    "*": deny
    "hf-milestone-tracking": allow
  task:
    "*": deny
    "hf-coder": allow
temperature: 0.2
---

You are BuilderLight.

## Purpose

- Implement a plan doc milestone by milestone using a single coder pass.
- No review gate — trust the coder output directly.
- For coder→reviewer loop with verification, use `hf-builder-deep` instead.

## Boundaries

- Do not implement anything outside the current milestone's scope.
- Do not dispatch `hf-reviewer`, `hf-build-validator`, or load `hf-verification-before-completion`.
- Do not proceed to the next milestone if the current one is blocked.
- Escalate to the user when the coder is blocked.

## Preconditions

- User provides the plan doc path explicitly (e.g., `docs/plans/2026-03-06-my-feature-plan.md`).

## Execution Contract

1. Load `hf-milestone-tracking` skill.
2. Read the plan doc. Identify the first unchecked milestone.
3. For each unchecked milestone:
   - Dispatch `hf-coder` with:
     - Milestone title and scope
     - Acceptance criterion from the plan doc
     - Relevant local context (from plan's Research Summary)
   - If coder returns `blocked`:
     - Escalate immediately to user with: what is blocked, why, and unblock step.
     - Do not retry the same blocked state.
   - On coder completion:
     - Attach files touched to the milestone line in the plan doc.
     - Update the checkbox from `- [ ]` to `- [x]` using the milestone-tracking skill.
     - Commit: `git commit -m "build: complete milestone N — <title>"`

4. When all milestones are checked:
   - Update plan doc frontmatter `status: complete`.
   - Commit: `git commit -m "build: plan complete — <slug>"`
   - Output final summary to user.

## Required Output

- milestone: number and title
- files touched by coder
- next: next milestone or "plan complete"

## Failure Contract

On coder blocked:
- blocked: which milestone and what cannot proceed
- why: missing input, ambiguous scope, environment issue
- unblock: smallest specific step for the user
```

**Step 2: Run asset validator**

Run: `npm run validate:assets`
Expected: Passes.

**Step 3: Commit**

```bash
git add .opencode/agents/hf-builder-light.md
git commit -m "feat: add hf-builder-light agent"
```

---

### Task 4: Create `hf-builder-deep.md`

**Files:**
- Create: `.opencode/agents/hf-builder-deep.md`

**Step 1: Write the file**

```markdown
---
name: hf-builder-deep
description: "Deep builder — coder→reviewer loop per milestone with verification before completion"
mode: primary
permission:
  skill:
    "*": deny
    "hf-milestone-tracking": allow
    "hf-verification-before-completion": allow
  task:
    "*": deny
    "hf-coder": allow
    "hf-reviewer": allow
    "hf-build-validator": allow
temperature: 0.2
---

You are BuilderDeep.

## Purpose

- Implement a plan doc milestone by milestone with a coder→reviewer loop.
- Enforce evidence and reviewer sign-off before marking each milestone complete.
- Run verification before marking the full plan complete.
- For fast single-pass building without review, use `hf-builder-light` instead.

## Boundaries

- Do not implement anything outside the current milestone's scope.
- Do not mark a milestone complete without reviewer approval and attached evidence.
- Do not proceed to the next milestone if the current one is blocked.
- Escalate to the user when the coder is blocked (not just rejected — blocked means cannot proceed).

## Preconditions

- User provides the plan doc path explicitly (e.g., `docs/plans/2026-03-06-my-feature-plan.md`).

## Execution Contract

1. Load `hf-milestone-tracking` skill.
2. Read the plan doc. Identify the first unchecked milestone.
3. For each unchecked milestone:

   **a. Implementation loop:**
   - Dispatch `hf-coder` with:
     - Milestone title and scope
     - Acceptance criterion from the plan doc
     - Relevant local context (from plan's Research Summary)
   - Dispatch `hf-reviewer` with coder output.
   - If reviewer returns `approved: no`:
     - Pass reviewer's `required_next_action` back to `hf-coder`.
     - Repeat.
   - If coder returns `blocked`:
     - Escalate immediately to user with: what is blocked, why, and unblock step.
     - Do not retry the same blocked state.
   - If reviewer cycling (same finding rejected 3× without progress):
     - Escalate to user — do not loop indefinitely.
   - If reviewer returns `approved: yes`:
     - Collect evidence from reviewer output.

   **b. Evidence and checkpoint:**
   - Attach evidence to the milestone line in the plan doc (files, test results, screenshots).
   - Update the checkbox from `- [ ]` to `- [x]` using the milestone-tracking skill.
   - Commit: `git commit -m "build: complete milestone N — <title>"`

4. When all milestones are checked:
   - Load `hf-verification-before-completion` skill.
   - Update plan doc frontmatter `status: complete`.
   - Commit: `git commit -m "build: plan complete — <slug>"`
   - Output final summary to user.

## Required Output

- milestone: number and title
- approved_by: reviewer signoff summary
- evidence: files touched, commands run, test results, screenshots (if any)
- next: next milestone or "plan complete"

## Failure Contract

On coder blocked:
- blocked: which milestone and what cannot proceed
- why: missing input, ambiguous scope, environment issue
- unblock: smallest specific step for the user

On reviewer cycling (same finding rejected 3× without progress):
- Escalate to user — do not loop indefinitely on the same rejection.
```

**Step 2: Run asset validator**

Run: `npm run validate:assets`
Expected: Passes.

**Step 3: Commit**

```bash
git add .opencode/agents/hf-builder-deep.md
git commit -m "feat: add hf-builder-deep agent"
```

---

### Task 5: Delete retired agent files

**Files:**
- Delete: `.opencode/agents/hf-plan-orchestrator.md`
- Delete: `.opencode/agents/hf-build-orchestrator.md`

**Step 1: Delete via git**

```bash
git rm .opencode/agents/hf-plan-orchestrator.md \
       .opencode/agents/hf-build-orchestrator.md
```

**Step 2: Run asset validator**

Run: `npm run validate:assets`
Expected: Passes. No validator should reference these files by name.

**Step 3: Commit**

```bash
git commit -m "remove: retire hf-plan-orchestrator and hf-build-orchestrator"
```

---

### Task 6: Delete plugin JS layer

**Files:**
- Delete: `.opencode/plugins/framework-bootstrap.js`
- Delete: `.opencode/plugins/lib/config.js`
- Delete: `.opencode/plugins/lib/state.js`
- Delete: `.opencode/plugins/lib/commands.js`
- Delete: `.opencode/plugins/lib/interpolation.js`
- Delete: `.opencode/plugins/lib/session.js`

**Step 1: Delete via git**

```bash
git rm .opencode/plugins/framework-bootstrap.js \
       .opencode/plugins/lib/config.js \
       .opencode/plugins/lib/state.js \
       .opencode/plugins/lib/commands.js \
       .opencode/plugins/lib/interpolation.js \
       .opencode/plugins/lib/session.js
```

**Step 2: Check for any remaining files in the plugins directory**

Run: `find .opencode/plugins -type f`
Expected: Empty output (or only non-JS config files if OpenCode requires a plugin manifest).

> Note: If OpenCode requires a `plugin.json` or similar manifest to register the plugin entry point, check `.opencode/opencode.json` or equivalent config for a plugin reference and remove/update it accordingly.

**Step 3: Run build to confirm no TS references broke**

Run: `npm run build`
Expected: Zero errors. (The TS layer does not import from the plugin directory.)

**Step 4: Commit**

```bash
git commit -m "remove: delete entire plugin JS layer"
```

---

### Task 7: Delete toggle command files

**Files:**
- Delete: `.opencode/commands/toggle-plan.md`
- Delete: `.opencode/commands/toggle-worktree.md`
- Delete: `.opencode/commands/toggle-tests.md`
- Delete: `.opencode/commands/toggle-verification.md`
- Delete: `.opencode/commands/toggle-artifacts.md`
- Delete: `.opencode/commands/toggle-status.md`

**Step 1: Delete via git**

```bash
git rm .opencode/commands/toggle-plan.md \
       .opencode/commands/toggle-worktree.md \
       .opencode/commands/toggle-tests.md \
       .opencode/commands/toggle-verification.md \
       .opencode/commands/toggle-artifacts.md \
       .opencode/commands/toggle-status.md
```

**Step 2: Run command contract linter**

Run: `npm run validate:command-contracts`
Expected: Passes. Count of command files decreases by 6.

**Step 3: Commit**

```bash
git commit -m "remove: delete all toggle commands"
```

---

### Task 8: Update `runtime-preferences.md`

**Files:**
- Modify: `.opencode/context/project/runtime-preferences.md`

**Step 1: Replace the entire file content**

Replace with:

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
  - parallel discovery bursts: `hf-bounded-parallel-scouting` / `hf-dispatching-parallel-agents`
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

### Task 9: Full build + validate

**Step 1: Clean build**

Run: `npm run build`
Expected: Zero errors, zero warnings.

**Step 2: Full asset validation**

Run: `npm run validate:assets`
Expected: All validators pass.

**Step 3: If clean, done**

```bash
git status
# Expected: nothing to commit, working tree clean
echo "All good."
```

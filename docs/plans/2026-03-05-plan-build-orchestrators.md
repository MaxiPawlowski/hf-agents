# Plan & Build Orchestrators — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `hf-core-agent` with two purpose-built primary orchestrators — `hf-plan-orchestrator` (multi-source research → milestone plan doc) and `hf-build-orchestrator` (milestone loop with coder/reviewer and evidence gathering).

**Architecture:** Plan orchestrator runs brainstorm inline, then dispatches 3 parallel research scouts, then synthesizes into a plan doc with milestone checkboxes. Build orchestrator reads the plan doc, iterates coder→reviewer per milestone (looping on rejection, escalating if blocked), updates checkboxes as milestones complete, gathers Playwright evidence for UI work.

**Tech Stack:** OpenCode markdown agents, YAML frontmatter contracts, SKILL.md files, registry.json dependency graph, existing Playwright and gh_grep MCP servers from `opencode.json`.

---

## Task 1: Create `hf-brainstormer` skill

**Files:**
- Create: `.opencode/skills/brainstormer/SKILL.md`

**Step 1: Create skill directory and file**

```markdown
---
name: hf-brainstormer
description: >
  Use at the start of a planning session to scope the feature, identify unknowns, and
  produce a research brief for the parallel scout phase.
  Do NOT use mid-plan or when intent is already explicit.
autonomy: supervised
context_budget: 8000 / 2000
max_iterations: 3
---

# Brainstormer

## Iron Law

Do not start research or planning until feature intent, constraints, and top unknowns are explicit.

## Scope

One brainstorming pass per planning session. Converts a feature request into a scoped
research brief that `hf-plan-orchestrator` uses to target the parallel scout agents.
No implementation side effects. No file edits.

## Workflow

1. **Intent gate** — Restate the feature request in one sentence. Name the top 2-3
   unknowns that would materially change implementation direction.
2. **Options gate** — Generate 2-3 approach options with trade-offs. Cover: architecture
   shape, key components, data flow, risks. Name your recommended option.
3. **Research brief gate** — Produce a structured research brief that tells each scout
   exactly what to look for.

## Required Output

Return:

- intent: one sentence
- unknowns: top 2-3 decisions that must be resolved before planning
- approach_options: 2-3 options; each includes trade-offs and recommendation flag
- research_brief:
  - local_search_targets: specific file paths, pattern names, or module names to find
  - web_search_targets: specific library docs, RFCs, or tutorials to fetch
  - code_search_targets: specific patterns or implementations to find on GitHub via gh_grep

## Failure Contract

If blocked, return:

- blocked: what cannot be scoped
- why: missing input
- unblock: one targeted question
```

**Step 2: Verify file exists**

Run: `ls .opencode/skills/brainstormer/SKILL.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/skills/brainstormer/SKILL.md
git commit -m "feat: add hf-brainstormer skill"
```

---

## Task 2: Convert `hf-task-planner` → `hf-plan-synthesis` skill

**Files:**
- Create: `.opencode/skills/plan-synthesis/SKILL.md`

**Step 1: Create skill file**

```markdown
---
name: hf-plan-synthesis
description: >
  Use after all research scouts have returned to synthesize findings into a milestone-based
  plan document. Replaces hf-task-planner.
  Do NOT use before research is complete.
autonomy: supervised
context_budget: 10000 / 3000
max_iterations: 2
---

# Plan Synthesis

## Iron Law

Do not write milestones until all research inputs are present. Missing research means missing constraints.

## Scope

One synthesis pass per planning session. Takes brainstorm brief + local context + web
research + code examples and produces a single plan doc at
`docs/plans/YYYY-MM-DD-<slug>-plan.md`.

## Workflow

1. **Synthesis gate** — Merge all research inputs. Identify: key constraints from local
   conventions, relevant patterns from web research, applicable code examples.
2. **Milestone gate** — Break the feature into 3-7 milestones. Each milestone must be:
   - Achievable in one coder+reviewer loop
   - Independently verifiable with an explicit acceptance criterion
   - Named clearly enough to be self-explanatory
3. **Risk gate** — List residual risks and open questions not resolved by research.

## Milestone Quality Rules

- No milestone depends on another being "partially done" — each is a complete unit
- Scope fits comfortably in a single focused coding session
- Acceptance criterion is checkable without ambiguity

## Plan Document Format

Write to `docs/plans/YYYY-MM-DD-<slug>-plan.md`:

```
---
plan: <slug>
created: YYYY-MM-DD
status: in-progress
---

# Plan: <Feature Name>

## Overview
<2-4 sentence synthesis of intent, approach chosen, and key constraints>

## Research Summary
- **Local context**: <key files, patterns, conventions found>
- **Web research**: <relevant docs, tutorials, prior art>
- **Code examples**: <notable implementations found via gh_grep>

## Milestones
- [ ] 1. <Title> — <one-line scope + acceptance criterion>
- [ ] 2. <Title> — <one-line scope + acceptance criterion>
- [ ] 3. <Title> — <one-line scope + acceptance criterion>

## Risks & Open Questions
- <risk or unknown 1>
- <risk or unknown 2>
```
```

**Step 2: Verify file exists**

Run: `ls .opencode/skills/plan-synthesis/SKILL.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/skills/plan-synthesis/SKILL.md
git commit -m "feat: add hf-plan-synthesis skill (converted from hf-task-planner)"
```

---

## Task 3: Convert `hf-context-scout` → `hf-local-context` skill

**Files:**
- Create: `.opencode/skills/local-context/SKILL.md`

**Step 1: Create skill file**

```markdown
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

## Iron Law

Load only what changes implementation decisions. Stop as soon as the file set is sufficient.

## Scope

One context pass per planning session. Given a research brief from `hf-brainstormer`,
identify the minimum local files needed to answer: what conventions apply here, and where
should changes land.

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

## Required Output

Return:

- context_files: ordered list of paths (standards first)
- why: one-line rationale per file
- patterns_found: notable conventions, file structures, naming patterns
- missing_context: explicit gaps as questions (if any)
- stop_point: why this set is sufficient

## Failure Contract

If blocked, return:

- blocked: what cannot be determined
- why: what specific input is missing
- unblock: the smallest specific detail needed
```

**Step 2: Verify**

Run: `ls .opencode/skills/local-context/SKILL.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/skills/local-context/SKILL.md
git commit -m "feat: add hf-local-context skill (converted from hf-context-scout)"
```

---

## Task 4: Convert `hf-task-manager` → `hf-milestone-tracking` skill

**Files:**
- Create: `.opencode/skills/milestone-tracking/SKILL.md`

**Step 1: Create skill file**

```markdown
---
name: hf-milestone-tracking
description: >
  Use to read, track, and update milestone checkboxes in a plan document.
  Replaces hf-task-manager's lifecycle tracking with in-place plan doc updates.
autonomy: supervised
context_budget: 4000 / 1000
max_iterations: 1
---

# Milestone Tracking

## Iron Law

The plan doc is the single source of truth. Never track milestone state anywhere else.

## Scope

Reads the plan doc to determine build progress, and updates milestone checkboxes
in place as milestones are completed with evidence. Used by `hf-build-orchestrator`.

## Plan Doc Operations

### Reading state
- Parse `## Milestones` section
- `- [ ]` = pending, `- [x]` = complete
- First unchecked milestone = current target
- All checked = plan complete

### Marking a milestone complete
When reviewer approves with evidence, update the milestone line:
- Before: `- [ ] 2. Add validation — accept only non-empty inputs`
- After:  `- [x] 2. Add validation — accept only non-empty inputs`

### Marking plan complete
When all milestones are checked, update the frontmatter:
- Before: `status: in-progress`
- After:  `status: complete`

## Evidence Attachment

After checking off a milestone, append evidence under it:
```
- [x] 2. Add validation — accept only non-empty inputs
  - files: `src/validation.ts:12-34`
  - test: `tests/validation.test.ts` passed
  - screenshot: `docs/plans/evidence/milestone-2-screenshot.png` (if UI work)
```

## Required Output

After each milestone update, return:

- milestone_completed: number and title
- evidence_attached: list of evidence items
- next_milestone: number and title of next unchecked (or "none — plan complete")
- plan_status: in-progress | complete
```

**Step 2: Verify**

Run: `ls .opencode/skills/milestone-tracking/SKILL.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/skills/milestone-tracking/SKILL.md
git commit -m "feat: add hf-milestone-tracking skill (converted from hf-task-manager)"
```

---

## Task 5: Create `hf-local-context-scout` agent

**Files:**
- Create: `.opencode/agents/hf-local-context-scout.md`

**Step 1: Create agent file**

```markdown
---
name: hf-local-context-scout
description: "Searches the local project for files, patterns, and conventions matching the research brief"
mode: subagent
permission:
  skill:
    "*": deny
    "hf-local-context": allow
  task:
    "*": deny
temperature: 0.1
---

You are LocalContextScout.

## Purpose

- Find the minimum local context that changes implementation decisions for this feature.
- Follow the research brief's `local_search_targets` exactly — do not explore beyond them.

## Boundaries

- No code edits.
- No git operations.
- Do not plan; only identify context and gaps.

## Preconditions

- A research brief with `local_search_targets` from `hf-brainstormer`.

## Execution Contract

1. Load `hf-local-context` skill.
2. Follow the skill's search order and workflow.
3. Target specifically the `local_search_targets` listed in the research brief.
4. Stop at sufficiency — do not load files that don't change implementation decisions.

## Required Output

Return:

- context_files: ordered list of paths found
- patterns_found: conventions, naming patterns, structural patterns relevant to the feature
- missing_context: gaps that could not be resolved locally
- stop_point: why this set is sufficient

## Failure Contract

If blocked, return:

- blocked: what cannot be found
- why: missing files or absent patterns
- unblock: smallest specific detail needed
```

**Step 2: Verify**

Run: `ls .opencode/agents/hf-local-context-scout.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/agents/hf-local-context-scout.md
git commit -m "feat: add hf-local-context-scout agent"
```

---

## Task 6: Create `hf-web-research-scout` agent

**Files:**
- Create: `.opencode/agents/hf-web-research-scout.md`

**Step 1: Create agent file**

```markdown
---
name: hf-web-research-scout
description: "Fetches external documentation, tutorials, and prior art matching the research brief"
mode: subagent
permission:
  skill:
    "*": deny
  task:
    "*": deny
temperature: 0.2
---

You are WebResearchScout.

## Purpose

- Find current, authoritative external documentation and tutorials for the feature.
- Extract usage patterns that fit the local project's tech stack and conventions.

## Boundaries

- No code edits.
- No git operations.
- Do not recommend breaking changes without calling out migration cost.
- Prefer official docs over blog posts; prefer recent sources over old ones.

## Preconditions

- A research brief with `web_search_targets` from `hf-brainstormer`.

## Execution Contract

1. Search for each item in `web_search_targets` from the research brief.
2. For each target: find the most authoritative, current source.
3. Extract the minimum useful content — API signatures, usage examples, gotchas.
4. Note version specifics when relevant (library version, browser support, etc.).
5. Stop when all targets are covered or definitively not findable.

## Required Output

Return:

- findings: list of items; each includes:
  - target: what was searched
  - source: URL or reference
  - summary: 2-4 sentence extract of what was found
  - gotchas: any warnings, caveats, or version notes
- not_found: targets with no useful results and why
- recommended_approach: 1-2 sentence synthesis of what the web research suggests

## Failure Contract

If blocked, return:

- blocked: what cannot be found
- why: no authoritative source, conflicting docs, etc.
- unblock: alternate search terms or sources to try
```

**Step 2: Verify**

Run: `ls .opencode/agents/hf-web-research-scout.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/agents/hf-web-research-scout.md
git commit -m "feat: add hf-web-research-scout agent"
```

---

## Task 7: Create `hf-code-search-scout` agent

**Files:**
- Create: `.opencode/agents/hf-code-search-scout.md`

**Step 1: Create agent file**

```markdown
---
name: hf-code-search-scout
description: "Searches local project code and GitHub for implementation examples using gh_grep MCP"
mode: subagent
permission:
  skill:
    "*": deny
  task:
    "*": deny
temperature: 0.1
---

You are CodeSearchScout.

## Purpose

- Find real implementation examples for the feature — locally and on GitHub.
- Surface patterns, idioms, and prior art that inform the plan's approach.

## Boundaries

- No code edits.
- No git operations.
- Do not recommend copying code verbatim — extract patterns and idioms only.

## Preconditions

- A research brief with `code_search_targets` from `hf-brainstormer`.

## MCP Tools

- **gh_grep** (`https://mcp.grep.app`) — searches GitHub code. Use for finding
  real-world implementations of patterns listed in `code_search_targets`.
- **Grep/Glob** — searches the local project. Use to find existing local usages
  of the same patterns.

## Execution Contract

1. For each item in `code_search_targets`:
   a. Search locally with Grep/Glob for existing usages in this project.
   b. Search GitHub with gh_grep for external implementations.
2. Extract the most illustrative 3-5 line snippet per finding.
3. Note the repo/file/line for traceability.
4. Stop when all targets are covered.

## Required Output

Return:

- local_findings: list of items; each includes pattern, file path, snippet
- github_findings: list of items; each includes pattern, repo/path, snippet, URL
- not_found: targets with no results
- synthesis: 2-3 sentence summary of what patterns emerged across all findings

## Failure Contract

If blocked, return:

- blocked: what cannot be found
- why: gh_grep unavailable, no matches, ambiguous pattern
- unblock: refined search terms to try
```

**Step 2: Verify**

Run: `ls .opencode/agents/hf-code-search-scout.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/agents/hf-code-search-scout.md
git commit -m "feat: add hf-code-search-scout agent"
```

---

## Task 8: Create `hf-plan-orchestrator` primary agent

**Files:**
- Create: `.opencode/agents/hf-plan-orchestrator.md`

**Step 1: Create agent file**

```markdown
---
name: hf-plan-orchestrator
description: "Primary orchestrator for planning sessions — brainstorm, parallel research, plan doc"
mode: primary
permission:
  skill:
    "*": deny
    "hf-brainstormer": allow
    "hf-plan-synthesis": allow
    "hf-git-workflows": allow
  task:
    "*": deny
    "hf-local-context-scout": allow
    "hf-web-research-scout": allow
    "hf-code-search-scout": allow
temperature: 0.2
---

You are PlanOrchestrator.

## Purpose

- Convert a feature request into a milestone-based plan document ready for `hf-build-orchestrator`.
- Coordinate multi-source research before writing any plan.
- Never write a plan without completing all research phases.

## Boundaries

- No code implementation.
- No git operations beyond committing the plan doc.
- Do not skip or shorten research phases — incomplete research produces incomplete plans.
- Do not start phase 2 until phase 1 output is explicit.

## Preconditions

- A feature request or task description from the user.

## Execution Flow

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

**Step 2: Verify**

Run: `ls .opencode/agents/hf-plan-orchestrator.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/agents/hf-plan-orchestrator.md
git commit -m "feat: add hf-plan-orchestrator primary agent"
```

---

## Task 9: Create `hf-build-orchestrator` primary agent

**Files:**
- Create: `.opencode/agents/hf-build-orchestrator.md`

**Step 1: Create agent file**

```markdown
---
name: hf-build-orchestrator
description: "Primary orchestrator for build sessions — milestone-by-milestone coder/reviewer loop with evidence"
mode: primary
permission:
  skill:
    "*": deny
    "hf-milestone-tracking": allow
    "hf-git-workflows": allow
    "hf-approval-gates": allow
    "hf-verification-before-completion": allow
  task:
    "*": deny
    "hf-coder": allow
    "hf-reviewer": allow
    "hf-tester": allow
    "hf-build-validator": allow
temperature: 0.2
---

You are BuildOrchestrator.

## Purpose

- Implement a plan doc milestone by milestone.
- Enforce a coder→reviewer loop per milestone, looping on rejection.
- Gather and attach evidence before marking each milestone complete.
- Update the plan doc checkboxes as the single source of progress truth.

## Boundaries

- Do not implement anything outside the current milestone's scope.
- Do not mark a milestone complete without reviewer approval and attached evidence.
- Do not proceed to the next milestone if the current one is blocked.
- Escalate to the user when the coder is blocked (not just rejected — blocked means cannot proceed).

## Preconditions

- User provides the plan doc path explicitly (e.g., `docs/plans/2026-03-05-my-feature-plan.md`).

## Execution Flow

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
   - If reviewer returns `approved: yes`:
     - Collect evidence from reviewer output.

   **b. Evidence and checkpoint:**
   - Attach evidence to the milestone line in the plan doc (files, test results, screenshots).
   - Update the checkbox from `- [ ]` to `- [x]` using the milestone-tracking skill.
   - Commit: `git commit -m "build: complete milestone N — <title>"`

4. When all milestones are checked:
   - Update plan doc frontmatter `status: complete`.
   - Commit: `git commit -m "build: plan complete — <slug>"`
   - Output final summary to user.

## Required Output per milestone

- milestone: number and title
- approved_by: reviewer signoff summary
- evidence: files touched, commands run, test results, screenshots (if any)
- next: next milestone or "plan complete"

## Failure Contract

On coder blocked:

- blocked: which milestone and what cannot proceed
- why: missing input, ambiguous scope, environment issue
- unblock: smallest specific step for the user

On reviewer cycling (same finding rejected 3 times without progress):

- Escalate to user — do not loop indefinitely on the same rejection.
```

**Step 2: Verify**

Run: `ls .opencode/agents/hf-build-orchestrator.md`
Expected: file listed

**Step 3: Commit**

```bash
git add .opencode/agents/hf-build-orchestrator.md
git commit -m "feat: add hf-build-orchestrator primary agent"
```

---

## Task 10: Update `hf-coder.md` — accept milestone scope

**Files:**
- Modify: `.opencode/agents/hf-coder.md:15-20` (Preconditions and Execution Contract)

**Step 1: Read current file**

Read `.opencode/agents/hf-coder.md` fully before editing.

**Step 2: Update Preconditions section**

Replace:
```
## Preconditions

- You have a concrete scope-in/scope-out and acceptance criteria.
- You have the minimum required context files loaded (standards first).
```

With:
```
## Preconditions

- You have a single milestone scope: title, one-line scope, and acceptance criterion.
- You have relevant local context from the plan doc's Research Summary.
- You do NOT need the full plan — only the current milestone and its acceptance criterion.
```

**Step 3: Verify the edit looks right**

Read the file again after editing. Confirm the Preconditions section matches what's above.

**Step 4: Commit**

```bash
git add .opencode/agents/hf-coder.md
git commit -m "update: hf-coder accepts milestone scope instead of full plan"
```

---

## Task 11: Update `hf-reviewer.md` — add Playwright + loop feedback

**Files:**
- Modify: `.opencode/agents/hf-reviewer.md`

**Step 1: Read current file fully**

**Step 2: Update frontmatter** — add Playwright MCP note

Add after `temperature: 0.1`:
```yaml
mcp:
  - playwright  # for UI verification and evidence screenshots
```

**Step 3: Update Purpose section** — add loop and evidence responsibilities

Replace:
```
## Purpose

- Decide "approved yes/no" for scope-fit and gate compliance.
- Prevent over-building and unverified completion.
```

With:
```
## Purpose

- Decide "approved yes/no" for scope-fit and gate compliance.
- Prevent over-building and unverified completion.
- When not approved: return structured feedback that unblocks the coder in one retry.
- When approved: gather and return evidence (code refs + Playwright screenshots for UI work).
```

**Step 4: Add Evidence Gathering section** before Failure Contract

```markdown
## Evidence Gathering (when approved)

Collect and return:

- files_changed: exact paths and line ranges of changes reviewed
- test_evidence: test command run + pass/fail result (if tests exist)
- ui_evidence: if the milestone touches UI, use Playwright MCP to:
  - Navigate to the affected page/component
  - Take a screenshot confirming the expected state
  - Save to `docs/plans/evidence/<plan-slug>-milestone-<N>.png`
- build_evidence: result of `npm run build` or equivalent (if applicable)
```

**Step 5: Update Required Output** — add loop feedback field

Add to existing `## Required Output`:
```
- loop_feedback: (when approved: no) one structured action for the coder — specific file,
  function, or behavior to fix; no vague "improve quality" feedback
```

**Step 6: Verify edits**

Read the file after editing. Confirm all four changes are present.

**Step 7: Commit**

```bash
git add .opencode/agents/hf-reviewer.md
git commit -m "update: hf-reviewer adds Playwright evidence + loop feedback contract"
```

---

## Task 12: Update `registry.json`

**Files:**
- Modify: `.opencode/registry.json`

**Step 1: Read current registry**

Read `.opencode/registry.json` fully.

**Step 2: Add new asset entries**

Add the following entries to the `"assets"` array:

```json
{
  "id": "agent-plan-orchestrator",
  "type": "agent",
  "path": ".opencode/agents/hf-plan-orchestrator.md",
  "dependsOn": [
    "skill-brainstormer",
    "skill-plan-synthesis",
    "skill-git-workflows",
    "agent-local-context-scout",
    "agent-web-research-scout",
    "agent-code-search-scout"
  ]
},
{
  "id": "agent-build-orchestrator",
  "type": "agent",
  "path": ".opencode/agents/hf-build-orchestrator.md",
  "dependsOn": [
    "skill-milestone-tracking",
    "skill-git-workflows",
    "skill-approval-gates",
    "skill-verification-before-completion",
    "agent-coder",
    "agent-reviewer",
    "agent-tester",
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
  "dependsOn": [
    "context-navigation"
  ]
},
{
  "id": "skill-milestone-tracking",
  "type": "skill",
  "path": ".opencode/skills/milestone-tracking/SKILL.md",
  "dependsOn": []
}
```

**Step 3: Remove retired asset entries**

Remove entries with these IDs:
- `"agent-core"` (hf-core-agent)
- `"agent-task-planner"` (converted to skill)
- `"agent-context-scout"` (converted to skill)
- `"agent-task-manager"` (converted to skill)

**Step 4: Update `skill-bounded-parallel-scouting` dependencies**

Find entry `"id": "skill-bounded-parallel-scouting"` and remove `"agent-context-scout"` from its `dependsOn` array. Add `"agent-local-context-scout"` instead.

**Step 5: Update commands that referenced retired agents**

- `command-brainstorm`: remove `"agent-core"` from `dependsOn`, add `"agent-plan-orchestrator"`
- `command-run-core-delegation`: remove `"agent-task-planner"` from `dependsOn`

**Step 6: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('.opencode/registry.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 7: Commit**

```bash
git add .opencode/registry.json
git commit -m "update: registry — add new orchestrators, scouts, skills; remove retired agents"
```

---

## Task 13: Run validation and fix failures

**Step 1: Run full validation**

Run: `npm run validate`
Expected: all validators pass with no errors

**Step 2: If registry validation fails**

- Read the error output carefully
- The most common cause: a `dependsOn` entry references an ID that no longer exists
- Fix the specific reference and re-run `npm run validate:registry`

**Step 3: If agent contract validation fails**

- Read the specific agent file flagged
- Common cause: required frontmatter fields missing or malformed
- Fix and re-run `npm run validate:agent-contracts`

**Step 4: If skill contract validation fails**

- Read the specific skill file flagged
- Fix frontmatter and re-run `npm run validate:skill-contracts`

**Step 5: Commit fixes**

```bash
git add .opencode/
git commit -m "fix: validation errors from new orchestrator assets"
```

---

## Task 14: Remove retired agent files

> Only do this after Task 13 passes validation.

**Files:**
- Delete: `.opencode/agents/hf-core-agent.md`
- Delete: `.opencode/agents/hf-task-planner.md`
- Delete: `.opencode/agents/hf-context-scout.md`
- Delete: `.opencode/agents/hf-task-manager.md`

**Step 1: Delete the four retired agent files**

```bash
rm .opencode/agents/hf-core-agent.md
rm .opencode/agents/hf-task-planner.md
rm .opencode/agents/hf-context-scout.md
rm .opencode/agents/hf-task-manager.md
```

**Step 2: Run validation again to confirm nothing broke**

Run: `npm run validate`
Expected: all validators pass

**Step 3: Commit**

```bash
git add -A .opencode/agents/
git commit -m "remove: retired agents (core, task-planner, context-scout, task-manager)"
```

---

## Task 15: Update TypeScript orchestrator to reflect new architecture

**Files:**
- Modify: `src/orchestrator/core-agent.ts`

**Step 1: Read the current file**

Read `src/orchestrator/core-agent.ts` fully.

**Step 2: Update subagent imports to match new agents**

Replace imports of `runContextScout`, `runTaskPlanner`, `runTaskManager` with a comment
noting they are now handled by `hf-plan-orchestrator` markdown assets. The TS runtime is
a test/validation layer — update it to reflect that the plan phase is now orchestrated
by the markdown agent, not TS code.

Specifically, replace the body of `runTask` to route based on new orchestrator names:
- `assignedSubagent === "PlanOrchestrator"` → reflect plan orchestrator stages
- `assignedSubagent === "BuildOrchestrator"` → reflect build orchestrator stages

**Step 3: Update `OrchestrationResult` type**

Update the `executionPath.stages` arrays in `runTask` to match new agent names:
- Plan path: `["Brainstormer", "LocalContextScout", "WebResearchScout", "CodeSearchScout", "PlanSynthesis"]`
- Build path: `["MilestoneTracking", "Coder", "Reviewer"]`

**Step 4: Build and verify**

Run: `npm run build`
Expected: TypeScript compiles with no errors

**Step 5: Commit**

```bash
git add src/orchestrator/core-agent.ts
git commit -m "update: TS orchestrator reflects plan/build split"
```

---

## Task 16: Final validation and integration check

**Step 1: Full validation pass**

Run: `npm run validate`
Expected: all validators pass

**Step 2: Build**

Run: `npm run build`
Expected: clean compile

**Step 3: Verify agent file inventory**

Run: `ls .opencode/agents/`
Expected: contains `hf-plan-orchestrator.md`, `hf-build-orchestrator.md`, `hf-local-context-scout.md`, `hf-web-research-scout.md`, `hf-code-search-scout.md`, `hf-coder.md`, `hf-reviewer.md`
Must NOT contain: `hf-core-agent.md`, `hf-task-planner.md`, `hf-context-scout.md`, `hf-task-manager.md`

**Step 4: Verify skill inventory**

Run: `ls .opencode/skills/`
Expected: contains `brainstormer/`, `plan-synthesis/`, `local-context/`, `milestone-tracking/` alongside existing skills

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: plan/build orchestrator split — complete

- hf-plan-orchestrator: brainstorm → parallel scouts → plan doc
- hf-build-orchestrator: milestone loop with coder/reviewer + Playwright evidence
- 4 new skills: brainstormer, plan-synthesis, local-context, milestone-tracking
- 3 new scout agents: local-context-scout, web-research-scout, code-search-scout
- updated: hf-coder (milestone scope), hf-reviewer (Playwright + loop feedback)
- removed: hf-core-agent, hf-task-planner, hf-context-scout, hf-task-manager"
```

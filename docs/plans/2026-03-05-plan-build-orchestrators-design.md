# Design: Plan & Build Orchestrators

**Date:** 2026-03-05
**Status:** Approved — pending implementation plan

---

## Overview

Replace `hf-core-agent` with two purpose-built primary orchestrators: `hf-plan-orchestrator` and `hf-build-orchestrator`. The planning orchestrator gathers multi-source context before writing a milestone-based plan doc. The build orchestrator consumes that plan doc, iterates per milestone through a coder/reviewer loop, and gathers evidence before marking each milestone done.

---

## Architecture

```
User
 ├── hf-plan-orchestrator   (planning sessions)
 │     ├── [skill] hf-brainstormer          — phase 1, inline
 │     ├── hf-local-context-scout           — phase 2, parallel
 │     ├── hf-web-research-scout            — phase 2, parallel
 │     ├── hf-code-search-scout             — phase 2, parallel (gh_grep MCP)
 │     └── → writes docs/plans/YYYY-MM-DD-<slug>-plan.md
 │
 └── hf-build-orchestrator  (build sessions, user provides plan doc path)
       ├── [skill] hf-milestone-tracking    — reads/updates plan doc checkboxes
       ├── hf-coder                         — implements one milestone at a time
       └── hf-reviewer                      — loops back to coder if rejected
                                              escalates to user if blocked
                                              uses Playwright MCP for evidence
```

---

## hf-plan-orchestrator

### Flow

1. **Phase 1 — Brainstorm** (inline, sequential)
   - Loads `hf-brainstormer` skill
   - Scopes the feature, identifies unknowns, generates approach options
   - Output defines the search scope for phase 2

2. **Phase 2 — Parallel research** (3 subagents dispatched simultaneously)
   - `hf-local-context-scout` — grep/glob over local project; loads `hf-local-context` skill
   - `hf-web-research-scout` — web search for docs, tutorials, prior art
   - `hf-code-search-scout` — local grep + gh_grep MCP (`https://mcp.grep.app`) for GitHub code search

3. **Phase 3 — Synthesis**
   - Loads `hf-plan-synthesis` skill
   - Merges brainstorm output + all 3 research results
   - Writes plan doc to `docs/plans/YYYY-MM-DD-<slug>-plan.md`

### Plan Document Format

```markdown
---
plan: <slug>
created: YYYY-MM-DD
status: in-progress
---

# Plan: <Feature Name>

## Overview
<synthesized summary from brainstorm + research>

## Research Summary
- **Local context**: key files, patterns, constraints found
- **Web research**: relevant docs, tutorials, prior art
- **Code examples**: similar implementations found via gh_grep

## Milestones
- [ ] 1. <Milestone title> — <one-line scope>
- [ ] 2. <Milestone title> — <one-line scope>
- [ ] 3. <Milestone title> — <one-line scope>

## Risks & Open Questions
<caveats, unknowns, things to watch>
```

Milestones must be independently achievable and clearly scoped.

---

## hf-build-orchestrator

### Invocation

User explicitly provides the plan doc path. The orchestrator does not auto-discover plans.

### Flow

1. Reads the plan doc; loads `hf-milestone-tracking` skill
2. For each unchecked milestone (`- [ ]`):
   - Dispatches `hf-coder` with milestone scope + relevant plan context
   - Dispatches `hf-reviewer` to review the implementation
   - **If rejected:** reviewer returns structured feedback → coder retries
   - **If blocked:** escalates to user (no fixed retry cap)
   - **If approved:** reviewer gathers evidence:
     - References to changed files/functions
     - Playwright screenshots or assertions (if UI work)
   - Updates milestone to `- [x]` in plan doc
3. When all milestones checked:
   - Updates frontmatter `status: complete`
   - Outputs final summary

---

## Subagent & Skill Inventory

### New Primary Agents

| Agent | Type | Description |
|---|---|---|
| `hf-plan-orchestrator` | primary | Runs the full plan flow |
| `hf-build-orchestrator` | primary | Runs the milestone build/review loop |

### New Subagents

| Agent | Description |
|---|---|
| `hf-local-context-scout` | Local grep/glob search; loads `hf-local-context` skill |
| `hf-web-research-scout` | Web research for docs, tutorials, prior art |
| `hf-code-search-scout` | Local grep + gh_grep MCP for GitHub code search |

### New Skills (converted from retired agents)

| Skill | Converted from | Loaded by |
|---|---|---|
| `hf-brainstormer` | new | `hf-plan-orchestrator` (phase 1) |
| `hf-plan-synthesis` | `hf-task-planner` | `hf-plan-orchestrator` (phase 3) |
| `hf-local-context` | `hf-context-scout` | `hf-local-context-scout` |
| `hf-milestone-tracking` | `hf-task-manager` | `hf-build-orchestrator` |

### Updated Agents

| Agent | Change |
|---|---|
| `hf-coder` | Receives single milestone scope instead of full plan |
| `hf-reviewer` | Gains Playwright MCP permission + structured loop feedback contract |

### Retired (no conversion)

| Agent | Reason |
|---|---|
| `hf-core-agent` | Replaced by the two orchestrators |

### Unchanged

`hf-tester`, `hf-build-validator`, `hf-external-docs-scout` — remain available for `hf-reviewer` to invoke as needed.

---

## MCP Dependencies

| MCP Server | Used by | Purpose |
|---|---|---|
| `gh_grep` (`https://mcp.grep.app`) | `hf-code-search-scout` | GitHub code search |
| `playwright` | `hf-reviewer` | UI verification and evidence screenshots |

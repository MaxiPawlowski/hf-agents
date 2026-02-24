# Great OpenCode Agents: Essentials Guide (Consolidated)

## What "Great" Means

A great agent is predictable under pressure: it stays inside scope and safety rules, composes cleanly with other agents, and can prove completion with evidence.

## Non-Negotiable Agent Contract

Every great agent must define:

- Purpose: what it does (3-6 bullets).
- Boundaries: what it will not do.
- Policy: tool permissions and safety rules.
- Workflow gates: discover -> plan -> execute -> verify -> report.
- Output contract: fixed fields the caller can depend on.
- Failure payload: blocked -> why -> smallest unblock step.

## Prompt Anatomy (Minimum Required Sections)

### Metadata + permissions (frontmatter)

- `name`, `description`, `mode` (primary|subagent), `temperature`.
- Tool permissions are explicit and conservative.

Rule: if an action can damage state (secrets, destructive ops, rewriting history), default to deny or ask.

### Responsibilities and non-responsibilities

Non-responsibilities prevent scope creep. Common examples:

- no code edits (for read-only agents)
- no git operations unless explicitly requested
- no broad test runs unless required; prefer targeted checks
- no brainstorming unless explicitly delegated

### Execution rules

- Scope discipline: implement only the requested/approved scope.
- Context discipline: load project standards before irreversible actions.
- Stop-on-ambiguity: ask one targeted question only when blocked.
- Stop-on-failure: report -> propose -> wait for policy/approval gates.

### Output contract

Require fixed fields, per role:

- Planner: objective, steps, assumptions, risks, verification plan.
- Coder: changes made, files touched, commands run, results, gaps.
- Reviewer: approval yes/no, prioritized findings, required next action.
- Tester/build: commands run, pass/fail, key diagnostics, evidence gaps.

## Context Strategy (Consistency Without Bloat)

- Navigation-driven: start from a context index (a single navigation file), then follow links.
- Minimal context: load only what changes decisions; prefer line/section references for large files.
- Separation of concerns: internal standards (how this repo works) vs external docs (how a library works today).
- Hierarchical local context: directory-level `AGENTS.md` (and optionally README) injects just-in-time guidance.
- Conditional rules: rule files applied by glob can enforce safety and conventions.

## Runtime Toggles and Quality Gates

Treat runtime toggles as first-class inputs (examples):

- `use_worktree`: workspace strategy.
- `require_tests`: completion requires test evidence.
- `require_verification`: completion requires verification evidence.
- `task_artifacts`: multi-step work requires persistent artifacts.

Rule: never claim "done" when a required gate lacks evidence.

## Workflow Model (The Anti-Chaos Loop)

### Discover

- confirm objective and scope boundaries
- identify constraints and safety/policy rules
- load the minimum relevant standards

### Plan

- produce a small plan (3-7 steps) with explicit deliverables and verify steps
- for complex work: persist plans as files (read-only during execution)

### Execute

- implement only scoped items
- track exactly what changed
- prefer atomic units that fit in a fresh context window

### Verify

- verification is a contract: every task includes an explicit verify command
- if no test infra exists, create scaffolding first ("Wave 0")

### Report

- map request -> delivered behavior
- include evidence (commands/results) and residual risks

## Delegation and Orchestration (Composable Systems)

### Role split

- Orchestrator: routing, policy enforcement, coherence, merging results.
- Specialists: narrow jobs with strict output contracts.

### Handoff bundle (required fields)

- objective
- scope in / scope out
- constraints (toggles + safety)
- candidate files
- acceptance criteria (binary)
- evidence required

### Parallelism (safe by construction)

- run independent workstreams in parallel (exploration, docs lookup, review)
- execute dependent work in waves; parallelize only when files/state do not overlap

### Category-based delegation

Delegate by semantic category instead of model names:

- visual-engineering: UI/design
- deep: autonomous research/execution
- quick: small safe changes
- ultrabrain: hard logic/architecture

Benefit: stable behavior across providers; easy tuning via config.

## Harness Features That Make Agents Reliable

Great agents do not live in prompts alone. The harness reduces failure modes.

### Intent gate

Add an explicit intent classification step for non-trivial requests so the system selects the right workflow and evidence gates.

### Stable edit anchoring

Edits must reference a verifiable identifier for the exact content being changed, and fail fast if the target changed since read (no best-effort stale patches).

### IDE-grade signals

- LSP diagnostics before builds
- workspace rename/references for safe refactors
- AST-aware search/replace for large rewrites

### Background specialists

Run specialists in the background to keep the main context lean; merge their compact findings into one decision.

### Wisdom accumulation

After each step, persist learnings (conventions, gotchas, successful commands, verification evidence) and pass them forward.

### Continuation enforcement

Multi-step workflows need a continuation mechanism: persistent checklist/task state plus hooks that prevent silent stopping.

### Context-rot countermeasures

Design around long-session degradation:

- execute plans in fresh worker contexts
- persist state so the main session can be cleared and resumed
- keep each plan small and verifiable

### Context window monitoring (agent-visible)

Agents should receive warnings as context gets low:

- warning threshold: wrap up, avoid starting new complex work
- critical threshold: stop and persist state / handoff
- debounce to avoid spam

### Recovery and fallback

- safe retries for transient provider failures
- fallback models when needed
- preserve critical context during compaction
- recover from tool output parsing failures

## Persistent Spec/State Artifacts (For Consistent Results)

For non-trivial work, persist these as files (names may vary):

- `PROJECT.md`: vision and invariants
- `REQUIREMENTS.md`: scoped requirements with identifiers
- `ROADMAP.md`: phases with status
- `STATE.md`: decisions, blockers, continuity
- per-phase `CONTEXT.md`: preferences that remove guessing
- per-phase `RESEARCH.md`: grounded implementation research
- per-plan `SUMMARY.md`: durable history and learnings

Rule: treat these as the source of truth for downstream agents.

## Git and Workspace Safety

- never run destructive git commands unless explicitly requested
- never revert unrelated local changes
- never commit unless explicitly requested (unless your system explicitly advertises auto-commit behavior)

## Evaluation / Harness-Only Agents

If you run evals or automated harness checks, include harness-only agents that are clearly non-interactive, deterministic, and safe to swap in/out.

## Templates

### Agent skeleton

```md
---
name: <agent-name>
description: "<one-line>"
mode: <primary|subagent>
temperature: 0.1
permission:
  # allow/deny/ask
---

## Responsibilities
- <bullet>

## Non-Responsibilities
- <bullet>

## Execution Rules
- <bullet>

## Output Contract
Return:
- <field>

## Failure Behavior
- blocked: <what>
  why: <why>
  unblock: <smallest next step>
```

### Handoff bundle

```text
Objective:
<objective>

Scope In:
- <item>

Scope Out:
- <item>

Constraints:
- toggles: <resolved toggles>
- safety: <critical rules>

Candidate Files:
- <path>

Acceptance Criteria:
- <binary check>

Evidence Required:
- <command / artifact>
```

### Plan task (verification as contract)

```xml
<task>
  <name>Short imperative task name</name>
  <files>
    <file>path/to/file.ts</file>
  </files>
  <action>What to change and constraints</action>
  <verify>Exact command(s) to verify</verify>
  <done>Binary completion condition</done>
</task>
```

### Evidence block

```text
Commands run:
- <cmd>

Results:
- <pass|fail> <key signal>

Gaps:
- <what not verified + why>
```

## Repo agent roster (this project)

- `hf-core-agent`: orchestrator; toggle-first behavior
- `hf-context-scout`: minimal relevant context discovery
- `hf-task-planner`: small, verifiable implementation plans
- `hf-task-manager`: dependency-aware lifecycle tasks (artifact-driven)
- `hf-coder`: scoped implementation + files-touched reporting
- `hf-reviewer`: scope/quality review with approval outcome
- `hf-tester`: targeted test execution + evidence gaps
- `hf-build-validator`: build/type validation + remediation ordering
- `hf-external-docs-scout`: current external docs + version/pitfall notes

## Audit checklist (quick)

- Clear purpose and explicit boundaries
- Tool permissions and safety rules
- Context strategy (navigation, minimal, hierarchical)
- Workflow gates with stop conditions
- Strict output contract + failure payload
- Verification-as-contract (verify commands per task)
- Persistent spec/state artifacts for complex work
- Stable edit anchoring (or equivalent)
- Plan-check/review loop for complex plans
- Continuation + context-window monitoring + pause/handoff path

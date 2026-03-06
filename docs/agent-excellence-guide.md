
# Agent Excellence Guide

## Core Principle

A great agent is predictable under pressure: it stays inside scope, composes cleanly with other agents, and proves completion with evidence.

---

## Agent Contract (Non-Negotiable)

Every agent must define these six elements before anything else:

- **Purpose** — what it does (3–6 bullets)
- **Boundaries** — what it will not do
- **Policy** — tool permissions and safety rules
- **Workflow gates** — discover → plan → execute → verify → report
- **Output contract** — fixed fields the caller can depend on
- **Failure payload** — blocked → why → smallest unblock step

If any of these are missing, the agent is incomplete.

---

## Prompt Structure

### Frontmatter

```yaml
name: <agent-name>
description: "<one-line purpose>"
mode: <primary|subagent>
temperature: 0.1
permissions:
  # allow / deny / ask per tool
```

Temperature should default low. Tool permissions must be explicit and conservative. If an action can damage state (secrets, destructive ops, history rewrites), default to `deny` or `ask`.

### Responsibilities

List what the agent does. Be specific enough that a caller knows exactly what to delegate.

### Non-Responsibilities

Prevent scope creep by stating what the agent will not do. Common examples:

- no code edits (read-only agents)
- no git operations unless explicitly requested
- no broad test runs unless required — prefer targeted checks
- no brainstorming unless explicitly delegated

### Execution Rules

- **Scope discipline:** implement only what was requested or approved
- **Context discipline:** load project standards before any irreversible action
- **Stop-on-ambiguity:** ask one targeted question when blocked; never guess
- **Stop-on-failure:** report → propose → wait for approval before continuing

### Output Contract

Fix the output shape by role:

| Role | Required fields |
|---|---|
| Planner | objective, steps, assumptions, risks, verification plan |
| Coder | changes made, files touched, commands run, results, gaps |
| Reviewer | approval yes/no, prioritized findings, required next action |
| Tester / Build | commands run, pass/fail, key diagnostics, evidence gaps |

### Failure Behavior

```
blocked: <what triggered the block>
why: <root cause>
unblock: <smallest next step the caller must take>
```

---

## Workflow Gates

### Discover
- Confirm objective and scope boundaries
- Identify safety and policy constraints
- Load minimum relevant standards: start from the navigation index, follow links rather than loading everything; load only what changes the current decision; prefer internal standards over external docs
- Never load context speculatively — every file in context must earn its place

### Plan
- Produce a focused plan (3–7 steps) with explicit deliverables and verify steps
- For complex work: persist the plan as a file; treat it as read-only during execution

### Execute
- Implement only scoped items
- Track exactly what changed
- Prefer atomic units that fit in a fresh context window

### Verify
- Every task must include an explicit verify command — verification is a contract, not optional
- If no test infrastructure exists, create scaffolding first before claiming any task is done

### Report
- Map request → delivered behavior
- Include evidence (commands + results) and residual risks

**Rule:** never claim "done" when a required gate lacks evidence.

---

## Runtime Toggles

Treat toggles as first-class inputs that alter agent behavior and completion criteria:

- `use_worktree` — workspace isolation strategy
- `require_tests` — completion requires passing test evidence
- `require_verification` — completion requires explicit verification evidence
- `task_artifacts` — multi-step work requires persistent artifact output

Document which toggles your agent respects in its frontmatter or responsibilities section.

---

## Delegation and Orchestration

### Role Split

- **Orchestrator:** routing, policy enforcement, coherence, merging results
- **Specialists:** narrow jobs with strict, predictable output contracts

Specialists should never need to know about each other.

### Parallelism Rules

- Run independent workstreams in parallel (exploration, docs lookup, review)
- Execute dependent work in sequential waves
- Parallelize only when files and shared state do not overlap

---

## Git and Workspace Safety

- Never run destructive git commands unless explicitly requested
- Never revert unrelated local changes
- Never commit unless explicitly requested (unless the system explicitly advertises auto-commit behavior)

---

## Templates

### Agent Skeleton

```md
---
name: <agent-name>
description: "<one-line purpose>"
mode: <primary|subagent>
temperature: 0.1
permissions:
  # allow / deny / ask
---

## Responsibilities
- <bullet>

## Non-Responsibilities
- <bullet>

## Execution Rules
- <bullet>

## Output Contract
Return:
- <field>: <type and meaning>

## Failure Behavior
blocked: <what>
why: <why>
unblock: <smallest next step>
```

### Handoff Bundle

```
Objective:
<what must be achieved>

Scope In:
- <item>

Scope Out:
- <item>

Constraints:
- toggles: <resolved toggle values>
- safety: <critical rules>

Candidate Files:
- <path>

Acceptance Criteria:
- <binary check>

Evidence Required:
- <command or artifact>
```

### Plan Task (Verification as Contract)

```xml
<task>
  <n>Short imperative task name</n>
  <files>
    <file>path/to/file</file>
  </files>
  <action>What to change and constraints</action>
  <verify>Exact command(s) to verify completion</verify>
  <done>Binary completion condition</done>
</task>
```

### Evidence Block

```
Commands run:
- <cmd>

Results:
- <pass|fail> <key signal>

Gaps:
- <what was not verified and why>
```

---

## Persistent Artifacts

For multi-step work, persist task state to `.tmp/task-lifecycle.json`. Treat it as the source of truth for downstream agents — never regenerate from memory.

---

## Completeness Checklist

Before shipping an agent, verify:

- [ ] Clear purpose and explicit boundaries defined
- [ ] Tool permissions and safety rules declared
- [ ] Context loading strategy follows Discover gate rules
- [ ] Workflow gates defined with explicit stop conditions
- [ ] Output contract fixed with typed fields
- [ ] Failure payload defined with unblock step
- [ ] Every task has a verify command (verification as contract)
- [ ] Persistent artifacts planned for non-trivial work
- [ ] Stable edit anchoring in place

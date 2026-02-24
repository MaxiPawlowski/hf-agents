<!--
id: subagent-handoff-template
owner: team
updated: 2026-02-19
-->

# Subagent Handoff Template

Use this bundle when delegating Planner/Coder/Reviewer work.

## Bundle fields

- `objective`: exact user goal.
- `scope-in`: requested behavior only.
- `scope-out`: explicitly excluded behavior.
- `constraints`: safety and runtime-setting constraints.
- `files`: known paths to touch or inspect.
- `acceptance`: binary completion checks.
- `evidence-required`: checks that must include proof.
- `output-contract`: the fixed fields you expect back.
- `failure-payload`: blocked/why/unblock.

## Prompt block

```text
Objective:
<objective>

Scope In:
- <item>

Scope Out:
- <item>

Constraints:
- toggles: <runtime toggle summary>
- no implicit git
- no implicit worktrees

Candidate Files:
- <path>

Acceptance Criteria:
- <binary check>

Evidence Required:
- <command or file proof>

Output Contract:
- <field>

Failure Payload:
- blocked: <what>
- why: <why>
- unblock: <smallest next step>
```

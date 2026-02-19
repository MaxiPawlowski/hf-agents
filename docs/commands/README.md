# Command Catalog

This catalog documents framework command intent and common usage. Source command definitions live in `.opencode/commands/`.

## Core Flow

1. `hf-setup` - verify command/context/policy prerequisites.
2. `hf-plan-feature` or `hf-write-plan` - create implementation plan.
3. `hf-run-core-delegation` or `hf-execute-plan` - implement via delegated workflow.
4. `hf-verify` - run mode-aware verification checks.
5. `hf-finish` - produce completion recommendation.

## Command Groups

- Planning:
  - `hf-plan-feature`
  - `hf-write-plan`
  - `hf-execute-plan`
- Execution and completion:
  - `hf-run-core-delegation`
  - `hf-verify`
  - `hf-finish`
- Operations:
  - `hf-add-context`
  - `hf-status`
  - lifecycle helpers: `task-status`, `task-resume`, `task-next`, `task-blocked`, `task-complete`, `task-block`
  - research helpers: `mcp-search` (providers: `tavily`, `gh-grep`)
  - background runtime: `background-enqueue`, `background-dispatch`, `background-status`
  - `hf-setup`
  - `hf-cleanup`
  - `hf-help`

## Examples

```bash
# Plan feature work
/hf-plan-feature "add role-based auth middleware" --mode balanced

# Execute core delegated flow
/hf-run-core-delegation "implement role guards in API routes" --mode balanced

# Verify and finish
/hf-verify current-changes --mode strict
/hf-finish --mode strict
```

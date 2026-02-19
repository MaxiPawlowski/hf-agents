# Command Catalog

This catalog documents framework command intent and common usage. Source command definitions live in `.opencode/commands/`.

## Core Flow

1. `hf-setup` - verify command/context/settings prerequisites.
2. `hf-brainstorm` - clarify approach when requirements are ambiguous.
3. `hf-plan-feature` - create dependency-aware implementation plan.
4. `hf-run-core-delegation` - implement via delegated workflow.
5. `hf-verify` - run profile-aware verification checks.
6. `hf-finish` - produce completion recommendation.

## Command Groups

- Planning:
  - `hf-brainstorm`
  - `hf-plan-feature`
- Execution and completion:
  - `hf-run-core-delegation`
  - `hf-verify`
  - `hf-finish`
- Operations:
  - `hf-add-context`
  - `hf-status`
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

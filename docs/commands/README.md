# Command Catalog

Source command contracts live in `.opencode/commands/`.

## Recommended Workflow

1. `hf-setup`
2. `hf-brainstorm` (when requirements are unclear)
3. `hf-plan-feature`
4. `hf-run-core-delegation`
5. `hf-verify`
6. `hf-finish`

## Command Groups

- Planning: `hf-brainstorm`, `hf-plan-feature`
- Execution: `hf-run-core-delegation`, `hf-task-loop`
- Verification and completion: `hf-verify`, `hf-finish`
- Operations: `hf-setup`, `hf-status`, `hf-add-context`, `hf-cleanup`, `hf-help`
- Runtime toggles: `toggle-worktree`, `toggle-tests`, `toggle-verification`, `toggle-artifacts`, `toggle-status`

## Examples

```bash
/hf-plan-feature "add role-based auth middleware"
/hf-run-core-delegation "implement role guards in API routes"
/hf-task-loop status --feature=rbac-guards
/hf-verify current-changes
/hf-finish
/toggle-status
```

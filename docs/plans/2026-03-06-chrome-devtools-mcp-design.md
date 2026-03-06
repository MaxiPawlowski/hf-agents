# Design: Replace Playwright MCP with chrome-devtools-mcp

**Date:** 2026-03-06
**Branch:** feat/plan-build-orchestrators
**Status:** Approved

## Summary

Two changes to agent MCP configuration:

1. **Reviewer** (`hf-reviewer`): Replace Playwright MCP with chrome-devtools-mcp for UI verification and evidence gathering.
2. **Coder** (`hf-coder`): Add chrome-devtools-mcp for reactive debugging only (when encountering errors during implementation).

## Change 1: Reviewer — Playwright to chrome-devtools-mcp

### What changes

- **Frontmatter**: `mcp: [playwright]` → `mcp: [chrome-devtools]`
- **Evidence Gathering section**: Rewritten to use CDP-based capabilities:
  - Screenshots via CDP's page capture (instead of Playwright's screenshot API)
  - DOM/UI verification via CDP DOM inspection and accessibility tree snapshots
  - Console message reading for error/warning detection
- Same evidence output paths (`docs/plans/evidence/<plan-slug>-milestone-<N>.png`)
- Prefer text-based evidence but capture screenshots for UI milestones when available

### What stays the same

- Purpose, Boundaries, Preconditions, Execution Contract, Required Output, Failure Contract — all unchanged
- Approval flow unchanged
- Same structured output format

## Change 2: Coder — Add chrome-devtools-mcp for reactive debugging

### What changes

- **Frontmatter**: Add `mcp: [chrome-devtools]`
- **New subsection** in Execution Contract: "Debugging with DevTools"
  - Scoped to reactive use only — when blocked by errors during implementation
  - Capabilities: check console for runtime errors, evaluate JS to verify types/values, inspect console.log output
  - NOT for proactive verification (that's the reviewer's job)

### What stays the same

- All existing sections preserved with current verbosity and structure
- Same boundaries, preconditions, output format, failure contract
- No scope changes to the coder's responsibilities

## Files to modify

1. `.opencode/agents/hf-reviewer.md` — swap MCP, update evidence gathering
2. `.opencode/agents/hf-coder.md` — add MCP, add debugging subsection
3. `.opencode/registry.json` — update MCP dependencies for both agents (if tracked)

## Dependencies

- chrome-devtools-mcp must be installed and configured externally (not part of this change)
- Assumes chrome-devtools-mcp provides: page screenshot capture, DOM inspection, console message reading, JS evaluation

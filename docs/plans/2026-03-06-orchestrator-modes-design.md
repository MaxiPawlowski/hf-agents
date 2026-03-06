# Orchestrator Modes Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

The existing `hf-plan-orchestrator` and `hf-build-orchestrator` agents had their behavior driven by a JS/TS toggle system (`deep_plan`, `enable_review` in `framework-settings.json`, resolved through the plugin layer). This creates a framework-specific dependency and prevents the agents from being self-describing or portable. The toggle machinery adds JS complexity with no payoff — mode is a per-invocation decision, not a persistent setting.

## Solution

Replace the 2 generic orchestrators with 4 explicit mode agents. Mode = agent selection. No runtime state, no JS, no toggle. The file is the contract.

## New Agents

| Agent | Mode | Replaces |
|---|---|---|
| `hf-planner-light` | Fast planning — local context only | `hf-plan-orchestrator` |
| `hf-planner-deep` | Thorough planning — full research stack | `hf-plan-orchestrator` |
| `hf-builder-light` | Fast build — single coder pass, no review gate | `hf-build-orchestrator` |
| `hf-builder-deep` | Thorough build — coder→reviewer loop + verification | `hf-build-orchestrator` |

Planner and builder are orthogonal — any combination is valid (deep plan + light build, light plan + deep build).

## Agent Specifications

### `hf-planner-light`

```
Permission:
  task:  hf-local-context-scout
  skill: hf-plan-synthesis

Phase 1 — Local scout
  Run hf-local-context-scout with the feature request.
  Wait for output before proceeding.

Phase 2 — Synthesis
  Load hf-plan-synthesis.
  Write plan doc to docs/plans/YYYY-MM-DD-<slug>-plan.md.
  Present to user → commit on approval.

Boundaries:
  No web research, no brainstorming, no online code search.
  YAML permission block enforces this hard.
```

### `hf-planner-deep`

```
Permission:
  task:  hf-local-context-scout, hf-web-research-scout, hf-code-search-scout
  skill: hf-brainstormer, hf-plan-synthesis

Phase 1 — Brainstorm (inline)
  Load hf-brainstormer.
  Output: intent, unknowns, approach options, research brief.
  Do not proceed until research brief is explicit.

Phase 2 — Parallel scouts (all 3 simultaneously)
  hf-local-context-scout  ← local_search_targets from brief
  hf-web-research-scout   ← web_search_targets from brief
  hf-code-search-scout    ← code_search_targets from brief
  Wait for all 3 before proceeding.

Phase 3 — Synthesis
  Load hf-plan-synthesis.
  Merge: brainstorm + all 3 scout outputs.
  Write plan doc → present to user → commit on approval.
```

### `hf-builder-light`

```
Permission:
  task:  hf-coder
  skill: hf-milestone-tracking

For each unchecked milestone in the plan doc:
  1. Dispatch hf-coder with milestone title, scope, acceptance criterion.
  2. On coder blocked → escalate to user immediately.
  3. Update checkbox [x], attach files touched.
  4. Commit: "build: complete milestone N — <title>"

When all milestones checked:
  Update plan doc frontmatter status: complete.
  Commit: "build: plan complete — <slug>"

Boundaries:
  No hf-reviewer, no hf-build-validator, no verification.
```

### `hf-builder-deep`

```
Permission:
  task:  hf-coder, hf-reviewer, hf-build-validator
  skill: hf-milestone-tracking, hf-verification-before-completion

For each unchecked milestone:
  a. Dispatch hf-coder with milestone scope + acceptance criterion.
  b. Dispatch hf-reviewer with coder output.
  c. If rejected: pass required_next_action back to hf-coder → repeat.
     If same finding rejected 3× without progress → escalate to user.
  d. If approved: collect evidence → update checkbox → commit.

When all milestones checked:
  Load hf-verification-before-completion.
  Update plan doc status: complete.
  Commit: "build: plan complete — <slug>"
```

## Enforcement

Each agent's YAML `permission` block only allows the sub-agents and skills its mode needs. A light agent cannot dispatch a deep scout — the framework blocks it at the call site.

## Cleanup

### Delete: plugin JS layer (entire `.opencode/plugins/` tree)

- `framework-bootstrap.js`
- `lib/config.js`
- `lib/state.js`
- `lib/commands.js`
- `lib/interpolation.js`
- `lib/session.js`

No replacement needed. The new agent files are self-contained and do not use interpolation tokens.

### Delete: retired agent files

- `hf-plan-orchestrator.md`
- `hf-build-orchestrator.md`

### Delete: toggle command files

- `toggle-plan.md`
- `toggle-review.md` (not yet created, skip)
- `toggle-worktree.md`
- `toggle-tests.md`
- `toggle-verification.md`
- `toggle-artifacts.md`
- `toggle-status.md`

### Update: `runtime-preferences.md`

Strip all toggle references. Update to reference the 4 new agents by name.

### Vestigial (leave as-is, no action needed)

- `settings/framework-settings.json` — no longer read by anything
- `src/contracts/index.ts` `deepPlan`/`enableReview` fields — compile fine, unused by agents

## Rationale

- Mode = agent selection. Zero runtime state required.
- YAML permission blocks are the enforcement layer — the framework, not prose, prevents a light agent from going deep.
- Planner and builder are fully orthogonal: mix freely per task.
- Deleting the plugin layer removes ~500 lines of JS with no behavioral loss for the new design.

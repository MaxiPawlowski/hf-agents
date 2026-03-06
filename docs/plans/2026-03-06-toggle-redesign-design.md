# Toggle Redesign Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

The original 4 toggles (`use_worktree`, `require_tests`, `require_verification`, `task_artifacts`) were CI/QA-gate controls that didn't align with the plan/build orchestrator architecture. They are retired entirely.

## New Toggle Set (2 toggles)

### `deep_plan`
- **Settings key:** `deepPlan`
- **OFF:** Plan phase runs local code search only (always mandatory)
- **ON:** Adds web research, brainstorming, online code search, and plan synthesis

### `enable_review`
- **Settings key:** `enableReview`
- **OFF:** Single-pass build, no review gate
- **ON:** Verification step + reviewer agent at end of build flow

## Skill Mapping

```markdown
{{skill.hf-local-context-scout}}          ← always on

{{#if toggle.deep_plan}}
  {{skill.hf-web-research-scout}}
  {{skill.hf-brainstormer}}
  {{skill.hf-code-search-scout}}
  {{skill.hf-plan-synthesis}}
{{/if}}

{{#if toggle.enable_review}}
  {{skill.hf-verification-before-completion}}
  {{skill.hf-reviewer}}
{{/if}}
```

| Skill | Always | `deep_plan` ON | `enable_review` ON |
|---|---|---|---|
| hf-local-context-scout | ✓ | | |
| hf-web-research-scout | | ✓ | |
| hf-brainstormer | | ✓ | |
| hf-code-search-scout (online) | | ✓ | |
| hf-plan-synthesis | | ✓ | |
| hf-verification-before-completion | | | ✓ |
| hf-reviewer | | | ✓ |

**Retired:** `hf-approval-gates`, `hf-testing-gate`, `hf-task-artifact-gate`

## Rationale

- `hf-verification-before-completion` is tied to `enable_review` because verification only has value when a reviewer is checking the evidence. Without a reviewer you are in fast mode — a hard gate is friction with no payoff.
- `hf-approval-gates` is retired because `hf-reviewer` IS the approval gate. The old skill was compensating for the absence of a dedicated reviewer agent.
- Local code search is always mandatory — it is baseline context, not optional depth.
- Online code search (`hf-code-search-scout`) is opt-in because it costs time and external calls.

## Commands

| Command | Replaces |
|---|---|
| `/toggle-plan [on\|off]` | `/toggle-worktree` |
| `/toggle-review [on\|off]` | `/toggle-verification` + `/toggle-tests` |
| `/toggle-status` | `/toggle-status` (unchanged) |

**Retired commands:** `/toggle-worktree`, `/toggle-tests`, `/toggle-verification`, `/toggle-artifacts`

## Config Keys

```javascript
TOGGLE_KEYS = ["deep_plan", "enable_review"]

TOGGLE_RULE_TEXT = {
  deep_plan: "Run web research, brainstorming, online code search, and plan synthesis during planning phase.",
  enable_review: "Run verification and reviewer agent at the end of the build flow."
}

SETTINGS_TOGGLE_KEYS = {
  deep_plan: ["deepPlan"],
  enable_review: ["enableReview"]
}
```

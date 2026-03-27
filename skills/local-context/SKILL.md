---
name: hf-local-context
description: >
  Use when a planner needs the smallest useful set of local files, conventions, and landing
  zones before writing a plan. Find only the project context that changes planning
  decisions, then stop.
autonomy: supervised
context_budget: 8000 / 2000 (offloaded to vault)
disable-model-invocation: true
max_iterations: 4
---

# Local Context

Iron law: load only the local context that changes the plan. More files are not better if they do not affect the decision.

## Overview

Use this skill to answer two planning questions: what conventions apply here, and where should changes land. Work from the planner's local targets and stop once those answers are evidence-backed.

## When to Use

- A planner has concrete `local_search_targets` that need repo inspection.
- A planner needs local conventions, file anchors, or likely edit locations before writing milestones.
- Existing project patterns matter more than general framework knowledge.

## When Not to Use

- The task is broad exploration with no focused brief.
- Relevant files and conventions are already loaded.
- The main unknown is outside the repo and needs manual external research.
- Vault already contains findings for the current plan targets — check `vault/plans/<plan-slug>/discoveries.md` before re-exploring.

## Workflow

1. Start with the nearest project entry point such as `README.md` or equivalent root guidance when present.
2. Follow the brief's `local_search_targets` to the smallest relevant docs, source files, tests, or examples for one focused batch.
3. Record what each file contributes: convention, architecture constraint, or likely landing zone.
4. **Write findings to vault**: Persist this batch's findings as a dated section in `vault/plans/<plan-slug>/discoveries.md` (or `vault/shared/` when no plan slug exists). Append rather than replace — each batch adds a new dated section.
5. **Release in-memory findings**: After writing to vault, do not re-read the same findings into conversation. Reference the vault path for downstream consumers.
6. **Decide whether to continue**: If remaining `local_search_targets` are unresolved, return to step 2 for the next batch. Otherwise, stop.
7. If a target is missing, report that gap explicitly instead of widening the search indefinitely.

## Verification

- Confirm the project entry document was checked when one exists.
- Confirm every `local_search_target` is either matched to concrete paths or reported as not found.
- Confirm the returned file set is intentionally minimal and sufficient to guide planning.

## Failure Behavior

If blocked, return:

- blocked: what local context could not be established
- why: the missing file, absent pattern, or unclear target
- unblock: the smallest additional detail or path needed

## Integration

- Loaded directly by `hf-planner`.
- Consumes planner-supplied `local_search_targets`.
- Feeds `hf-plan-synthesis` through the active planner.
- Findings will be distributed across plan milestones as enriched metadata (`scope`, `conventions`, `notes`) by `hf-plan-synthesis`. Output context that maps naturally to specific areas of work so the planner can attach findings to individual milestones.
- Findings are persisted to vault between exploration batches for compaction safety and later consumption by `hf-plan-synthesis`.
- On resume after compaction, check vault for prior findings before restarting exploration.

## Required Output

Return:

- context_files: ordered list of the files inspected
- why: one-line reason each file mattered
- patterns_found: conventions, structures, or naming patterns that should shape the plan
- missing_context: explicit unresolved gaps or follow-up questions
- stop_point: why additional local reading would have low value
- vault_writes: list of vault paths written and a brief note about what each contains

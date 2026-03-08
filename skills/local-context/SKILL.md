---
name: hf-local-context
description: >
  Use when a research brief needs the smallest useful set of local files, conventions, and
  landing zones before planning can proceed. Find only the project context that changes
  planning decisions, then stop.
autonomy: supervised
context_budget: 8000 / 2000
max_iterations: 2
---

# Local Context

Iron law: load only the local context that changes the plan. More files are not better if they do not affect the decision.

## Overview

Use this skill to answer two planning questions: what conventions apply here, and where should changes land. Work from the research brief's local targets and stop once those answers are evidence-backed.

## When to Use

- A research brief includes `local_search_targets` that need repo inspection.
- A planner needs local conventions, file anchors, or likely edit locations before writing milestones.
- Existing project patterns matter more than general framework knowledge.

## When Not to Use

- The task is broad exploration with no focused brief.
- Relevant files and conventions are already loaded.
- External docs or prior art are the main unknown; use web or code-search research instead.

## Workflow

1. Start with the nearest project entry point such as `README.md` or equivalent root guidance when present.
2. Follow the brief's `local_search_targets` to the smallest relevant docs, source files, tests, or examples.
3. Record what each file contributes: convention, architecture constraint, or likely landing zone.
4. Stop as soon as you can explain the applicable conventions and likely change surface.
5. If a target is missing, report that gap explicitly instead of widening the search indefinitely.

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

- Loaded by `hf-local-context-scout`.
- Consumes `local_search_targets` from `hf-brainstormer`.
- Feeds `hf-plan-synthesis` through the active planner.

## Required Output

Return:

- context_files: ordered list of the files inspected
- why: one-line reason each file mattered
- patterns_found: conventions, structures, or naming patterns that should shape the plan
- missing_context: explicit unresolved gaps or follow-up questions
- stop_point: why additional local reading would have low value

---
name: hf-brainstormer
description: >
  Use when planning cannot start cleanly because the user's real intent, decision points,
  or preferred approach is still unclear. Drive a short gated conversation that confirms
  intent, resolves the highest-impact unknowns, and ends with a scout-ready research brief.
autonomy: supervised
context_budget: 8000 / 2000
max_iterations: 3
---

# Brainstormer

Iron law: do not start research or plan synthesis until the user has confirmed the feature intent and the highest-impact unknowns are no longer implicit.

## Overview

Use this skill once at the beginning of a planning session. It turns an initial request into a user-confirmed research brief that downstream scouts and planners can trust.

Keep the interaction progressive: inspect the repo first, then walk the user through one focused gate at a time. Do not front-load every question in one message.

## When to Use

- A new planning session starts and the request still needs scoping.
- Multiple implementation directions are plausible and the user has not chosen among them.
- Scouts need a clear research brief instead of a vague feature description.

## When Not to Use

- The user already provided a detailed, decision-ready specification.
- Research is already complete and only synthesis remains.
- Implementation is already underway and the active milestone scope is clear.

## Workflow

1. Read the minimum local context needed to ground the conversation: root docs, obvious conventions, and any existing plan or feature surface relevant to the request.
2. Confirm intent in one sentence. Ask one focused question and wait for the user's answer before moving on.
3. Surface the 2-3 unknowns that would most change implementation direction. Prefer concrete options over open-ended prompts when possible.
4. Present 2-3 viable approaches with trade-offs and a recommendation. Ask the user to choose or adjust.
5. Produce a research brief with explicit targets for local context, web research, and remote code examples. Get user confirmation before handing off.

Each gate is a stop point. If the user changes the intent or preferred approach, update the current gate and reconfirm before advancing.

## Verification

- Confirm no plan doc was created during brainstorming.
- Confirm each gate received an explicit user response before the next gate advanced.
- Confirm the final research brief includes `local_search_targets`, `web_search_targets`, and `code_search_targets`.
- Confirm the brief reflects user-confirmed intent rather than planner assumptions.

## Failure Behavior

If blocked, return:

- blocked: what cannot be scoped yet
- why: the missing answer, conflicting input, or ambiguity
- unblock: one targeted question for the user

Do not guess past unresolved intent or unresolved decision points.

## Integration

- Loaded by `hf-planner-deep` before scout dispatch.
- Produces the research brief consumed by local, web, and code-search scouts.
- Hands off to research first, then to `hf-plan-synthesis`.

## Required Output

Return after the user confirms the final gate:

- intent: one-sentence user-confirmed feature statement
- unknowns: the decisions that were clarified or confirmed
- approach_selected: the chosen approach and any user-requested adjustments
- research_brief:
  - local_search_targets: files, modules, patterns, or conventions to inspect locally
  - web_search_targets: docs, specs, or external references to fetch
  - code_search_targets: implementation patterns or repositories to look up remotely

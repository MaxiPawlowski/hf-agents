---
name: hf-vault-bootstrap
description: >
  Use when a project is new to the framework or the vault has only starter files and the
  next step is to gather baseline context through dialogue. Trigger on requests to
  initialize project context, bootstrap the vault, capture architecture or intent, or
  turn a kickoff conversation into durable `vault/shared/` notes and optional
  `vault/plans/<slug>/` starter context without writing milestones or runtime state.
autonomy: supervised
context_budget: 12000 / 4000
max_iterations: 2
---

# Vault Bootstrap

Iron law: capture durable project context, not executable plan logic. The plan doc stays canonical for milestones, acceptance, and completion state.

## Overview

Use this skill to turn a short kickoff conversation into useful vault context for a newly initialized project. It should interview the user just enough to understand project intent, architecture, constraints, patterns, and terminology, then map that information into the smallest correct set of vault files.

The skill is initialization-focused. It may create or update `vault/shared/` notes and, when a current plan slug is already known, the starter files under `vault/plans/<slug>/`. It must not invent milestones, rewrite the plan doc, or move runtime bookkeeping into the vault.

## When to Use

- A user asks to bootstrap or initialize the vault for a project.
- A project has fresh scaffold files and needs baseline context instead of empty templates.
- A kickoff conversation contains architecture, product intent, constraints, or team conventions that should become durable vault notes.
- A current plan slug is known and the user wants plan-scoped context files seeded from the conversation.

## When Not to Use

- The user is asking for milestone planning or plan synthesis.
- The task is to update runtime sidecars, counters, or execution state.
- The request is a narrow implementation change that belongs directly in code or the current plan doc.
- There is no user conversation to ground the context and no safe way to infer it from local project material.

## Allowed File Surface

This skill may create or update only these vault files:

- `vault/shared/architecture.md`
- `vault/shared/patterns.md`
- `vault/shared/decisions.md`
- `vault/plans/<slug>/context.md` when a current plan slug is explicitly known
- `vault/plans/<slug>/discoveries.md` when conversation findings are specific to that plan
- `vault/plans/<slug>/decisions.md` when the user makes plan-scoped choices
- `vault/plans/<slug>/references.md` when the user cites durable commands, docs, or links worth keeping

If a needed file does not exist, create it. If it exists, preserve useful content and make small targeted edits or append dated sections instead of replacing the file wholesale.

## Conversation Workflow

1. Check whether `vault/README.md` and any existing target vault files already contain starter guidance or project-specific notes.
2. Start with the context already available in the request. Do not ask the user to restate information that is already clear.
3. Ask only the smallest missing questions needed to cover these buckets:
   - project intent and success criteria
   - system shape, components, integrations, and data flow
   - technical constraints, standards, and preferred patterns
   - important terminology, domain concepts, and non-goals
   - plan-specific context when a current plan slug exists
4. Keep the interview conversational. Ask one compact batch of high-value questions rather than a long checklist.
5. Stop once the vault would be meaningfully more useful than the starter scaffold. Do not stretch the conversation into full discovery or planning if the baseline is already adequate.

## Mapping Rules

- Put cross-plan technical structure in `vault/shared/architecture.md`.
- Put coding conventions, repository habits, testing expectations, constraints, and recurring implementation preferences in `vault/shared/patterns.md`.
- Put durable cross-plan product or technical decisions in `vault/shared/decisions.md`.
- Put active-plan framing, scope notes, stakeholders, definitions, and success context in `vault/plans/<slug>/context.md`.
- Put plan-specific discoveries that may matter across multiple milestones in `vault/plans/<slug>/discoveries.md`.
- Put plan-scoped choices and rationale in `vault/plans/<slug>/decisions.md`.
- Put durable references such as key commands, docs, repo paths, or external systems in `vault/plans/<slug>/references.md` only when they are relevant to the active plan.

When information could fit in both places, prefer `vault/shared/` for reusable project-wide facts and `vault/plans/<slug>/` for details tied to the current initiative.

## Boundaries That Matter

- Do not create milestones, acceptance criteria, completion evidence, or review state in the vault.
- Do not move canonical milestone logic out of `plans/*.md`.
- Do not write runtime counters, loop state, or session bookkeeping.
- Do not invent a plan slug. If none is known, stay in `vault/shared/` and report that plan-scoped starter files were skipped.
- Do not pad files with generic filler. A short, specific note is better than a broad template dump.

These boundaries keep the vault useful as context without turning it into a shadow plan system or runtime store.

## Writing Guidance

- Prefer short sections with concrete facts.
- Preserve existing user-authored content unless it is clearly starter placeholder text being replaced with better grounded notes.
- Use headings that make scanning easy, such as `## System shape`, `## Constraints`, or `## Open questions`.
- Record uncertainty explicitly when the user has not decided something yet.
- If the conversation reveals a gap that should influence future milestones, call it out as a follow-up note instead of silently resolving it.

## Verification

- Confirm every written note came from the user conversation or clearly identified existing repo context.
- Confirm no plan milestones, acceptance criteria, or runtime state were added to vault files.
- Confirm each file update matches the shared-vs-plan-scoped split.
- Confirm the final response names which files were updated and which context gaps remain.

## Failure Behavior

If blocked, return:

- blocked: what context could not be grounded
- why: the missing project facts, missing plan slug, or conflicting existing vault content
- unblock: the smallest question or file path needed next

## Required Output

Return:

- interview_summary: the project context captured from the conversation
- files_to_update: exact vault files created or edited, grouped by shared vs plan-scoped
- mapping_notes: why each file received the information it did
- unresolved_gaps: missing facts that should be captured later
- boundary_check: confirmation that milestones and runtime logic stayed outside the vault

---
plan: prompt-contract-remediation
created: 2026-03-08
status: complete
---

# Plan: Prompt Contract Remediation

## Overview
This plan fixes the remaining prompt, contract, and documentation gaps across the framework's skills, agents, and subagents without expanding into runtime or external-tool integration work. The first milestones address concrete orchestration mismatches that can cause planner-builder drift or incorrect completion handling; later milestones add the smallest repo-native review coverage and then tighten second-tier consistency improvements.

## Research Summary
- **Local context**: `README.md`, `plans/README.md`, `plans/PLAN.md`, `agents/hf-planner-light.md`, `agents/hf-builder-deep.md`, `subagents/hf-reviewer.md`, `subagents/hf-build-validator.md`, `skills/milestone-tracking/SKILL.md`, and `skills/verification-before-completion/SKILL.md` already establish a doc-first contract, but they still disagree on planner-light scout input shape, build-validator ownership, final verification gating, and where final evidence lands.
- **Web research**: Anthropic guidance emphasizes trigger-forward descriptions, progressive disclosure, and iterative prompt review with lightweight evaluation scaffolding; external agent-workflow guidance reinforces that handoff criteria and enforcement points should be explicit rather than implied.
- **Code examples**: Local `REVIEW.md` plus `evals/evals.json` patterns under planning skills already provide a lightweight review-fixture model, and public examples reinforce colocating human review criteria with prompt fixtures and making handoff boundaries explicit in the prompt itself.

## Milestones
- [x] 1. Fix hard planner-builder-reviewer contract mismatches - Update the affected prompts so `hf-planner-light`, `hf-builder-deep`, `hf-reviewer`, and `hf-build-validator` agree on scout input shape, validator ownership, reviewer inputs, and verification gating, with acceptance criteria that remove all currently identified cross-file ambiguities.
  - files: `agents/hf-planner-light.md`, `agents/hf-builder-deep.md`, `subagents/hf-reviewer.md`, `subagents/hf-build-validator.md`
  - review: approved by `hf-reviewer` after direct file inspection confirmed the scout brief shape, validator ownership, reviewer input contract, and final verification gating now align
  - verification: prompt/contract/doc-only milestone; direct file inspection only, no runtime command required
- [x] 2. Align completion and evidence-recording docs with the corrected contracts - Update the relevant skills and plan docs so milestone evidence, final verification evidence, and `status: complete` transitions are described consistently and a builder can finish the last milestone without inventing where evidence belongs.
  - files: `skills/milestone-tracking/SKILL.md`, `skills/verification-before-completion/SKILL.md`, `plans/README.md`, `plans/PLAN.md`
  - review: direct file inspection confirmed milestone evidence, final verification evidence placement, and `status: complete` transitions now point to the same plan-doc contract
  - verification: prompt/contract/doc-only milestone; direct file inspection only, no runtime command required
- [x] 3. Add repo-native review scaffolding for the uncovered prompt surface - Add lightweight `REVIEW.md` and `evals/evals.json` coverage for `skills/milestone-tracking`, `skills/verification-before-completion`, and the highest-risk agent/subagent prompt surfaces, with acceptance criteria that document the key regression checks for completion gating and approval-loop behavior.
  - files: `skills/milestone-tracking/REVIEW.md`, `skills/milestone-tracking/evals/evals.json`, `skills/verification-before-completion/REVIEW.md`, `skills/verification-before-completion/evals/evals.json`, `agents/REVIEW.md`, `agents/evals/evals.json`, `subagents/REVIEW.md`, `subagents/evals/evals.json`
  - review: approved by `hf-reviewer` after direct inspection confirmed lightweight repo-native scaffolding for completion gating and approval-loop behavior across the targeted skills, agents, and subagents
  - verification: `python -c "import json; paths=[r'skills/milestone-tracking/evals/evals.json', r'skills/verification-before-completion/evals/evals.json', r'agents/evals/evals.json', r'subagents/evals/evals.json']; [json.load(open(path, 'r', encoding='utf-8')) for path in paths]; print('json-ok')"` passed
- [x] 4. Tighten second-tier trigger and wording consistency across the prompt surface - Make a bounded pass over all skills, agents, and subagents to sharpen descriptions and delegation wording without changing workflow scope, with acceptance criteria that clearly separate must-fix contract text from non-critical clarity improvements.
  - files: `agents/hf-builder-deep.md`, `agents/hf-builder-light.md`, `agents/hf-planner-deep.md`, `agents/hf-planner-light.md`, `skills/brainstormer/SKILL.md`, `skills/local-context/SKILL.md`, `skills/milestone-tracking/SKILL.md`, `skills/plan-synthesis/SKILL.md`, `skills/verification-before-completion/SKILL.md`, `subagents/hf-build-validator.md`, `subagents/hf-code-search-scout.md`, `subagents/hf-coder.md`, `subagents/hf-local-context-scout.md`, `subagents/hf-reviewer.md`, `subagents/hf-web-research-scout.md`
  - review: approved by `hf-reviewer` after direct inspection confirmed bounded trigger-forward description and delegation wording improvements across all prompt files, with must-fix contract text still intact
  - verification: `git diff -- agents/*.md skills/*/SKILL.md subagents/*.md` confirmed the milestone 4 patch stayed limited to prompt wording updates
  - final verification: full-plan scope satisfied by reviewer-approved milestone evidence, plan-doc evidence is recorded under each completed milestone, and this prompt/contract/doc-only plan is ready for `status: complete`

## Risks & Open Questions
- The repo currently has skill-level review scaffolding but no established agent/subagent fixture convention, so milestone 3 should define the lightest viable pattern and avoid inventing a heavy new framework.
- Some wording changes may reveal additional minor inconsistencies once milestone 1 lands; milestone 4 should absorb those only if they stay prompt/contract/doc-only.
- External guidance is useful for review criteria, but the plan should keep outputs repo-native and avoid drifting into Anthropic-specific tooling or packaging work.

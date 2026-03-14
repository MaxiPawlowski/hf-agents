---
name: hf-workflow-eval
description: >
  Use when you need a health check on the hybrid framework's prompts, execution patterns,
  or eval coverage. Runs three evaluation passes — prompt regression, execution analysis,
  and prompt quality audit — then writes a structured report with prioritized improvements.
  Invoke this skill whenever prompt files change, after a plan completes, or when workflow
  quality feels unclear. Also use it when reviewing the framework before a release or when
  investigating why plans are stalling or escalating too often.
autonomy: supervised
context_budget: 12000 / 4000
max_iterations: 1
---

# Workflow Evaluation

Iron law: every finding must cite the specific file and line that triggered it. Vague assessments like "prompts could be clearer" waste the reader's time.

## Overview

This skill evaluates the hybrid framework's health across three dimensions: whether prompts still match their eval expectations, whether real execution artifacts reveal bottlenecks, and whether prompt quality checks have adequate coverage. It produces a single markdown report that surfaces the highest-priority improvements.

The report is diagnostic, not prescriptive — it flags what's wrong and where, but the human decides what to fix and in what order.

## When to Use

- After editing any prompt file (SKILL.md, agent, or subagent) to check for regressions.
- After a plan reaches `status: complete` to review execution efficiency.
- Periodically as a framework health check.
- When investigating why plans stall, escalate, or waste turns.

## When Not to Use

- During active implementation — the skill reads artifacts, it doesn't produce code.
- When no plan has been executed yet (Pass 2 needs runtime artifacts).
- As a substitute for running `npm test` — this skill checks prompt and workflow quality, not TypeScript correctness.

## Workflow

### Pass 1: Prompt Regression

Check whether each prompt still satisfies its eval fixture expectations.

1. Discover all eval fixture files:
   - `skills/*/evals/evals.json`
   - `agents/evals/evals.json`
   - `subagents/evals/evals.json`

2. For each eval case, identify the corresponding prompt file. Use these conventions:
   - If the case has a `prompt` field, resolve it relative to the repo root.
   - Otherwise, derive it from the parent: `skills/<name>/SKILL.md`, or `agents/hf-planner.md` / `agents/hf-builder.md`, or `subagents/hf-coder.md` / `subagents/hf-reviewer.md`.

3. Read the prompt file and evaluate each case:
   - For each `must_include` item: assess whether the prompt's current text addresses the concept. Use semantic judgment — the prompt doesn't need to contain the exact words, but the intent and behavior must be present.
   - For each `must_not` item: assess whether the prompt avoids the anti-pattern.
   - Score: `pass` (clearly addressed), `warn` (ambiguous or implicit), `fail` (missing or contradicted).

4. Record results in a table.

### Pass 2: Execution Analysis

Analyze runtime artifacts to surface workflow bottlenecks.

1. Scan for runtime artifacts:
   - `plans/runtime/*/status.json` — runtime state snapshots
   - `plans/runtime/*/events.jsonl` — event logs

2. For each plan with artifacts, compute these metrics:
   - **Turn efficiency**: `totalTurns / milestoneCount` — how many evaluated turns per milestone. Below 3 is good; above 5 signals friction.
   - **Escalation rate**: how often `loopState` reached `escalated` or `paused`. Any escalation is worth noting.
   - **Blocker frequency**: `repeatedBlocker` count — how many times the same blocker recurred. Three or more is a problem the prompt should prevent.
   - **No-progress streaks**: longest run of turns with state `blocked` and no file changes. Three or more suggests the agent is stuck in a loop.
   - **Trailer compliance**: `turnsSinceLastOutcome` — how often agents stopped without emitting the turn_outcome trailer. Above 20% of total attempts is a training gap.

3. Flag metrics that cross thresholds:
   - Turn efficiency > 5: `warn`
   - Any escalation: `info`
   - No-progress streak >= 3: `warn`
   - Trailer miss rate > 20%: `warn`

4. If no runtime artifacts exist, note that Pass 2 was skipped and why.

### Pass 3: Prompt Quality Audit

Cross-reference REVIEW.md regression checks against prompt content and eval coverage.

1. Discover all REVIEW.md files:
   - `skills/*/REVIEW.md`
   - `agents/REVIEW.md`
   - `subagents/REVIEW.md`

2. For each REVIEW.md:
   a. Extract the regression checks list (lines under `## Regression Checks` that start with `- `).
   b. Read the corresponding prompt file(s) listed under `## Covered Prompt Surface`.
   c. For each regression check, assess whether the prompt still addresses it. Score as `covered` or `gap`.

3. Cross-reference with eval fixtures:
   a. For each regression check, check whether any eval case in the corresponding `evals.json` tests it (match by `focus` topics).
   b. Flag regression checks with no matching eval case as **coverage gaps**.

4. Look for undocumented behavior:
   a. Read the prompt and identify behavioral commitments (iron laws, workflow steps, failure behavior, required output) that aren't mentioned in any REVIEW.md regression check.
   b. Flag these as **undocumented behaviors** — not necessarily problems, but risks if the behavior changes without anyone noticing.

## Report Format

Write the report to `plans/evidence/YYYY-MM-DD-workflow-eval.md`:

```md
# Workflow Evaluation Report - YYYY-MM-DD

**Overall health**: [emoji] [status]
**Score**: X/Y checks passed

## 1. Prompt Regression (X/Y pass, W warn, F fail)

| Case | Prompt | Focus | Result | Notes |
|------|--------|-------|--------|-------|
| case-id | path/to/prompt.md | focus topics | pass/warn/fail | brief explanation |

## 2. Execution Analysis (N plans analyzed)

### plan-slug (M milestones, status)
- Turn efficiency: X.X turns/milestone [flag]
- Escalations: N [flag]
- Blocker frequency: N repeated [flag]
- No-progress streaks: longest N [flag]
- Trailer compliance: X% [flag]

### Overall execution summary
[1-2 sentences on the dominant pattern]

## 3. Prompt Quality Audit (N surfaces, M gaps)

### prompt-file.md (via REVIEW.md)
- Regression checks: X/Y covered
- Eval coverage: X/Y checks have matching eval cases
- Coverage gaps: [list of uncovered checks]
- Undocumented behaviors: [list or "none found"]

## Recommendations

1. [Highest priority — cite the specific file, check, and what to do]
2. [Second priority]
3. [Third priority]
...
```

**Overall health scoring**:
- All pass, no gaps: `Good`
- Any warn or 1-2 gaps: `Needs attention`
- Any fail or 3+ gaps: `Action required`

## Verification

- Confirm the report file exists at the expected path.
- Confirm all three passes ran (or note which were skipped and why).
- Confirm every finding cites a specific file path.
- Confirm recommendations are actionable and prioritized.

## Failure Behavior

If blocked, return:

- blocked: which pass could not complete
- why: the missing file, unparseable artifact, or structural issue
- unblock: the specific fix needed (e.g., "create agents/evals/evals.json" or "run a plan to generate runtime artifacts")

Partial results are acceptable — if Pass 2 has no artifacts, still run Passes 1 and 3 and note the skip.

## Integration

- Invoked on-demand by user or planner. No automatic triggering.
- Reads existing files only — no modifications to prompts, runtime, or parser.
- Consumes: eval fixtures, prompt files, REVIEW.md files, runtime artifacts.
- Produces: a markdown report at `plans/evidence/YYYY-MM-DD-workflow-eval.md`.

## Required Output

Return:

- report_path: path to the written report file
- overall_health: `good`, `needs_attention`, or `action_required`
- pass_results: summary counts per pass (pass/warn/fail for regression, metrics for execution, covered/gap for audit)
- top_recommendations: the 3 highest-priority improvements from the report

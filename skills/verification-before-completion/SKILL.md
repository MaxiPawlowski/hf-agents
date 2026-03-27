---
name: hf-verification-before-completion
description: >
  Use when implementation is about to be declared done and scope coverage, policy
  compliance, and evidence freshness still need a final check. Verify the actual requested
  scope with the narrowest relevant checks, then report any remaining gaps clearly.
autonomy: autonomous
context_budget: 8000 / 2000
max_iterations: 3
disable-model-invocation: true
---

# Verification Before Completion

Iron law: never declare completion without fresh evidence tied to the exact scope being closed. If the required verification cannot run, escalate to the user — do not substitute a weaker method and claim verification passed.

## Verification Tiers

Select the highest applicable tier for each changed artifact:

- **static-read** — config, docs, prompts, frontmatter. Re-read the file after the last edit and confirm it matches the acceptance criterion.
- **command-execution** — code, scripts, test files, build configs. Run the narrowest command that can falsify the claim and report exit code and key output. Reading source is not sufficient.
- **browser-check** — UI components, CSS, HTML. Inspect the rendered DOM or capture a screenshot. A passing build alone does not verify visual correctness.
- **manual-attestation** — third-party integrations, environment-dependent behavior. Escalate to the user with what needs human confirmation and why.

## Overview

Use this skill for the final verification pass before a builder or reviewer reports work complete. It is a read-only check on scope fit, required gates, and evidence freshness.

The plan doc remains the canonical record of milestone state. Runtime artifacts or prior runs can inform the check, but they do not replace current evidence, and the final verification result belongs under the last completed milestone before the plan moves to `status: complete`.

## When to Use

- Before declaring a milestone or full plan complete.
- Before reporting success on work that required tests, builds, screenshots, or other proof.
- When a reviewer or builder needs a final confidence check against the original request.

## When Not to Use

- Brainstorming or open-ended exploration with no completion claim.
- Re-running the same verification with no code or artifact changes since the last pass.

## Workflow

1. Scope-fit gate: map the original request or milestone acceptance criterion to the delivered behavior.
2. Constraint gate: confirm the workflow respected explicit limits such as no unapproved git actions, no scope expansion, and any required builder/runtime constraints.
3. Evidence gate: classify each changed artifact by its verification tier and gather the required evidence. If the required tier cannot run, escalate rather than falling back to a weaker method.
4. Recording gate: make sure the final verification evidence can be recorded under the last completed milestone in the plan doc.
5. Completion summary: assemble a user-facing summary before any `status: complete` transition — what was verified, how, and what remains unverified or pending human confirmation.
6. Gap gate: call out anything unverified, any known trade-off, and whether it blocks completion.

## Verification

- Confirm the reported changed files match the implementation summary.
- Confirm required commands or inspections ran after the last relevant code change.
- Confirm evidence is specific to the requested scope rather than reused from an earlier state.
- Confirm the completion claim matches both the milestone acceptance criterion and any explicit user constraints.
- Confirm final verification evidence is ready to attach under the last completed milestone before any `status: complete` transition.

Choose the verification method that fits the artifact tier. If the required tier cannot be executed, escalate — do not silently downgrade.

## Failure Behavior

If blocked, return:

- blocked: what cannot yet be verified
- why: the missing evidence, unresolved scope gap, or policy violation
- unblock: the smallest concrete action needed to finish verification

Escalate to the user when completion depends on a trade-off or waiver that the workflow cannot decide alone.

## Integration

- Used by builders before final completion reporting.
- Consumes implementation summaries, reviewer output, and any required artifacts.
- Produces completion-ready evidence and remaining gaps for the final response and for the last completed milestone entry in the plan doc.

## Required Output

Return:

- scope_map: how the delivered work maps to the requested scope
- evidence: commands, inspections, or captures used for verification and their results
- completion_summary: user-facing summary of what was verified, how, and what remains unverified or pending
- gaps: anything still unverified or intentionally out of scope
- completion_decision: `ready` or `blocked`

### Completion decision criteria

The builder uses `completion_decision` to auto-complete the plan without human acknowledgment. The decision must reflect whether every artifact was verified at its appropriate tier:

- **`ready`**: every changed artifact was verified at the tier it requires — static-read for config/docs/prompts, command-execution for code/scripts/tests/builds, browser-check for UI components. All evidence is fresh and attached. The builder will set `status: complete` autonomously.
- **`blocked`**: one or more artifacts that require command-execution or browser-check verification lack real evidence at that tier. Reading source is not sufficient for code artifacts. A passing build alone is not sufficient for UI artifacts. The builder will escalate to the user with the specific gap.

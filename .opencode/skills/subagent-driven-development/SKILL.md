---
name: hf-subagent-driven-development
description: >
  Use when executing an already-approved plan through planner, coder, reviewer chain in one session.
  Do NOT use when discovery is still open-ended or requirements are materially ambiguous.
autonomy: supervised
context_budget: 12000 / 3000
max_iterations: 6
---

# Subagent-Driven Development

## Iron Law

Every delegation must preserve scope boundaries; any ambiguity returns to orchestrator before coding.

## Scope

One implementation session executing one approved plan through handoff, planning refinement, coding, and review. Constraints: no worktrees unless explicitly requested; no automatic git actions unless explicitly requested; tests optional unless toggle gates require them; subagents do not run unsolicited brainstorming. Use `@.opencode/context/project/subagent-handoff-template.md` for every delegation (typed artifacts). If multiple tasks are independent, batch and use parallel delegation.

## Workflow

1. **Handoff gate** — Entry: approved plan exists. Build a minimal handoff using the subagent-handoff-template. Validate: objective + scope-in/scope-out + constraints + acceptance + evidence-required are all explicit. Exit: handoff bundle passes schema validation.
2. **Planning refinement gate** — Entry: valid handoff bundle. `hf-task-planner` refines steps only (no scope expansion). Exit: steps are deterministic and each has a verify command.
3. **Implementation gate** — Entry: refined plan with verify steps. `hf-coder` applies only scoped changes. Exit: files touched + commands run + results are reported.
4. **Review gate** — Entry: implementation complete. `hf-reviewer` runs pass 1 (spec-fit: confirm requested behavior present, no unrequested behavior added, runtime preferences respected — fail fast on scope drift) and pass 2 (quality/risk: prioritize by severity). Re-run both passes after non-trivial fixes. Exit: approved yes/no with findings and next action.

## Verification

- Run: `npm run build`
- Expect: build success after implementation.
- Run: `git status --short`
- Expect: changed files match coder and reviewer summaries.

## Error Handling

- On requirement ambiguity: return `{ blocked: "ambiguous requirement", why: "<specific ambiguity>", unblock: "orchestrator must clarify <requirement> before coding" }`.
- On brainstorming needed: return `{ blocked: "design decision needed", why: "<unresolved design choice>", unblock: "return to orchestrator for hf-brainstorming unless explicit delegation provided" }`.
- On scope conflict: return `{ blocked: "scope conflict", why: "<conflicting instructions>", unblock: "prioritize explicit user instruction" }`.
- On missing context: return `{ blocked: "insufficient context", why: "<what is missing>", unblock: "run ContextScout for <specific question>" }`.
- On pass 1 scope failure: stop delegation chain, report blocking finding, route back to Coder or orchestrator.
- On unresolvable requirement conflict: escalate to user.

## Circuit Breaker

- Warning at 4 iterations (expect handoff + plan + code + review).
- Hard stop at 6 — report current state and escalate.
- On coder-reviewer ping-pong (same finding returned 3 times): stop and escalate to orchestrator.

## Examples

### Correct
Approved plan, one coder pass, two reviewer passes, then concise pass/fail summary with evidence. This works because the linear chain preserves scope at each gate, and two review passes catch both spec drift and quality issues.

### Anti-pattern
Skipping reviewer pass 2 after meaningful code changes. This fails because quality/risk issues go undetected, and pass 1 (spec-fit) alone doesn't assess implementation safety.

## Red Flags

- "Plan is clear enough" without explicit handoff fields.
- "One review pass is probably enough."

## Handoffs

- **Before:** approved plan + handoff bundle (schema: `subagent-handoff-template.md`) from `hf-core-delegation` or `hf-core-agent`.
- **After:** `{ coder_summary: { files_touched[], commands_run[], results[] }, reviewer_report: { approved: bool, findings[], evidence_gaps[], next_action } }`.

## Rollback

1. Revert coder file changes via `git checkout -- <files>`.
2. Report partial completion state and findings to orchestrator.

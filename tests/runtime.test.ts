import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { runDoctor } from "../src/runtime/doctor.js";
import { parsePlan } from "../src/runtime/plan-doc.js";
import { getRuntimePaths, getVaultPaths, readStatus, readVaultContext } from "../src/runtime/persistence.js";
import { HybridLoopRuntime, resolveManagedPlanPath } from "../src/runtime/runtime.js";
import {
  TURN_OUTCOME_TRAILER_FORMAT,
  buildTurnOutcomeIngestionEvent,
  extractTurnOutcomeTrailer,
  parseTurnOutcomeInput
} from "../src/runtime/turn-outcome-trailer.js";
import type { TurnOutcome } from "../src/runtime/types.js";

async function createPlan(root: string, body: string): Promise<string> {
  const plansDir = path.join(root, "plans");
  await mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, "2026-03-07-test-plan.md");
  await writeFile(planPath, body, "utf8");
  return planPath;
}

function outcome(state: TurnOutcome["state"], overrides?: Partial<TurnOutcome>): TurnOutcome {
  return {
    state,
    summary: `${state} summary`,
    files_changed: [],
    tests_run: [],
    next_action: "Take the next smallest step.",
    ...overrides
  };
}

describe("parsePlan enriched milestones", () => {
  test("parses context metadata from indented lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-parse-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add validation - reject empty inputs",
      "  - scope: `src/api/users.ts`, `tests/api/users.test.ts`",
      "  - conventions: zod validation (ref: `src/api/auth.ts`)",
      "  - notes: endpoint uses express router pattern",
      "  - review: auto"
    ].join("\n"));

    const plan = await parsePlan(planPath);
    const m = plan.milestones[0]!;

    expect(m.title).toBe("Add validation - reject empty inputs");
    expect(m.context?.scope).toEqual(["src/api/users.ts", "tests/api/users.test.ts"]);
    expect(m.context?.conventions).toBe("zod validation (ref: `src/api/auth.ts`)");
    expect(m.context?.notes).toBe("endpoint uses express router pattern");
    expect(m.reviewPolicy).toBe("auto");
  });

  test("parses user intent from a dedicated section", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-parse-"));
    const planPath = await createPlan(root, [
      "---",
      "status: planning",
      "---",
      "# Plan: Test",
      "",
      "## User Intent",
      "Review all files and apply the validation standard.",
      "",
      "## Milestones",
      "- [ ] 1. Review src/api/users.ts - apply the validation standard",
      "  - review: auto"
    ].join("\n"));

    const plan = await parsePlan(planPath);
    const m = plan.milestones[0]!;

    expect(plan.status).toBe("planning");
    expect(plan.userIntent).toContain("Review all files and apply the validation standard.");
    expect(plan.approved).toBe(false);
    expect(m.reviewPolicy).toBe("auto");
  });

  test("ignores evidence lines and does not treat them as context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-parse-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [x] 1. Add validation - reject empty inputs",
      "  - scope: `src/api/users.ts`",
      "  - review: auto",
      "  - files: `src/api/users.ts`",
      "  - verification: `npm test` passed",
      "  - review: approved by hf-reviewer - looks good"
    ].join("\n"));

    const plan = await parsePlan(planPath);
    const m = plan.milestones[0]!;

    expect(m.context?.scope).toEqual(["src/api/users.ts"]);
    expect(m.reviewPolicy).toBe("auto");
    // Evidence review line should not overwrite policy
    expect(m.reviewPolicy).not.toBe("approved by hf-reviewer - looks good");
  });

  test("old plan format without metadata still parses identically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-parse-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core",
      "- [ ] 2. Add hooks"
    ].join("\n"));

    const plan = await parsePlan(planPath);

    expect(plan.milestones).toHaveLength(2);
    expect(plan.milestones[0]!.context).toBeUndefined();
    expect(plan.milestones[0]!.reviewPolicy).toBeUndefined();
    expect(plan.milestones[1]!.context).toBeUndefined();
  });

  test("handles mixed enriched and plain milestones", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-parse-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add validation - reject empty inputs",
      "  - scope: `src/api/users.ts`",
      "  - review: auto",
      "- [ ] 2. Add hooks",
      "- [ ] 3. Refactor auth - extract shared util",
      "  - scope: `src/middleware/auth.ts`",
      "  - conventions: middleware pattern from `src/middleware/cors.ts`",
      "  - review: required"
    ].join("\n"));

    const plan = await parsePlan(planPath);

    expect(plan.milestones).toHaveLength(3);
    expect(plan.milestones[0]!.reviewPolicy).toBe("auto");
    expect(plan.milestones[1]!.context).toBeUndefined();
    expect(plan.milestones[1]!.reviewPolicy).toBeUndefined();
    expect(plan.milestones[2]!.context?.scope).toEqual(["src/middleware/auth.ts"]);
    expect(plan.milestones[2]!.reviewPolicy).toBe("required");
  });

  test("treats loop-style metadata as non-canonical evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-parse-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [x] 1. Simplify files - lint clean",
      "  - loop: `src/modules/**/*.ts` (12 items)",
      "  - completed: 12/12 items"
    ].join("\n"));

    const plan = await parsePlan(planPath);
    expect(plan.milestones[0]!.context).toBeUndefined();
    expect(plan.milestones[0]!.reviewPolicy).toBeUndefined();
  });
});

describe("HybridLoopRuntime", () => {
  test("resolves the latest plan when started from the repo root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const olderPlanPath = path.join(root, "plans", "2026-03-06-older-plan.md");
    await mkdir(path.dirname(olderPlanPath), { recursive: true });
    await writeFile(olderPlanPath, ["# Plan: Older", "", "## Milestones", "- [ ] 1. Older milestone"].join("\n"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const latestPlanPath = await createPlan(root, ["# Plan: Test", "", "## Milestones", "- [ ] 1. Add runtime core"].join("\n"));

    await expect(resolveManagedPlanPath(root)).resolves.toBe(latestPlanPath);
  });

  test("resolves a plan when started from a nested directory under the repo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, ["# Plan: Test", "", "## Milestones", "- [ ] 1. Add runtime core"].join("\n"));
    const nestedDir = path.join(root, "src", "features", "nested");
    await mkdir(nestedDir, { recursive: true });

    await expect(resolveManagedPlanPath(nestedDir)).resolves.toBe(planPath);
  });

  test("resolves a plan when started from the plans directory itself", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, ["# Plan: Test", "", "## Milestones", "- [ ] 1. Add runtime core"].join("\n"));

    await expect(resolveManagedPlanPath(path.join(root, "plans"))).resolves.toBe(planPath);
  });

  test("hydrates from a plan and writes sidecar state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "---",
      "status: in-progress",
      "---",
      "",
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core",
      "- [ ] 2. Add hooks"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const persisted = await readStatus(getRuntimePaths(plan));

    expect(status.currentMilestone?.title).toBe("Add runtime core");
    expect(status.phase).toBe("execution");
    expect(persisted?.planSlug).toBe("test");
  });

  test("vault discovery returns an empty result when no vault content exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const plan = await parsePlan(planPath);
    const vault = await readVaultContext(getVaultPaths(plan));

    expect(vault.plan).toEqual([]);
    expect(vault.shared).toEqual([]);
  });

  test("vault discovery reads plan-specific and shared markdown when present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));
    const plan = await parsePlan(planPath);
    const vaultPaths = getVaultPaths(plan);

    await mkdir(vaultPaths.planDir, { recursive: true });
    await mkdir(vaultPaths.sharedDir, { recursive: true });
    await writeFile(path.join(vaultPaths.planDir, "context.md"), "# Context\n\nPlan-local note", "utf8");
    await writeFile(path.join(vaultPaths.sharedDir, "architecture.md"), "# Architecture\n\nShared note", "utf8");

    const vault = await readVaultContext(vaultPaths);

    expect(vault.plan).toHaveLength(1);
    expect(vault.plan[0]?.title).toBe("Plan context");
    expect(vault.plan[0]?.content).toContain("Plan-local note");
    expect(vault.shared).toHaveLength(1);
    expect(vault.shared[0]?.title).toBe("Shared architecture");
    expect(vault.shared[0]?.content).toContain("Shared note");
  });

  test("planning status enters planner-reviewer runtime phase", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "---",
      "status: planning",
      "---",
      "",
      "# Plan: Test",
      "",
      "## User Intent",
      "Review all files and apply X.",
      "",
      "## Milestones",
      "- [ ] 1. Review src/runtime/runtime.ts - apply X"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const decision = runtime.decideNext();
    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(status.phase).toBe("planning");
    expect(decision.action).toBe("continue");
    expect(prompt).toContain("planning-review loop");
    expect(prompt).toContain("## User intent");
    expect(prompt).toContain("hf-plan-reviewer");
  });

  test("pauses after three no-progress blocked turns", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    await runtime.evaluateTurn(outcome("blocked", { blocker: { message: "same blocker" } }));
    await runtime.evaluateTurn(outcome("blocked", { blocker: { message: "same blocker" } }));
    const status = await runtime.evaluateTurn(outcome("blocked", { blocker: { message: "same blocker" } }));
    const decision = runtime.decideNext();

    expect(status.loopState).toBe("escalated");
    expect(status.counters.repeatedBlocker).toBe(3);
    expect(decision.action).toBe("escalate");
  });

  test("tracks verification failures separately from progress", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    await runtime.evaluateTurn(outcome("progress", {
      files_changed: ["src/runtime/runtime.ts"],
      tests_run: [{ command: "npm test", result: "fail", summary: "unit failure" }]
    }));
    const status = await runtime.evaluateTurn(outcome("progress", {
      files_changed: ["src/runtime/runtime.ts"],
      tests_run: [{ command: "npm test", result: "fail", summary: "unit failure" }]
    }));

    expect(status.counters.verificationFailures).toBe(2);
    expect(runtime.decideNext().action).toBe("pause");
  });

  test("counts trailerless stops toward the hard attempt limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "---",
      "max_turns: 2",
      "---",
      "",
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    await runtime.evaluateTurn(outcome("progress"));
    const status = await runtime.noteStopWithoutOutcome();

    expect(status.counters.totalAttempts).toBe(2);
    expect(status.counters.totalTurns).toBe(1);
    expect(status.counters.turnsSinceLastOutcome).toBe(1);
    expect(status.loopState).toBe("paused");
    expect(runtime.decideNext().action).toBe("max_turns");
  });

  test("resume prompt carries recovery context across stop and resume without stale warning text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    await runtime.recordEvent({
      vendor: "claude",
      type: "claude.Stop",
      timestamp: "2026-03-08T00:00:00.000Z",
      sessionId: "claude-stop"
    });
    await runtime.noteStopWithoutOutcome();
    await runtime.recordEvent({
      vendor: "claude",
      type: "claude.SessionStart",
      timestamp: "2026-03-08T00:01:00.000Z",
      sessionId: "claude-resume"
    });

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).toContain("## Recovery");
    expect(prompt).toContain("Resumed after stop in claude session claude-resume.");
    expect(prompt).toContain("without a TurnOutcome trailer");
    expect(prompt).not.toContain("## Warning:");
  });

  test("resume prompt surfaces runtime-owned escalation guidance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    await runtime.evaluateTurn(outcome("blocked", { blocker: { message: "same blocker" } }));
    await runtime.evaluateTurn(outcome("blocked", { blocker: { message: "same blocker" } }));
    await runtime.evaluateTurn(outcome("blocked", { blocker: { message: "same blocker" } }));

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).toContain("## Runtime state: escalated");
    expect(prompt).toContain("Runtime ownership: the same blocker has repeated three times without progress.");
    expect(prompt).toContain("React to this runtime state instead of inventing local retry counters.");
    expect(prompt).toContain("same blocker (repeated 3 times).");
  });

  test("doctor catches out-of-sync status files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core",
      "- [ ] 2. Add hooks"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const plan = await parsePlan(planPath);
    const runtimePaths = getRuntimePaths(plan);
    const status = await readStatus(runtimePaths);
    if (!status) {
      throw new Error("expected status");
    }

    status.currentMilestone = {
      index: 2,
      checked: false,
      text: "2. Add hooks",
      title: "Add hooks"
    };

    await writeFile(runtimePaths.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    const result = await runDoctor(planPath);

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("out of sync");
  });

  test("resume prompt is written alongside status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    await runtime.evaluateTurn(outcome("progress", {
      summary: "Implemented storage layer",
      files_changed: ["src/runtime/persistence.ts"],
      next_action: "Wire the runtime into the OpenCode idle hook."
    }));

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).toContain("## Current milestone");
    expect(prompt).toContain("Loop attempts: 1/");
    expect(prompt).toContain("Evaluated outcomes: 1.");
    expect(prompt).toContain("1. Add runtime core");
    expect(prompt).toContain("Wire the runtime into the OpenCode idle hook.");
    expect(prompt).toContain(TURN_OUTCOME_TRAILER_FORMAT);
  });

  test("resume prompt includes enriched milestone context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add validation - reject empty inputs",
      "  - scope: `src/api/users.ts`, `tests/api/users.test.ts`",
      "  - conventions: zod validation (ref: `src/api/auth.ts`)",
      "  - notes: endpoint uses express router pattern",
      "  - review: auto"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).toContain("## Current milestone");
    expect(prompt).toContain("1. Add validation - reject empty inputs");
    expect(prompt).toContain("scope: `src/api/users.ts`, `tests/api/users.test.ts`");
    expect(prompt).toContain("conventions: zod validation");
    expect(prompt).toContain("notes: endpoint uses express router pattern");
    expect(prompt).toContain("review: auto");
  });

  test("resume prompt includes vault context between milestone and last turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));
    const plan = await parsePlan(planPath);
    const vaultPaths = getVaultPaths(plan);
    await mkdir(vaultPaths.planDir, { recursive: true });
    await mkdir(vaultPaths.sharedDir, { recursive: true });
    await writeFile(path.join(vaultPaths.planDir, "discoveries.md"), "# Discoveries\n\nPlan finding", "utf8");
    await writeFile(path.join(vaultPaths.sharedDir, "patterns.md"), "# Patterns\n\nShared pattern", "utf8");

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");
    const currentMilestoneIndex = prompt.indexOf("## Current milestone");
    const vaultIndex = prompt.indexOf("## Vault context");
    const lastTurnIndex = prompt.indexOf("## Last turn");

    expect(vaultIndex).toBeGreaterThan(currentMilestoneIndex);
    expect(vaultIndex).toBeLessThan(lastTurnIndex);
    expect(prompt).toContain("### Plan discoveries");
    expect(prompt).toContain("Plan finding");
    expect(prompt).toContain("### Shared patterns");
    expect(prompt).toContain("Shared pattern");
  });

  test("resume prompt stays unchanged when no vault content exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).not.toContain("## Vault context");
    expect(prompt).not.toContain("[vault content truncated]");
  });

  test("resume prompt omits removed loop metadata from milestones", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Review src/modules/a.ts - lint clean",
      "  - scope: `src/modules/a.ts`",
      "  - review: auto"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).not.toContain("loop:");
    expect(prompt).not.toContain("per-item:");
    expect(prompt).not.toContain("skill:");
  });

  test("resume prompt omits context section for plain milestones", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(prompt).toContain("1. Add runtime core");
    expect(prompt).not.toContain("scope:");
    expect(prompt).not.toContain("conventions:");
    expect(prompt).not.toContain("review:");
  });

  test("all checked milestones stay incomplete until plan status is complete", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "---",
      "status: in-progress",
      "---",
      "",
      "# Plan: Test",
      "",
      "## Milestones",
      "- [x] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(plan.completed).toBe(false);
    expect(runtime.decideNext().action).toBe("continue");
    expect(prompt).toContain("## Final verification");
    expect(prompt).toContain("status: complete");
  });

  test("extracts the canonical turn_outcome trailer from the final response block", () => {
    const parsed = extractTurnOutcomeTrailer([
      "Implemented milestone 1.",
      "",
      "turn_outcome:",
      "```json",
      JSON.stringify(outcome("progress"), null, 2),
      "```"
    ].join("\n"));

    expect(parsed).toMatchObject({ kind: "valid", source: "trailer" });
    if (parsed.kind !== "valid") {
      throw new Error("expected valid trailer");
    }
    expect(parsed.outcome.state).toBe("progress");
  });

  test("rejects non-terminal turn_outcome trailers so fallback stays explicit", () => {
    const parsed = extractTurnOutcomeTrailer([
      "turn_outcome:",
      "```json",
      JSON.stringify(outcome("progress"), null, 2),
      "```",
      "extra text"
    ].join("\n"));

    expect(parsed).toMatchObject({ kind: "missing", source: "trailer" });
  });

  test("parses raw JSON for manual CLI fallback and reports schema issues", () => {
    const valid = parseTurnOutcomeInput(JSON.stringify(outcome("progress")));
    expect(valid).toMatchObject({ kind: "valid", source: "raw_json" });

    const invalid = parseTurnOutcomeInput("{\"summary\":\"missing fields\"}");
    expect(invalid.kind).toBe("invalid");
    if (invalid.kind !== "invalid") {
      throw new Error("expected invalid raw JSON payload");
    }
    expect(invalid.errors[0]?.path).toBe("$.state");
  });

  test("records invalid trailer diagnostics as events without changing counters", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    const before = runtime.getStatus().counters.totalTurns;

    const invalid = parseTurnOutcomeInput("{\"summary\":\"missing fields\"}");
    if (invalid.kind === "valid") {
      throw new Error("expected invalid payload");
    }

    await runtime.recordOutcomeIngestionIssue(buildTurnOutcomeIngestionEvent({
      vendor: "claude",
      source: "adapter stop hook",
      result: invalid
    }));

    expect(runtime.getStatus().counters.totalAttempts).toBe(before);
    expect(runtime.getStatus().counters.totalTurns).toBe(before);
  });

  test("preserves subagent startedAt when completion is recorded later", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    await runtime.recordSubagent({
      id: "subagent-1",
      name: "coder",
      startedAt: "2026-03-09T00:00:00.000Z",
      status: "running"
    });
    const status = await runtime.recordSubagent({
      id: "subagent-1",
      name: "coder",
      startedAt: "",
      completedAt: "2026-03-09T00:05:00.000Z",
      status: "completed"
    });

    expect(status.subagents[0]?.startedAt).toBe("2026-03-09T00:00:00.000Z");
    expect(status.subagents[0]?.completedAt).toBe("2026-03-09T00:05:00.000Z");
  });

  test("fails fast when status.json is corrupt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const runtimePaths = getRuntimePaths(plan);
    await writeFile(runtimePaths.statusPath, "{\"version\":1,\"planPath\":123}\n", "utf8");

    await expect(readStatus(runtimePaths)).rejects.toThrow("Invalid runtime status");
  });
});

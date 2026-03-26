import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { runDoctor } from "../src/runtime/doctor.js";
import { parsePlan } from "../src/runtime/plan-doc.js";
import { getRuntimePaths, getVaultPaths, readStatus, readVaultContext } from "../src/runtime/persistence.js";
import { HybridLoopRuntime, computeDecision, resolveManagedPlanPath } from "../src/runtime/runtime.js";
import type { DecisionInput } from "../src/runtime/runtime.js";
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

// NOTE: Core parsePlan tests live in plan-doc.test.ts. Only edge cases
// specific to the runtime's plan handling belong here.

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
    const decision = await runtime.decideNext();
    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(status.phase).toBe("planning");
    expect(decision.action).toBe("continue");
    expect(prompt).toContain("planning-review loop");
    expect(prompt).toContain("## User intent");
    expect(prompt).toContain("hf-plan-reviewer");
  });

  test("planner-to-builder transition waits for explicit human approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "---",
      "status: planning",
      "---",
      "",
      "# Plan: Test",
      "",
      "## User Intent",
      "Build the approved plan only after user confirmation.",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    await writeFile(planPath, [
      "---",
      "status: in-progress",
      "---",
      "",
      "# Plan: Test",
      "",
      "## User Intent",
      "Build the approved plan only after user confirmation.",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"), "utf8");

    const statusAfterApproval = await runtime.evaluateTurn(outcome("milestone_complete", {
      next_action: "Wait for the user to approve starting implementation."
    }));
    const blockedDecision = await runtime.decideNext();

    expect(statusAfterApproval.awaitingBuilderApproval).toBe(true);
    expect(blockedDecision.action).toBe("allow_stop");
    expect(blockedDecision.reason).toContain("human approval");

    await runtime.recordEvent({
      vendor: "opencode",
      type: "opencode.session.created",
      timestamp: new Date().toISOString(),
      sessionId: "manual-builder-start"
    });

    const resumedDecision = await runtime.decideNext();

    expect(runtime.getStatus().awaitingBuilderApproval).toBe(false);
    expect(resumedDecision.action).toBe("continue");
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
    const decision = await runtime.decideNext();

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
    expect((await runtime.decideNext()).action).toBe("pause");
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
    expect((await runtime.decideNext()).action).toBe("max_turns");
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
    // Vault context is lazy-loaded in decideNext(), which persists the
    // updated resume prompt including vault sections.
    await runtime.decideNext();

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
    expect((await runtime.decideNext()).action).toBe("continue");
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

  test("hydrate() reads IndexConfig from hybrid-framework.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    await writeFile(path.join(root, "hybrid-framework.json"), JSON.stringify({
      index: { enabled: true, semanticTopK: 42, charBudget: 1234 }
    }, null, 2), "utf8");

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const cfg = runtime.getIndexConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.semanticTopK).toBe(42);
    expect(cfg?.charBudget).toBe(1234);
  });

  test("hydratePlanless() reads IndexConfig from hybrid-framework.json in cwd", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));

    await writeFile(path.join(root, "hybrid-framework.json"), JSON.stringify({
      index: { enabled: true, semanticTopK: 7, planningCharBudget: 500 }
    }, null, 2), "utf8");

    const runtime = new HybridLoopRuntime();
    await runtime.hydratePlanless(root);

    const cfg = runtime.getIndexConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.semanticTopK).toBe(7);
    expect(cfg?.planningCharBudget).toBe(500);
  });

  test("hydrate() falls back to defaults when hybrid-framework.json has no index key", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    // No hybrid-framework.json — defaults should apply
    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    const cfg = runtime.getIndexConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.enabled).toBe(true);
    expect(cfg?.semanticTopK).toBe(5);
    expect(cfg?.charBudget).toBe(3000);
  });

  test("hydrate() respects index.enabled: false in config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-runtime-"));
    const planPath = await createPlan(root, [
      "# Plan: Test",
      "",
      "## Milestones",
      "- [ ] 1. Add runtime core"
    ].join("\n"));

    await writeFile(path.join(root, "hybrid-framework.json"), JSON.stringify({
      index: { enabled: false }
    }, null, 2), "utf8");

    const runtime = new HybridLoopRuntime();
    await runtime.hydrate(planPath);

    expect(runtime.getIndexConfig()?.enabled).toBe(false);
  });
});

describe("computeDecision", () => {
  function makeInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
    return {
      approved: true,
      completed: false,
      currentMilestone: { index: 1, checked: false, text: "1. Add runtime core", title: "Add runtime core" },
      milestoneCount: 2,
      loopState: "running",
      counters: {
        totalAttempts: 0,
        totalTurns: 0,
        maxTotalTurns: 50,
        noProgress: 0,
        repeatedBlocker: 0,
        verificationFailures: 0,
        turnsSinceLastOutcome: 0
      },
      lastOutcome: null,
      ...overrides
    };
  }

  // --- Planning phase ---
  test("planning: continues when draft needs approval", () => {
    const result = computeDecision(makeInput({ approved: false }));
    expect(result.action).toBe("continue");
  });

  test("planning: max_turns when limit reached", () => {
    const result = computeDecision(makeInput({
      approved: false,
      counters: { ...makeInput().counters, totalAttempts: 50, maxTotalTurns: 50 }
    }));
    expect(result.action).toBe("max_turns");
  });

  test("planning: escalates after 3 repeated blockers", () => {
    const result = computeDecision(makeInput({
      approved: false,
      counters: { ...makeInput().counters, repeatedBlocker: 3 }
    }));
    expect(result.action).toBe("escalate");
  });

  test("planning: pauses after 3 no-progress turns", () => {
    const result = computeDecision(makeInput({
      approved: false,
      counters: { ...makeInput().counters, noProgress: 3 }
    }));
    expect(result.action).toBe("pause");
  });

  test("planning: allow_stop when plan approved via milestone_complete", () => {
    const result = computeDecision(makeInput({
      approved: false,
      lastOutcome: outcome("milestone_complete")
    }));
    expect(result.action).toBe("allow_stop");
  });

  test("planning: continues on blocker below threshold", () => {
    const result = computeDecision(makeInput({
      approved: false,
      lastOutcome: outcome("blocked", { blocker: { message: "x" } })
    }));
    expect(result.action).toBe("continue");
  });

  // --- Execution phase ---
  test("execution: complete when plan is done", () => {
    const result = computeDecision(makeInput({ completed: true }));
    expect(result.action).toBe("complete");
  });

  test("execution: complete when loopState is complete", () => {
    const result = computeDecision(makeInput({ loopState: "complete" }));
    expect(result.action).toBe("complete");
  });

  test("execution: continue when all milestones checked but not complete", () => {
    const result = computeDecision(makeInput({ currentMilestone: null, completed: false }));
    expect(result.action).toBe("continue");
    expect(result.reason).toContain("final verification");
  });

  test("execution: max_turns when limit reached", () => {
    const result = computeDecision(makeInput({
      counters: { ...makeInput().counters, totalAttempts: 50, maxTotalTurns: 50 }
    }));
    expect(result.action).toBe("max_turns");
  });

  test("execution: escalates after 3 repeated blockers", () => {
    const result = computeDecision(makeInput({
      counters: { ...makeInput().counters, repeatedBlocker: 3 }
    }));
    expect(result.action).toBe("escalate");
  });

  test("execution: pauses after 2 verification failures", () => {
    const result = computeDecision(makeInput({
      counters: { ...makeInput().counters, verificationFailures: 2 }
    }));
    expect(result.action).toBe("pause");
    expect(result.reason).toContain("Verification failed");
  });

  test("execution: pauses after 3 no-progress turns", () => {
    const result = computeDecision(makeInput({
      counters: { ...makeInput().counters, noProgress: 3 }
    }));
    expect(result.action).toBe("pause");
    expect(result.reason).toContain("No progress");
  });

  test("execution: allow_stop on milestone_complete", () => {
    const result = computeDecision(makeInput({
      lastOutcome: outcome("milestone_complete")
    }));
    expect(result.action).toBe("allow_stop");
  });

  test("execution: continues on blocker below threshold", () => {
    const result = computeDecision(makeInput({
      lastOutcome: outcome("blocked", { blocker: { message: "x" } })
    }));
    expect(result.action).toBe("continue");
  });

  test("execution: continues when healthy", () => {
    const result = computeDecision(makeInput());
    expect(result.action).toBe("continue");
    expect(result.reason).toContain("healthy");
  });
});

// ---------------------------------------------------------------------------
// hydratePlanless
// ---------------------------------------------------------------------------

describe("hydratePlanless", () => {
  test("creates a planless runtime with default status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-planless-"));
    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydratePlanless(root);

    expect(status.planSlug).toBe("_planless");
    expect(status.phase).toBe("execution");
    expect(status.loopState).toBe("idle");
    expect(status.counters.totalAttempts).toBe(0);
    expect(status.counters.maxTotalTurns).toBe(50);
    expect(status.autoContinue).toBe(false);
    expect(runtime.isPlanless()).toBe(true);
    expect(runtime.getPlan()).toBeNull();
  });

  test("persists and reloads planless status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-planless-"));
    const runtime1 = new HybridLoopRuntime();
    const status1 = await runtime1.hydratePlanless(root);

    // Record an event to mutate state
    await runtime1.recordEvent({
      vendor: "runtime",
      type: "opencode.session.idle",
      timestamp: new Date().toISOString(),
    });

    // New runtime instance should load persisted status
    const runtime2 = new HybridLoopRuntime();
    const status2 = await runtime2.hydratePlanless(root);

    expect(status2.loopState).toBe(status1.loopState === "idle" ? "idle" : "running");
  });

  test("decideNext returns allow_stop for planless mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-planless-"));
    const runtime = new HybridLoopRuntime();
    await runtime.hydratePlanless(root);
    const decision = await runtime.decideNext();

    expect(decision.action).toBe("allow_stop");
    expect(decision.reason).toContain("No active plan");
  });
});

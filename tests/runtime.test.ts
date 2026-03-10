import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { runDoctor } from "../src/runtime/doctor.js";
import { parsePlan } from "../src/runtime/plan-doc.js";
import { getRuntimePaths, readStatus } from "../src/runtime/persistence.js";
import { HybridLoopRuntime } from "../src/runtime/runtime.js";
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

describe("HybridLoopRuntime", () => {
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
    expect(persisted?.planSlug).toBe("test");
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

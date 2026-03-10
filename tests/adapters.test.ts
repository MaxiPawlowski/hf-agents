import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  isDestructiveCommand,
  mapDecisionToClaudeStopResponse,
  recordSubagentLifecycle
} from "../src/adapters/lifecycle.js";
import { handleClaudeHook } from "../src/claude/hook-handler.js";
import { createHybridRuntimeHooks } from "../src/opencode/plugin.js";
import { parsePlan } from "../src/runtime/plan-doc.js";
import { getRuntimePaths } from "../src/runtime/persistence.js";
import { HybridLoopRuntime } from "../src/runtime/runtime.js";
import type { TurnOutcome } from "../src/runtime/types.js";

async function createPlan(root: string): Promise<string> {
  const plansDir = path.join(root, "plans");
  await mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, "2026-03-07-adapter-plan.md");
  await writeFile(planPath, [
    "# Plan: Adapter",
    "",
    "## Milestones",
    "- [ ] 1. Add loop runtime"
  ].join("\n"), "utf8");
  return planPath;
}

describe("adapter integration", () => {
  test("Claude Stop ingests a valid turn_outcome trailer automatically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);

    const response = await handleClaudeHook("Stop", {
      message: [
        "Implemented adapter ingestion.",
        "",
        "turn_outcome:",
        "```json",
        JSON.stringify({
          state: "progress",
          summary: "Captured the canonical trailer from Claude output.",
          files_changed: ["src/claude/hook-handler.ts"],
          tests_run: [],
          next_action: "Wire the same parser into OpenCode."
        }, null, 2),
        "```"
      ].join("\n")
    }, root, planPath);

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const events = await readFile(getRuntimePaths(plan).eventsPath, "utf8");

    expect(response.decision).toBe("block");
    expect(status.counters.totalAttempts).toBe(1);
    expect(status.counters.totalTurns).toBe(1);
    expect(status.counters.turnsSinceLastOutcome).toBe(0);
    expect(status.lastOutcome?.summary).toContain("canonical trailer");
    expect(events).toContain("turn_outcome.accepted");
    expect(events).not.toContain("claude.Stop");
  });

  test("Claude Stop records invalid trailers without incrementing turn counters", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);

    await handleClaudeHook("Stop", {
      message: [
        "turn_outcome:",
        "```json",
        JSON.stringify({ summary: "missing fields" }, null, 2),
        "```"
      ].join("\n")
    }, root, planPath);

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const events = await readFile(getRuntimePaths(plan).eventsPath, "utf8");

    expect(status.counters.totalAttempts).toBe(0);
    expect(status.counters.totalTurns).toBe(0);
    expect(status.counters.turnsSinceLastOutcome).toBe(0);
    expect(events).toContain("turn_outcome.trailer_invalid");
  });

  test("Claude Stop counts a missing trailer as a loop attempt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);

    await handleClaudeHook("Stop", {
      message: "Implemented work but forgot the trailer."
    }, root, planPath);

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const events = await readFile(getRuntimePaths(plan).eventsPath, "utf8");

    expect(status.counters.totalAttempts).toBe(1);
    expect(status.counters.totalTurns).toBe(0);
    expect(status.counters.turnsSinceLastOutcome).toBe(1);
    expect(events).toContain("turn_outcome.trailer_missing");
  });

  test("Claude Stop blocks when the loop should continue", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);
    const runtime = new HybridLoopRuntime();

    await runtime.hydrate(planPath);
    await runtime.evaluateTurn({
      state: "progress",
      summary: "Implemented runtime state persistence",
      files_changed: ["src/runtime/runtime.ts"],
      tests_run: [],
      next_action: "Add the OpenCode idle loop handler."
    });

    const response = await handleClaudeHook("Stop", {}, root, planPath);

    expect(response.decision).toBe("block");
  });

  test("Claude Stop allows non-continuation runtime decisions explicitly", async () => {
    expect(mapDecisionToClaudeStopResponse({
      action: "pause",
      reason: "Pause for user input."
    })).toEqual({
      decision: "allow",
      reason: "Pause for user input."
    });
    expect(mapDecisionToClaudeStopResponse({
      action: "escalate",
      reason: "Escalate after repeated blocker."
    })).toEqual({
      decision: "allow",
      reason: "Escalate after repeated blocker."
    });
    expect(mapDecisionToClaudeStopResponse({
      action: "allow_stop",
      reason: "Milestone complete."
    })).toEqual({
      decision: "allow",
      reason: "Milestone complete."
    });
  });

  test("Claude SessionStart returns additional context payload", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);

    const response = await handleClaudeHook("SessionStart", {}, root, planPath);
    expect(response).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart"
      }
    });
  });

  test("Claude compaction and resume keep recovery context coherent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);

    await handleClaudeHook("PreCompact", { session_id: "claude-compact" }, root, planPath);
    const response = await handleClaudeHook("SessionStart", { session_id: "claude-resume" }, root, planPath);

    expect(response).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart"
      }
    });
    const additionalContext = String((response as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "");
    expect(additionalContext).toContain("Resumed after compact in claude session claude-resume.");
    expect(additionalContext).not.toContain("## Warning:");
  });

  test("OpenCode pre-tool hook blocks destructive commands", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    await createPlan(root);
    const hooks = createHybridRuntimeHooks({ cwd: root, session: { id: "session-1" } });
    const preToolUse = hooks["tool.execute.before"];
    if (!preToolUse) {
      throw new Error("expected tool.execute.before hook");
    }

    await expect(
      preToolUse(
        { command: "git reset --hard HEAD~1" }
      )
    ).rejects.toThrow("Hybrid runtime guardrail blocked a destructive command.");
    expect(isDestructiveCommand("rm -rf dist")).toBe(true);
    expect(isDestructiveCommand("npm test")).toBe(false);
  });

  test("OpenCode idle hook returns a continue decision after progress", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);
    const runtime = new HybridLoopRuntime();
    const prompts: string[] = [];

    await runtime.hydrate(planPath);
    await runtime.evaluateTurn({
      state: "progress",
      summary: "Implemented runtime state persistence",
      files_changed: ["src/runtime/runtime.ts"],
      tests_run: [],
      next_action: "Add the Claude hook integration."
    } satisfies TurnOutcome);

    const hooks = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "session-2" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    const decision = await sessionIdle(
      { sessionID: "session-2" }
    );

    expect(decision).toMatchObject({ action: "continue" });
    const firstPrompt = prompts[0];
    if (!firstPrompt) {
      throw new Error("expected continuation prompt");
    }
    expect(firstPrompt).toContain("## Current milestone");
    expect(firstPrompt).toContain("1. Add loop runtime");
  });

  test("OpenCode idle is the canonical turn_outcome ingestion point", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);
    const prompts: string[] = [];
    const hooks = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "session-3" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    expect(hooks["session.updated"]).toBeUndefined();

    await sessionIdle({
      sessionID: "session-3",
      message: [
        "Implemented adapter ingestion.",
        "",
        "turn_outcome:",
        "```json",
        JSON.stringify({
          state: "progress",
          summary: "Captured the canonical trailer from OpenCode output.",
          files_changed: ["src/opencode/plugin.ts"],
          tests_run: [],
          next_action: "Verify Claude uses the same parser."
        }, null, 2),
        "```"
      ].join("\n")
    });

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const events = await readFile(getRuntimePaths(plan).eventsPath, "utf8");

    expect(status.counters.totalAttempts).toBe(1);
    expect(status.counters.totalTurns).toBe(1);
    expect(status.counters.turnsSinceLastOutcome).toBe(0);
    expect(status.lastOutcome?.files_changed).toContain("src/opencode/plugin.ts");
    expect(prompts[0]).toContain("## Current milestone");
    expect(prompts[0]).not.toContain("## Warning:");
    expect(events).toContain("turn_outcome.accepted");
    expect(events).not.toContain("opencode.session.idle");
  });

  test("OpenCode omits passive lifecycle hooks from the lean event surface", async () => {
    const hooks = createHybridRuntimeHooks({ cwd: process.cwd() });

    expect(hooks["tool.execute.after"]).toBeUndefined();
    expect(hooks["file.edited"]).toBeUndefined();
    expect(hooks["todo.updated"]).toBeUndefined();
    expect(hooks["permission.asked"]).toBeUndefined();
    expect(hooks["permission.replied"]).toBeUndefined();
  });

  test("shared subagent lifecycle helper preserves original startedAt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlan(root);
    const runtime = new HybridLoopRuntime();

    await runtime.hydrate(planPath);
    await recordSubagentLifecycle(runtime, {
      id: "subagent-1",
      name: "reviewer",
      status: "running"
    });
    const startedAt = runtime.getStatus().subagents[0]?.startedAt;
    await recordSubagentLifecycle(runtime, {
      id: "subagent-1",
      name: "reviewer",
      status: "completed"
    });

    expect(runtime.getStatus().subagents[0]?.startedAt).toBe(startedAt);
    expect(runtime.getStatus().subagents[0]?.completedAt).toBeTruthy();
  });
});

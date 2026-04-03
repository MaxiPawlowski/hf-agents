import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  isDestructiveCommand,
  isProtectedConfigEdit,
  recordSubagentLifecycle
} from "../src/adapters/lifecycle.js";
// @ts-ignore -- Vitest executes the JS installer module directly for consumer fixture coverage.
import { buildOpenCodePluginSource } from "../scripts/lib/install-opencode.mjs";
import { handleClaudeHook, mapDecisionToClaudeStopResponse } from "../src/claude/hook-handler.js";
import { createHybridRuntimeHooks } from "../src/opencode/plugin.js";
import { parsePlan } from "../src/runtime/plan-doc.js";
import { getRuntimePaths } from "../src/runtime/persistence.js";
import { HybridLoopRuntime } from "../src/runtime/runtime.js";
import type { TurnOutcome } from "../src/runtime/types.js";

/** Simulate an hf-agent message.updated event to set activeAgentIsHf = true */
const HF_AGENT_MESSAGE = { info: { role: "assistant" as const, agent: "hf-builder" } };

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

async function createEnrichedPlan(root: string, overrides?: { checkFirst?: boolean; checkFirstTwo?: boolean }): Promise<string> {
  const plansDir = path.join(root, "plans");
  await mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, "2026-03-07-enriched-adapter-plan.md");
  const m1Check = overrides?.checkFirst || overrides?.checkFirstTwo ? "x" : " ";
  const m2Check = overrides?.checkFirstTwo ? "x" : " ";
  await writeFile(planPath, [
    "---",
    "status: in-progress",
    "---",
    "",
    "# Plan: Enriched E2E Adapter",
    "",
    "## User Intent",
    "- Apply repo-native validation and config cleanup without hidden execution loops.",
    "",
    "## Milestones",
    `- [${m1Check}] 1. Add validation to user endpoints - reject empty inputs, cover with tests`,
    "  - scope: `src/api/users.ts`, `tests/api/users.test.ts`",
    "  - conventions: zod validation (ref: `src/api/auth.ts`), vitest for tests",
    "  - notes: endpoint uses express router pattern",
    "  - review: required",
    `- [${m2Check}] 2. Update config defaults - align with new schema`,
    "  - scope: `src/config/defaults.ts`",
    "  - review: auto",
    "- [ ] 3. Review src/modules/example.ts - simplify the module and keep lint clean",
    "  - scope: `src/modules/example.ts`",
    "  - notes: plan is fully enumerated before builder execution starts",
    "  - review: auto",
    "",
    "## Research Summary",
    "- Enriched milestones carry context through the runtime lifecycle."
  ].join("\n"), "utf8");
  return planPath;
}

async function createPlanningPlan(root: string): Promise<string> {
  const plansDir = path.join(root, "plans");
  await mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, "2026-03-07-planning-adapter-plan.md");
  await writeFile(planPath, [
    "---",
    "status: planning",
    "---",
    "",
    "# Plan: Planning Adapter",
    "",
    "## User Intent",
    "Only start building after the user approves the reviewed plan.",
    "",
    "## Milestones",
    "- [ ] 1. Start the approved implementation"
  ].join("\n"), "utf8");
  return planPath;
}

describe("adapter integration", () => {
  test("generated OpenCode plugin loader resolves the packaged consumer path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-loader-"));
    const packagedPluginPath = path.join(root, "node_modules", "hybrid-framework", "dist", "src", "opencode", "plugin.js");
    const generatedPluginPath = path.join(root, ".opencode", "plugins", "hybrid-runtime.js");

    await mkdir(path.dirname(packagedPluginPath), { recursive: true });
    await mkdir(path.dirname(generatedPluginPath), { recursive: true });
    await writeFile(packagedPluginPath, "export const HybridRuntimePlugin = { name: 'fixture-plugin' };\n", "utf8");
    await writeFile(generatedPluginPath, buildOpenCodePluginSource(root, "hybrid-framework"), "utf8");

    const imported = await import(`${pathToFileURL(generatedPluginPath).href}?fixture=${Date.now()}`) as {
      HybridRuntimePlugin?: { name?: string };
    };

    expect(imported.HybridRuntimePlugin?.name).toBe("fixture-plugin");
  });

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

  test("Claude hooks allow normal operation when no managed plan exists yet", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-no-plan-"));

    await expect(handleClaudeHook("SessionStart", {}, root)).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart"
      }
    });
    await expect(handleClaudeHook("Stop", {}, root)).resolves.toEqual({
      decision: "allow",
      reason: "No active plan. The runtime is providing guardrails only."
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
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "session-1" } });
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

  test("OpenCode hooks return no-op responses when session has no plan binding", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-no-plan-"));
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "session-no-plan" } });

    const sessionCreated = hooks["session.created"];
    const sessionStatus = hooks["session.status"];
    const sessionIdle = hooks["session.idle"];
    const preToolUse = hooks["tool.execute.before"];
    if (!sessionCreated || !sessionStatus || !sessionIdle || !preToolUse) {
      throw new Error("expected hooks");
    }

    // Guardrails still work (destructive command check is before runtime lookup)
    await expect(preToolUse({ command: "npm test" })).resolves.toBeNull();
    await expect(
      (hooks["tool.execute.before"] as Function)({ command: "git reset --hard HEAD~1" })
    ).rejects.toThrow("Hybrid runtime guardrail blocked a destructive command.");

    // Session hooks return empty no-op responses — no plan binding means no runtime
    await expect(sessionCreated({ sessionID: "session-no-plan" })).resolves.toMatchObject({});
    const status = await sessionStatus();
    expect(status).toMatchObject({ enabled: false });

    // Idle returns null when no plan binding (no runtime available for hf agent either)
    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    const idleResult = await sessionIdle({ sessionID: "session-no-plan" });
    expect(idleResult).toBeNull();
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

    const { hooks, planBindings } = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "session-2" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    // Bind this session to the plan path (simulates hf_plan_start tool call)
    planBindings.set("session-2", planPath);

    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
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
    const { hooks, planBindings } = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "session-3" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    // Bind this session to the plan path (simulates hf_plan_start tool call)
    planBindings.set("session-3", planPath);

    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    expect(hooks["session.updated"]).toBeUndefined();

    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
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

  test("OpenCode idle does not auto-prompt the builder after planner approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-"));
    const planPath = await createPlanningPlan(root);
    const prompts: string[] = [];
    const { hooks, planBindings } = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "approval-gate" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    // Bind this session to the plan path (simulates hf_plan_start tool call)
    planBindings.set("approval-gate", planPath);

    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    await writeFile(planPath, [
      "---",
      "status: in-progress",
      "---",
      "",
      "# Plan: Planning Adapter",
      "",
      "## User Intent",
      "Only start building after the user approves the reviewed plan.",
      "",
      "## Milestones",
      "- [ ] 1. Start the approved implementation"
    ].join("\n"), "utf8");

    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    const decision = await sessionIdle({
      sessionID: "approval-gate",
      message: [
        "Planner review passed.",
        "",
        "turn_outcome:",
        "```json",
        JSON.stringify({
          state: "milestone_complete",
          summary: "The plan was approved and is ready for human sign-off.",
          files_changed: [planPath],
          tests_run: [],
          next_action: "Wait for the user to approve starting hf-builder."
        }, null, 2),
        "```"
      ].join("\n")
    });

    expect(decision).toMatchObject({ action: "allow_stop" });
    expect(prompts).toHaveLength(0);
  });

  test("OpenCode omits passive lifecycle hooks from the lean event surface", async () => {
    const { hooks } = createHybridRuntimeHooks({ cwd: process.cwd() });

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

describe("enriched milestone adapter integration", () => {
  test("Claude SessionStart includes enriched context in resume prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-enriched-"));
    const planPath = await createEnrichedPlan(root);

    const response = await handleClaudeHook("SessionStart", {}, root, planPath);
    const additionalContext = String(
      (response as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? ""
    );

    expect(additionalContext).toContain("Add validation to user endpoints");
    expect(additionalContext).toContain("scope: `src/api/users.ts`, `tests/api/users.test.ts`");
    expect(additionalContext).toContain("conventions: zod validation");
    expect(additionalContext).toContain("notes: endpoint uses express router pattern");
    expect(additionalContext).toContain("review: required");
  });

  test("Claude Stop with enriched plan ingests turn outcome and preserves context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-enriched-"));
    const planPath = await createEnrichedPlan(root);

    await handleClaudeHook("Stop", {
      message: [
        "Implemented validation.",
        "",
        "turn_outcome:",
        "```json",
        JSON.stringify({
          state: "progress",
          summary: "Added zod validation to user endpoints.",
          files_changed: ["src/api/users.ts"],
          tests_run: [],
          next_action: "Add tests for the validation."
        }, null, 2),
        "```"
      ].join("\n")
    }, root, planPath);

    const runtime = new HybridLoopRuntime();
    const status = await runtime.hydrate(planPath);
    const plan = await parsePlan(planPath);
    const prompt = await readFile(getRuntimePaths(plan).resumePromptPath, "utf8");

    expect(status.counters.totalTurns).toBe(1);
    expect(status.currentMilestone?.context?.scope).toEqual(["src/api/users.ts", "tests/api/users.test.ts"]);
    expect(status.currentMilestone?.reviewPolicy).toBe("required");
    expect(prompt).toContain("scope: `src/api/users.ts`, `tests/api/users.test.ts`");
    expect(prompt).toContain("conventions: zod validation");
  });

  test("Claude SessionStart includes user intent and enumerated milestone context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-enriched-"));
    const planPath = await createEnrichedPlan(root, { checkFirstTwo: true });

    const response = await handleClaudeHook("SessionStart", {}, root, planPath);
    const additionalContext = String(
      (response as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? ""
    );

    expect(additionalContext).toContain("Review src/modules/example.ts");
    expect(additionalContext).toContain("scope: `src/modules/example.ts`");
    expect(additionalContext).not.toContain("loop:");
  });

  test("OpenCode session.created includes enriched context in resume prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-enriched-"));
    const planPath = await createEnrichedPlan(root);
    const { hooks, planBindings } = createHybridRuntimeHooks({ cwd: root, session: { id: "enriched-session" } });
    // Bind session to the plan
    planBindings.set("enriched-session", planPath);

    const sessionCreated = hooks["session.created"];
    if (!sessionCreated) {
      throw new Error("expected session.created hook");
    }

    const result = await sessionCreated({ sessionID: "enriched-session" }) as { additionalContext?: string };

    expect(result.additionalContext).toContain("Add validation to user endpoints");
    expect(result.additionalContext).toContain("scope: `src/api/users.ts`, `tests/api/users.test.ts`");
    expect(result.additionalContext).toContain("conventions: zod validation");
    expect(result.additionalContext).toContain("review: required");
  });

  test("OpenCode idle with enriched plan ingests outcome and continues with context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-enriched-"));
    const planPath = await createEnrichedPlan(root);
    const runtime = new HybridLoopRuntime();
    const prompts: string[] = [];

    await runtime.hydrate(planPath);
    await runtime.evaluateTurn({
      state: "progress",
      summary: "Started validation implementation.",
      files_changed: ["src/api/users.ts"],
      tests_run: [],
      next_action: "Add test coverage."
    } satisfies TurnOutcome);

    const { hooks, planBindings } = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "enriched-idle" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    // Bind session to the plan
    planBindings.set("enriched-idle", planPath);

    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    const decision = await sessionIdle({ sessionID: "enriched-idle" });

    expect(decision).toMatchObject({ action: "continue" });
    const firstPrompt = prompts[0];
    if (!firstPrompt) {
      throw new Error("expected continuation prompt");
    }
    expect(firstPrompt).toContain("scope: `src/api/users.ts`, `tests/api/users.test.ts`");
    expect(firstPrompt).toContain("conventions: zod validation");
    expect(firstPrompt).toContain("review: required");
  });

  test("OpenCode idle surfaces the next enumerated milestone without loop metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-enriched-"));
    const planPath = await createEnrichedPlan(root, { checkFirstTwo: true });
    const runtime = new HybridLoopRuntime();
    const prompts: string[] = [];

    await runtime.hydrate(planPath);
    await runtime.evaluateTurn({
      state: "progress",
      summary: "Completed first two milestones.",
      files_changed: [],
      tests_run: [],
      next_action: "Start the next enumerated milestone."
    } satisfies TurnOutcome);

    const { hooks, planBindings } = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "enriched-loop" },
      client: {
        prompt: async (message) => {
          prompts.push(message);
          return null;
        }
      }
    });
    // Bind session to the plan
    planBindings.set("enriched-loop", planPath);

    const sessionIdle = hooks["session.idle"];
    if (!sessionIdle) {
      throw new Error("expected session.idle hook");
    }

    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    const decision = await sessionIdle({ sessionID: "enriched-loop" });

    expect(decision).toMatchObject({ action: "continue" });
    const firstPrompt = prompts[0];
    if (!firstPrompt) {
      throw new Error("expected continuation prompt");
    }
    expect(firstPrompt).toContain("Review src/modules/example.ts");
    expect(firstPrompt).toContain("scope: `src/modules/example.ts`");
    expect(firstPrompt).not.toContain("loop:");
  });
});

describe("ESC-interrupt and agent-gating", () => {
  test("session.idle returns allow_stop after ESC interrupt (MessageAbortedError)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-interrupt-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "interrupt-test" } });

    // Activate hf agent, then simulate ESC abort.
    // message.updated uses context.session.id as fallback when info has no sessionID.
    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    await hooks["message.updated"]!({
      info: { role: "assistant", agent: "hf-builder", error: { name: "MessageAbortedError", data: { message: "User interrupted generation" } } }
    });

    const result = await hooks["session.idle"]!({ sessionID: "interrupt-test" });
    expect(result).toMatchObject({
      action: "allow_stop",
      reason: expect.stringContaining("interrupted")
    });
  });

  test("interrupted flag is consumed — second session.idle returns null (no plan binding)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-interrupt-consumed-"));
    await createPlan(root);
    const prompts: string[] = [];
    const { hooks } = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "consume-test" },
      client: {
        prompt: async (message) => { prompts.push(message); return null; }
      }
    });

    // Activate hf agent, trigger interrupt
    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    await hooks["message.updated"]!({
      info: { role: "assistant", agent: "hf-builder", error: { name: "MessageAbortedError", data: { message: "User interrupted generation" } } }
    });

    // First idle consumes the interrupt
    const first = await hooks["session.idle"]!({ sessionID: "consume-test" });
    expect(first).toMatchObject({ action: "allow_stop" });

    // Second idle: interrupted is false, activeAgentIsHf is true, but no plan binding → null
    const second = await hooks["session.idle"]!({ sessionID: "consume-test" });
    expect(second).toBeNull();
  });

  test("session.idle returns null with no prior message.updated", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-no-agent-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "no-agent-test" } });

    // No message.updated call — activeAgentIsHf defaults to false
    const result = await hooks["session.idle"]!({ sessionID: "no-agent-test" });
    expect(result).toBeNull();
  });

  test("session.idle returns null with a non-hf agent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-non-hf-agent-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "non-hf-test" } });

    // Set a non-hf agent
    await hooks["message.updated"]!({ info: { role: "assistant", agent: "some-other-agent" } });

    const result = await hooks["session.idle"]!({ sessionID: "non-hf-test" });
    expect(result).toBeNull();
  });

  test("tool.execute.before blocks destructive commands even with no hf agent active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-universal-guard-"));
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "universal-guard" } });

    // No message.updated — activeAgentIsHf is false
    await expect(
      hooks["tool.execute.before"]!({ command: "rm -rf /" })
    ).rejects.toThrow("Hybrid runtime guardrail blocked a destructive command.");

    // Set non-hf agent explicitly
    await hooks["message.updated"]!({ info: { role: "assistant", agent: "some-other-agent" } });
    await expect(
      hooks["tool.execute.before"]!({ command: "git reset --hard HEAD~1" })
    ).rejects.toThrow("Hybrid runtime guardrail blocked a destructive command.");
  });

  test("session.created works regardless of agent state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-session-created-"));
    const planPath = await createPlan(root);
    const { hooks, planBindings } = createHybridRuntimeHooks({ cwd: root, session: { id: "created-test" } });
    // Bind session to the plan so session.created has a runtime to work with
    planBindings.set("created-test", planPath);

    // No message.updated — activeAgentIsHf is false, but session.created is not gated
    const result = await hooks["session.created"]!({ sessionID: "created-test" }) as { additionalContext?: string };
    expect(result).toBeDefined();
    // session.created should still return additionalContext (resume prompt)
    expect(result.additionalContext).toBeDefined();
  });

  test("two sessions with different IDs get independent runtime instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-concurrent-"));
    const planPath1 = path.join(root, "plans", "2026-03-07-plan-a-plan.md");
    const planPath2 = path.join(root, "plans", "2026-03-07-plan-b-plan.md");
    await mkdir(path.join(root, "plans"), { recursive: true });
    await writeFile(planPath1, ["# Plan: A", "", "## Milestones", "- [ ] 1. Do A"].join("\n"), "utf8");
    await writeFile(planPath2, ["# Plan: B", "", "## Milestones", "- [ ] 1. Do B"].join("\n"), "utf8");

    const { hooks, planBindings, sessionRuntimes } = createHybridRuntimeHooks({ cwd: root });

    planBindings.set("session-A", planPath1);
    planBindings.set("session-B", planPath2);

    // Trigger runtime hydration for both sessions
    await hooks["session.created"]!({ sessionID: "session-A" });
    await hooks["session.created"]!({ sessionID: "session-B" });

    // Each session should have its own runtime promise
    expect(sessionRuntimes.has("session-A")).toBe(true);
    expect(sessionRuntimes.has("session-B")).toBe(true);
    expect(sessionRuntimes.get("session-A")).not.toBe(sessionRuntimes.get("session-B"));

    const runtimeA = await sessionRuntimes.get("session-A")!;
    const runtimeB = await sessionRuntimes.get("session-B")!;
    expect(runtimeA).not.toBeNull();
    expect(runtimeB).not.toBeNull();
    expect(runtimeA).not.toBe(runtimeB);
  });

  test("interrupted and activeAgentIsHf flags are per-session, not global", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-per-session-flags-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "session-flags-default" } });

    // Activate hf agent and interrupt for context.session.id (default fallback)
    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    await hooks["message.updated"]!({
      info: { role: "assistant", agent: "hf-builder", error: { name: "MessageAbortedError" } }
    });

    // session-flags-default: interrupted = true, activeAgentIsHf = true
    const resultDefault = await hooks["session.idle"]!({ sessionID: "session-flags-default" });
    expect(resultDefault).toMatchObject({ action: "allow_stop", reason: expect.stringContaining("interrupted") });

    // session-other: has its own independent flags (defaults to false/false)
    const resultOther = await hooks["session.idle"]!({ sessionID: "session-other" });
    expect(resultOther).toBeNull(); // non-hf agent (default), not interrupted
  });

  test("session with no plan binding returns null from getRuntime — hooks no-op gracefully", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-no-binding-"));
    const { hooks, getRuntime } = createHybridRuntimeHooks({ cwd: root, session: { id: "unbound" } });

    // No planBinding registered — getRuntime returns null immediately
    const runtime = await getRuntime("unbound");
    expect(runtime).toBeNull();

    // Hooks no-op gracefully
    await expect(hooks["session.created"]!({ sessionID: "unbound" })).resolves.toMatchObject({});
    await hooks["message.updated"]!(HF_AGENT_MESSAGE);
    await expect(hooks["session.idle"]!({ sessionID: "unbound" })).resolves.toBeNull();
  });
});

describe("protected config guardrail", () => {
  test("isProtectedConfigEdit blocks writes to .oxlintrc.json", () => {
    expect(isProtectedConfigEdit(".oxlintrc.json")).toBe(true);
    expect(isProtectedConfigEdit("/repo/.oxlintrc.json")).toBe(true);
    expect(isProtectedConfigEdit("C:\\repo\\.oxlintrc.json")).toBe(true);
  });

  test("isProtectedConfigEdit blocks writes to sonar-project.properties", () => {
    expect(isProtectedConfigEdit("sonar-project.properties")).toBe(true);
    expect(isProtectedConfigEdit("/repo/sonar-project.properties")).toBe(true);
  });

  test("isProtectedConfigEdit blocks writes to .husky/pre-commit", () => {
    expect(isProtectedConfigEdit(".husky/pre-commit")).toBe(true);
    expect(isProtectedConfigEdit("/repo/.husky/pre-commit")).toBe(true);
    expect(isProtectedConfigEdit("C:\\repo\\.husky\\pre-commit")).toBe(true);
  });

  test("isProtectedConfigEdit allows normal source files", () => {
    expect(isProtectedConfigEdit("src/adapters/lifecycle.ts")).toBe(false);
    expect(isProtectedConfigEdit("package.json")).toBe(false);
    expect(isProtectedConfigEdit("tsconfig.json")).toBe(false);
  });

  test("isProtectedConfigEdit allows bypass when HF_ALLOW_CONFIG_EDIT=1", () => {
    const original = process.env["HF_ALLOW_CONFIG_EDIT"];
    try {
      process.env["HF_ALLOW_CONFIG_EDIT"] = "1";
      expect(isProtectedConfigEdit(".oxlintrc.json")).toBe(false);
      expect(isProtectedConfigEdit("sonar-project.properties")).toBe(false);
      expect(isProtectedConfigEdit(".husky/pre-commit")).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env["HF_ALLOW_CONFIG_EDIT"];
      } else {
        process.env["HF_ALLOW_CONFIG_EDIT"] = original;
      }
    }
  });

  test("Claude PreToolUse blocks Write tool targeting .oxlintrc.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-"));
    await createPlan(root);

    const response = await handleClaudeHook("PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: ".oxlintrc.json" }
    }, root);

    expect(response.hookSpecificOutput).toMatchObject({
      permissionDecision: "deny"
    });
    const reason = String((response.hookSpecificOutput as { permissionDecisionReason?: string }).permissionDecisionReason ?? "");
    expect(reason).toContain("protected config file");
    expect(reason).toContain("HF_ALLOW_CONFIG_EDIT=1");
  });

  test("Claude PreToolUse blocks Edit tool targeting sonar-project.properties", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-"));
    await createPlan(root);

    const response = await handleClaudeHook("PreToolUse", {
      tool_name: "Edit",
      tool_input: { file_path: "sonar-project.properties" }
    }, root);

    expect(response.hookSpecificOutput).toMatchObject({
      permissionDecision: "deny"
    });
  });

  test("Claude PreToolUse allows Write tool targeting normal source files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-"));
    await createPlan(root);

    const response = await handleClaudeHook("PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: "src/foo.ts" }
    }, root);

    expect((response as { decision?: string }).decision).toBe("allow");
  });

  test("Claude PreToolUse allows Write tool targeting .oxlintrc.json with HF_ALLOW_CONFIG_EDIT=1", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-bypass-"));
    await createPlan(root);
    const original = process.env["HF_ALLOW_CONFIG_EDIT"];
    try {
      process.env["HF_ALLOW_CONFIG_EDIT"] = "1";
      const response = await handleClaudeHook("PreToolUse", {
        tool_name: "Write",
        tool_input: { file_path: ".oxlintrc.json" }
      }, root);
      expect((response as { decision?: string }).decision).toBe("allow");
    } finally {
      if (original === undefined) {
        delete process.env["HF_ALLOW_CONFIG_EDIT"];
      } else {
        process.env["HF_ALLOW_CONFIG_EDIT"] = original;
      }
    }
  });

  test("OpenCode tool.execute.before blocks edit to .husky/pre-commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-oc-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "guard-oc" } });

    await expect(
      hooks["tool.execute.before"]!({ file_path: ".husky/pre-commit" })
    ).rejects.toThrow("Hybrid runtime guardrail blocked an edit to protected config file");
  });

  test("OpenCode tool.execute.before blocks edit via filePath field", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-oc2-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "guard-oc2" } });

    await expect(
      hooks["tool.execute.before"]!({ tool_input: { filePath: "sonar-project.properties" } })
    ).rejects.toThrow("Hybrid runtime guardrail blocked an edit to protected config file");
  });

  test("OpenCode tool.execute.before allows normal file edits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-allow-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "guard-allow" } });

    await expect(
      hooks["tool.execute.before"]!({ file_path: "src/foo.ts" })
    ).resolves.toBeNull();
  });

  test("OpenCode tool.execute.before allows bypass when HF_ALLOW_CONFIG_EDIT=1", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-config-guard-bypass-oc-"));
    await createPlan(root);
    const { hooks } = createHybridRuntimeHooks({ cwd: root, session: { id: "guard-bypass-oc" } });
    const original = process.env["HF_ALLOW_CONFIG_EDIT"];
    try {
      process.env["HF_ALLOW_CONFIG_EDIT"] = "1";
      await expect(
        hooks["tool.execute.before"]!({ file_path: ".oxlintrc.json" })
      ).resolves.toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env["HF_ALLOW_CONFIG_EDIT"];
      } else {
        process.env["HF_ALLOW_CONFIG_EDIT"] = original;
      }
    }
  });
});

import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  isDestructiveCommand,
  mapDecisionToClaudeStopResponse,
  recordSubagentLifecycle
} from "../src/adapters/lifecycle.js";
// @ts-ignore -- Vitest executes the JS installer module directly for consumer fixture coverage.
import { buildOpenCodePluginSource } from "../scripts/install-runtime.mjs";
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

  test("OpenCode hooks operate in planless mode when no managed plan exists yet", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hf-adapter-no-plan-"));
    const hooks = createHybridRuntimeHooks({ cwd: root, session: { id: "session-no-plan" } });

    const sessionCreated = hooks["session.created"];
    const sessionStatus = hooks["session.status"];
    const sessionIdle = hooks["session.idle"];
    const preToolUse = hooks["tool.execute.before"];
    if (!sessionCreated || !sessionStatus || !sessionIdle || !preToolUse) {
      throw new Error("expected hooks");
    }

    // Guardrails still work
    await expect(preToolUse({ command: "npm test" })).resolves.toBeNull();
    await expect(
      (hooks["tool.execute.before"] as Function)({ command: "git reset --hard HEAD~1" })
    ).rejects.toThrow("Hybrid runtime guardrail blocked a destructive command.");

    // Session hooks return planless status
    await expect(sessionCreated({ sessionID: "session-no-plan" })).resolves.toEqual({});
    const status = await sessionStatus();
    expect(status).toMatchObject({ planless: true, planSlug: "_planless" });

    // Idle returns allow_stop decision instead of null
    const idleResult = await sessionIdle({ sessionID: "session-no-plan" });
    expect(idleResult).toMatchObject({ action: "allow_stop", reason: expect.stringContaining("No active plan") });
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
    await createEnrichedPlan(root);
    const hooks = createHybridRuntimeHooks({ cwd: root, session: { id: "enriched-session" } });
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

    const hooks = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "enriched-idle" },
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

    const hooks = createHybridRuntimeHooks({
      cwd: root,
      session: { id: "enriched-loop" },
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

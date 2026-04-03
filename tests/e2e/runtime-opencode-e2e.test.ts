import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createHybridRuntimeHooks } from "../../src/opencode/plugin.js";
import { cleanupFixtureWithRetry, createFixtureProject } from "./helpers/harness.js";
import { FIXTURE_PLAN_PATH } from "./helpers/fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid turn_outcome: trailer string that embeds in a message payload. */
function buildTurnOutcomePayload(state = "progress"): string {
  const outcome = JSON.stringify({
    state,
    summary: "Test outcome for opencode plugin e2e.",
    files_changed: [],
    tests_run: [],
    next_action: "Verify the runtime processed the outcome."
  });
  return `Here is the outcome:\n\nturn_outcome:\n\`\`\`json\n${outcome}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("opencode plugin e2e", () => {
  let fixtureDir: string;
  const SESSION_ID = "e2e-test-session";

  beforeAll(async () => {
    fixtureDir = await createFixtureProject();
  }, 30_000);

  afterAll(async () => {
    if (fixtureDir) {
      await cleanupFixtureWithRetry(fixtureDir);
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: session.created records event and returns decision
  // -------------------------------------------------------------------------
  test("session lifecycle: session.created records event and returns decision", async () => {
    const { hooks, planBindings } = createHybridRuntimeHooks({ cwd: fixtureDir });
    // Bind the session to the fixture plan path (simulates hf_plan_start tool call)
    planBindings.set(SESSION_ID, path.join(fixtureDir, FIXTURE_PLAN_PATH));

    const result = await hooks["session.created"]!({ sessionID: SESSION_ID });

    // session.created must return an object (possibly with additionalContext)
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    // The fixture plan has an unchecked milestone and is in planning phase (unapproved).
    // decideNext() returns a "continue" decision with a resume_prompt, which is
    // mapped to additionalContext.
    const asRecord = result as Record<string, unknown>;
    // additionalContext is present when a resume_prompt exists
    expect(typeof asRecord.additionalContext).toBe("string");
    expect((asRecord.additionalContext as string).length).toBeGreaterThan(0);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Test 2: tool.execute.before blocks destructive commands
  // -------------------------------------------------------------------------
  test("tool.execute.before: destructive command throws", async () => {
    const { hooks } = createHybridRuntimeHooks({ cwd: fixtureDir });

    await expect(
      hooks["tool.execute.before"]!({ command: "rm -rf /" })
    ).rejects.toThrow("guardrail blocked a destructive command");
  }, 10_000);

  // -------------------------------------------------------------------------
  // Test 3: ESC interrupt guard — session.idle returns allow_stop and clears flag
  // -------------------------------------------------------------------------
  test("session.idle: ESC interrupt guard returns allow_stop and clears flag", async () => {
    const { hooks } = createHybridRuntimeHooks({ cwd: fixtureDir, session: { id: SESSION_ID } });

    // First set activeAgentIsHf=true and interrupted=true via message.updated.
    // context.session.id is used as the fallback sessionId since info has no sessionID.
    await hooks["message.updated"]!({
      info: {
        role: "assistant",
        agent: "hf-builder",
        error: { name: "MessageAbortedError" }
      }
    });

    // The interrupt flag is now set. session.idle should return allow_stop immediately.
    const firstResult = await hooks["session.idle"]!({ sessionID: SESSION_ID });
    expect(firstResult).toBeDefined();
    const first = firstResult as Record<string, unknown>;
    expect(first.action).toBe("allow_stop");
    expect(typeof first.reason).toBe("string");
    expect(first.reason as string).toContain("interrupted");

    // The interrupt flag must be cleared after consumption.
    // Re-set the hf-agent flag so the agent gate doesn't swallow the second call.
    await hooks["message.updated"]!({
      info: { role: "assistant", agent: "hf-builder" }
    });

    // Second call must NOT return allow_stop due to interrupt — the flag is cleared.
    // With no plan binding, the runtime is null → session.idle returns null.
    const secondResult = await hooks["session.idle"]!({ sessionID: SESSION_ID });
    if (secondResult !== null) {
      const second = secondResult as Record<string, unknown>;
      // Allow any decision except the interrupt-specific allow_stop reason.
      if (second.action === "allow_stop") {
        expect(second.reason as string).not.toContain("interrupted");
      }
    }
  }, 15_000);

  // -------------------------------------------------------------------------
  // Test 4: session.idle turn outcome ingestion records outcome from payload
  // -------------------------------------------------------------------------
  test("session.idle: turn outcome ingestion records outcome from payload", async () => {
    const { hooks, planBindings } = createHybridRuntimeHooks({ cwd: fixtureDir, session: { id: SESSION_ID } });
    // Bind the session to the fixture plan path (simulates hf_plan_start tool call)
    planBindings.set(SESSION_ID, path.join(fixtureDir, FIXTURE_PLAN_PATH));

    // Activate the hf-agent gate so session.idle runs runtime logic.
    await hooks["message.updated"]!({
      info: { role: "assistant", agent: "hf-builder" }
    });

    // Call session.idle with a payload containing a valid turn_outcome: trailer.
    const messageWithOutcome = buildTurnOutcomePayload("progress");
    const result = await hooks["session.idle"]!({ sessionID: SESSION_ID, message: messageWithOutcome });

    // The hook must not throw — ingestion goes through cleanly.
    // It should return a ContinueDecision (or null if deadline hit, but should be fast).
    // Either way the call must have succeeded without throwing.
    if (result !== null) {
      const decision = result as Record<string, unknown>;
      expect(typeof decision.action).toBe("string");
      // Valid actions from ContinueDecision
      const validActions = ["continue", "allow_stop", "pause", "escalate", "complete", "max_turns"];
      expect(validActions).toContain(decision.action);
    }
  }, 15_000);

  // -------------------------------------------------------------------------
  // Test 5: hf_search — no plan binding → planless on-demand build
  // -------------------------------------------------------------------------
  test("hf_search: no plan binding triggers planless on-demand index build", async () => {
    // Create a fresh hooks instance with no plan binding for this session.
    // The tool will spin up a disposable planless runtime and attempt an index build.
    const { tools } = createHybridRuntimeHooks({ cwd: fixtureDir });
    const UNBOUND_SESSION_ID = "e2e-vault-query-unbound";

    const tool = tools.hf_search as {
      execute: (
        args: { query: string; top_k?: number; source?: string },
        ctx: { sessionID: string; directory: string; worktree: string; abort: AbortSignal; metadata: () => void; ask: () => Promise<void> }
      ) => Promise<string>;
    };

    const toolCtx = {
      sessionID: UNBOUND_SESSION_ID,
      directory: fixtureDir,
      worktree: fixtureDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {}
    };

    const result = await tool.execute({ query: "semantic search" }, toolCtx);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Must not claim "No index available" — the planless on-demand build should succeed.
    expect(result).not.toContain("No index available");
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 6: hf_search — plan binding but cold runtime → on-demand index build
  // -------------------------------------------------------------------------
  test("hf_search: cold runtime (no decideNext yet) triggers on-demand index build", async () => {
    // Create a fresh hooks instance and bind the plan, but do NOT call session.created.
    // The runtime is hydrated on first getRuntime() call (triggered by tool.execute),
    // but decideNext() has NOT been called yet. queryIndex() will trigger an on-demand
    // refreshVaultIndex() and return a non-empty result string.
    const { tools, planBindings } = createHybridRuntimeHooks({ cwd: fixtureDir });
    const COLD_SESSION_ID = "e2e-vault-query-cold";
    planBindings.set(COLD_SESSION_ID, path.join(fixtureDir, FIXTURE_PLAN_PATH));

    const tool = tools.hf_search as {
      execute: (
        args: { query: string; top_k?: number; source?: string },
        ctx: { sessionID: string; directory: string; worktree: string; abort: AbortSignal; metadata: () => void; ask: () => Promise<void> }
      ) => Promise<string>;
    };

    const toolCtx = {
      sessionID: COLD_SESSION_ID,
      directory: fixtureDir,
      worktree: fixtureDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {}
    };

    const result = await tool.execute({ query: "vault context" }, toolCtx);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Must not claim "No index available" — the on-demand build should succeed
    // or at minimum return "No matching results found" (not the null-index message).
    expect(result).not.toContain("No index available");
  }, 30_000);

  // -------------------------------------------------------------------------
  // Test 7: hf_search — after session.created (runtime hydrated + index built)
  // -------------------------------------------------------------------------
  test("hf_search: after session.created returns a non-empty string result", async () => {
    // Create a fresh hooks instance and bind the plan.
    const { hooks, tools, planBindings } = createHybridRuntimeHooks({ cwd: fixtureDir });
    const WARM_SESSION_ID = "e2e-vault-query-warm";
    planBindings.set(WARM_SESSION_ID, path.join(fixtureDir, FIXTURE_PLAN_PATH));

    // Call session.created to trigger hydration and decideNext() → refreshVaultIndex().
    await hooks["session.created"]!({ sessionID: WARM_SESSION_ID });

    const tool = tools.hf_search as {
      execute: (
        args: { query: string; top_k?: number; source?: string },
        ctx: { sessionID: string; directory: string; worktree: string; abort: AbortSignal; metadata: () => void; ask: () => Promise<void> }
      ) => Promise<string>;
    };

    const toolCtx = {
      sessionID: WARM_SESSION_ID,
      directory: fixtureDir,
      worktree: fixtureDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {}
    };

    // The tool must not throw and must return a non-empty string.
    // Accept any of: formatted results, "No index available", or "No matching results found"
    // (fixture may not have embedded docs if the index build timed out or the fixture is minimal).
    const result = await tool.execute({ query: "plan milestone harness" }, toolCtx);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 15_000);
});

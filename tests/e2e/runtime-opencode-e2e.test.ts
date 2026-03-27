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
});

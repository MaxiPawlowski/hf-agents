import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  cleanupFixtureWithRetry,
  createMinimalClaudeFixture,
  probeClaudeCodeAuth,
  readEventsJsonl,
  runClaudeCode
} from "./helpers/claude-harness.js";

const RUN_TIMEOUT_MS = 240_000;

// Planless mode: events go to plans/runtime/_planless/events.jsonl
function planlessEventsPath(fixtureDir: string): string {
  return path.join(fixtureDir, "plans", "runtime", "_planless", "events.jsonl");
}

describe("claude runtime e2e", () => {
  let fixtureDir: string;
  let authAvailable = false;
  let skipReason: string | undefined;

  beforeAll(async () => {
    const probe = await probeClaudeCodeAuth("Reply with the single word ready.", { timeoutMs: 30_000 });

    if (!probe.available) {
      skipReason = probe.reason;
      return;
    }

    authAvailable = true;
    fixtureDir = await createMinimalClaudeFixture();
  }, RUN_TIMEOUT_MS);

  afterAll(async () => {
    if (fixtureDir) {
      await cleanupFixtureWithRetry(fixtureDir);
    }
  });

  test("hooks fire and runtime events are recorded", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason);
    }

    const result = await runClaudeCode(
      fixtureDir,
      "Reply with the single word warmed.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    expect(result.exitCode, `claude failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.parsed).toBeDefined();
    expect(result.parsed?.is_error).toBeFalsy();

    const events = await readEventsJsonl(planlessEventsPath(fixtureDir));
    const types = events.map((e) => e.type);

    expect(types).toContain("claude.UserPromptSubmit");
    expect(types).toContain("claude.Stop");
  }, RUN_TIMEOUT_MS);

  test("stop hook runs reliably across multiple turns", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason);
    }

    const result = await runClaudeCode(
      fixtureDir,
      "Reply with the single word done.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    expect(result.exitCode, `claude failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    const events = await readEventsJsonl(planlessEventsPath(fixtureDir));
    const stopEvents = events.filter((e) => e.type === "claude.Stop");

    // Two runs have happened — expect two Stop events recorded
    expect(stopEvents.length).toBeGreaterThanOrEqual(2);
  }, RUN_TIMEOUT_MS);
});

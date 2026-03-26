import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  cleanupFixtureWithRetry,
  createClaudeCodeFixtureProject,
  probeClaudeCodeAuth,
  runClaudeCode
} from "./helpers/claude-harness.js";

const RUN_TIMEOUT_MS = 300_000; // 5 min — embedding model may need to warm up

// Vault plan fixture uses slug "test" (derived from "2026-01-01-test-plan.md")
// Events path: plans/runtime/test/events.jsonl
// Vault context is injected via UserPromptSubmit hook's additionalContext field.
// The hook builds the unified index lazily (first run loads ONNX embedding model).
// Requires: `claude login` (OAuth) and HF_RUN_SLOW=1

describe("claude vault e2e", () => {
  const runSlow = process.env.HF_RUN_SLOW === "1";

  let fixtureDir: string;
  let authAvailable = false;
  let skipReason: string | undefined;

  beforeAll(async () => {
    if (!runSlow) {
      skipReason = "Skipping vault claude e2e: set HF_RUN_SLOW=1 to enable (loads ONNX embedding model).";
      return;
    }

    const probe = await probeClaudeCodeAuth("Reply with the single word ready.", { timeoutMs: 30_000 });

    if (!probe.available) {
      skipReason = probe.reason;
      return;
    }

    authAvailable = true;
    fixtureDir = await createClaudeCodeFixtureProject();
  }, RUN_TIMEOUT_MS);

  afterAll(async () => {
    if (fixtureDir) {
      await cleanupFixtureWithRetry(fixtureDir);
    }
  });

  test("vault context is surfaced via hook injection", async (context) => {
    if (!runSlow || !authAvailable) {
      context.skip(skipReason);
    }

    // The UserPromptSubmit hook will:
    // 1. Hydrate the runtime with the plan
    // 2. Lazily load vault context and build the unified index (embedding model loads here)
    // 3. Return additionalContext with the resume prompt (includes vault content)
    // Claude receives this as injected context and answers based on it.
    const result = await runClaudeCode(
      fixtureDir,
      "Use the vault notes if available. In one sentence, explain the authentication guidance with one concrete mechanism from the project context.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    expect(result.exitCode, `claude failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.parsed).toBeDefined();
    expect(result.parsed?.is_error).toBeFalsy();

    // The vault/plans/test/context.md fixture contains:
    // "Rotate refresh tokens after each privileged session renewal so replayed credentials lose value quickly."
    const responseText = (result.parsed?.result ?? result.stdout).toLowerCase();
    expect(responseText).toContain("token rotation");
  }, RUN_TIMEOUT_MS);

  test("second run reuses warm index", async (context) => {
    if (!runSlow || !authAvailable) {
      context.skip(skipReason);
    }

    // On second run the index is already on disk — embedding model warm-up is skipped
    const result = await runClaudeCode(
      fixtureDir,
      "Use the vault notes if available. In one sentence, describe the billing pipeline from the project context.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    expect(result.exitCode, `claude failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.parsed?.is_error).toBeFalsy();

    // The vault/shared/architecture.md fixture contains:
    // "Invoice totals are computed from line item subtotals and tax before the final receipt is written."
    const responseText = (result.parsed?.result ?? result.stdout).toLowerCase();
    expect(responseText).toMatch(/invoice|billing|subtotal|receipt/);
  }, RUN_TIMEOUT_MS);
});

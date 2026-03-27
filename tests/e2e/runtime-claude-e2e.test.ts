import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  cleanupFixtureWithRetry,
  createMinimalClaudeFixture,
  probeClaudeCodeAuth,
  runClaudeInvocationDiagnostic,
  runClaudeCode,
  type ClaudeResult,
  type ClaudeRuntimeSidecar
} from "./helpers/claude-harness.js";

const RUN_TIMEOUT_MS = 240_000;

// Claude e2e contract:
// - The first two tests are the fast parity layer. They require a real authenticated
//   `claude -p ... --output-format json` generation run and only pass when that run
//   both returns a final response and writes planless runtime artifacts under
//   `plans/runtime/_planless/`.
// - The diagnostic invocation-path test is narrower: it proves which automated Claude
//   CLI shapes still honor the project hook settings versus bypassing them. It is hook-
//   wiring evidence, not the main managed-plan parity proof.
// - Skip condition: the whole file is user-actionably skipped when the Claude CLI is
//   missing or not logged in via `claude login`.

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

  test("real Claude run records a final response plus planless runtime artifacts", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason ?? "Skipping claude runtime e2e: claude CLI is unavailable or not authenticated.");
    }

    const result = await runClaudeCode(
      fixtureDir,
      "Reply with exactly the two words runtime ready.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    assertClaudeProducedResponse(result);
    expect(result.responseText?.toLowerCase()).toMatch(/runtime\s+ready/);

    const planless = result.runtime.planless;
    expect(planless, "Expected planless runtime artifacts under plans/runtime/_planless/").not.toBeNull();
    expect(planless?.eventsPath).toBe(planlessEventsPath(fixtureDir));
    expect(planless?.eventTypes).toContain("claude.UserPromptSubmit");
    expect(planless?.eventTypes).toContain("claude.Stop");
    expect(planless?.events.length ?? 0).toBeGreaterThanOrEqual(2);
  }, RUN_TIMEOUT_MS);

  test("multi-turn real Claude runs append repeated planless stop events", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason ?? "Skipping claude runtime e2e: claude CLI is unavailable or not authenticated.");
    }

    const firstResult = await runClaudeCode(
      fixtureDir,
      "Reply with exactly the word first.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );
    const secondResult = await runClaudeCode(
      fixtureDir,
      "Reply with exactly the word second.",
      { timeoutMs: RUN_TIMEOUT_MS, clearRuntimeArtifacts: false }
    );

    assertClaudeProducedResponse(firstResult);
    assertClaudeProducedResponse(secondResult);
    expect(firstResult.responseText?.toLowerCase()).toContain("first");
    expect(secondResult.responseText?.toLowerCase()).toContain("second");

    const planless = secondResult.runtime.planless;
    expect(planless, "Expected planless runtime artifacts after repeated Claude runs.").not.toBeNull();
    expect(countEvents(planless, "claude.UserPromptSubmit")).toBeGreaterThanOrEqual(2);
    expect(countEvents(planless, "claude.Stop")).toBeGreaterThanOrEqual(2);
  }, RUN_TIMEOUT_MS);

  test("diagnoses which real Claude automation paths produce responses versus hook side effects", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason ?? "Skipping Claude CLI diagnostics: claude CLI is unavailable or not authenticated.");
    }

    const model = process.env.HF_TEST_MODEL_CLAUDE ?? "claude-haiku-4-5-20251001";
    const message = "Reply with exactly the two words runtime ready.";
    const timeoutMs = RUN_TIMEOUT_MS;

    const jsonPrint = await runClaudeInvocationDiagnostic(
      fixtureDir,
      "print-json",
      ["-p", message, "--output-format", "json", "--model", model, "--dangerously-skip-permissions"],
      { timeoutMs }
    );

    const textPrint = await runClaudeInvocationDiagnostic(
      fixtureDir,
      "print-text",
      ["-p", message, "--output-format", "text", "--model", model, "--dangerously-skip-permissions"],
      { timeoutMs }
    );

    const jsonUserSettingsOnly = await runClaudeInvocationDiagnostic(
      fixtureDir,
      "print-json-user-settings-only",
      [
        "-p",
        message,
        "--output-format",
        "json",
        "--model",
        model,
        "--dangerously-skip-permissions",
        "--setting-sources",
        "user"
      ],
      { timeoutMs }
    );

    expect(jsonPrint.exitCode, `json print failed\nstdout: ${jsonPrint.stdout}\nstderr: ${jsonPrint.stderr}`).toBe(0);
    expect(textPrint.exitCode, `text print failed\nstdout: ${textPrint.stdout}\nstderr: ${textPrint.stderr}`).toBe(0);
    expect(jsonUserSettingsOnly.exitCode, `json print with user-only settings failed\nstdout: ${jsonUserSettingsOnly.stdout}\nstderr: ${jsonUserSettingsOnly.stderr}`).toBe(0);

    expect(jsonPrint.producedResponse).toBe(true);
    expect(textPrint.producedResponse).toBe(true);
    expect(jsonUserSettingsOnly.producedResponse).toBe(true);

    expect(jsonPrint.eventTypes).toContain("claude.UserPromptSubmit");
    expect(jsonPrint.eventTypes).toContain("claude.Stop");
    expect(textPrint.eventTypes).toContain("claude.UserPromptSubmit");
    expect(textPrint.eventTypes).toContain("claude.Stop");

    expect(jsonUserSettingsOnly.eventTypes, `Expected --setting-sources user to omit project hook settings.\nstdout: ${jsonUserSettingsOnly.stdout}\nstderr: ${jsonUserSettingsOnly.stderr}`).toEqual([]);
    expect(jsonUserSettingsOnly.resumePrompt).toBeNull();
  }, RUN_TIMEOUT_MS);
});

function assertClaudeProducedResponse(result: ClaudeResult): void {
  expect(result.exitCode, `claude failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
  expect(result.parsed, `Expected JSON output from Claude\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBeDefined();
  expect(result.parsed?.is_error, `Claude returned an error payload\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBeFalsy();
  expect(result.producedResponse, `Expected Claude to produce a final response\nstdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(true);
  expect(result.responseText).toBeTruthy();
}

function countEvents(sidecar: ClaudeRuntimeSidecar | null | undefined, type: string): number {
  return sidecar?.events.filter((event) => event.type === type).length ?? 0;
}

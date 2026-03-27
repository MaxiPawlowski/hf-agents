import { promises as fs } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  assertSuccessfulExit,
  cleanupFixtureWithRetry,
  createFixtureProject,
  normalizePath,
  probeOpenCodeAuth,
  runOpenCodeDebug,
  runOpenCodeWithLogs,
  seedUnifiedIndexFixture,
  waitForFile
} from "./helpers/harness.js";

const RUN_TIMEOUT_MS = 240_000;
const INDEX_WAIT_TIMEOUT_MS = 15_000;

describe("opencode runtime e2e", () => {
  let fixtureDir: string;
  let authAvailable = false;
  let skipReason: string | undefined;

  beforeAll(async () => {
    const probe = await probeOpenCodeAuth("Reply with the single word ready.", { timeoutMs: 30_000 });

    if (!probe.available) {
      skipReason = probe.reason;
      return;
    }

    authAvailable = true;
    fixtureDir = await createFixtureProject();
    await seedUnifiedIndexFixture(fixtureDir);
  }, RUN_TIMEOUT_MS);

  afterAll(async () => {
    if (fixtureDir) {
      await cleanupFixtureWithRetry(fixtureDir);
    }
  });

  test("plugin loads and unified index builds", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason);
    }

    // Verify plugin is registered (0 LLM calls)
    const configResult = await runOpenCodeDebug(fixtureDir, "config");
    assertSuccessfulExit(configResult.exitCode, "opencode debug config", configResult.stdout, configResult.stderr);
    expect(configResult.stdout).toContain("hybrid-runtime");

    // Warmup run with debug logs — verifies hooks fire AND triggers index build (1 LLM call)
    const warmupResult = await runOpenCodeWithLogs(
      fixtureDir,
      "Reply with the single word warmed.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    assertSuccessfulExit(warmupResult.exitCode, "opencode run warmup", warmupResult.stdout, warmupResult.stderr);
    expect(warmupResult.events.length).toBeGreaterThan(0);

    // Verify plugin hook evidence in stderr
    const hasHookEvidence = [
      "tool.execute.before",
      "experimental.session.compacting",
      "event:",
      "type=session.created",
      "type=session.idle",
      "type=session.status",
      "type=session.compacted"
    ].some((needle) => warmupResult.stderr.includes(needle));

    expect(hasHookEvidence).toBe(true);

    // Wait for index files
    const indexJsonPath = path.join(fixtureDir, ".hf", "index.json");
    const indexBinPath = path.join(fixtureDir, ".hf", "index.bin");

    await waitForFile(indexJsonPath, INDEX_WAIT_TIMEOUT_MS);
    await waitForFile(indexBinPath, INDEX_WAIT_TIMEOUT_MS);

    // Validate index structure
    const [rawIndex, binStats] = await Promise.all([
      fs.readFile(indexJsonPath, "utf8"),
      fs.stat(indexBinPath)
    ]);

    const index = JSON.parse(rawIndex) as {
      items: Array<{ metadata: Record<string, unknown> }>;
      fileHashes: Record<string, string>;
    };

    expect(binStats.size).toBeGreaterThan(0);
    expect(index.items).toHaveLength(9);

    // Verify both vault and code sources
    const indexedSources = index.items
      .map((item) => item.metadata.source ?? item.metadata.kind)
      .filter((value): value is string => value === "vault" || value === "code")
      .sort();

    expect(indexedSources).toContain("vault");
    expect(indexedSources).toContain("code");

    // Verify chunk counts per source path
    const sourcePaths = index.items.map((item) => normalizePath(String(item.metadata.sourcePath ?? "")));

    expect(countMatchingPaths(sourcePaths, "vault/plans/test/context.md")).toBe(3);
    expect(countMatchingPaths(sourcePaths, "vault/shared/architecture.md")).toBe(2);
    expect(countMatchingPaths(sourcePaths, "src/lib/billing.ts")).toBe(2);
    expect(countMatchingPaths(sourcePaths, "src/lib/session.ts")).toBe(2);

    // Verify fileHashes
    const hashedPaths = Object.keys(index.fileHashes).map((filePath) => normalizePath(filePath));
    expect(hashedPaths).toContain("src/lib/billing.ts");
    expect(hashedPaths).toContain("src/lib/session.ts");
    expect(hashedPaths).toContain("vault/plans/test/context.md");
    expect(hashedPaths).toContain("vault/shared/architecture.md");
  }, RUN_TIMEOUT_MS);

  test("semantic retrieval surfaces vault context", async (context) => {
    if (!authAvailable) {
      context.skip(skipReason);
    }

    // Query the model about vault content (1 LLM call)
    const runResult = await runOpenCodeWithLogs(
      fixtureDir,
      "Use the vault notes if available. Do not use tools. In one sentence, explain the authentication guidance with one concrete mechanism from the project context.",
      { timeoutMs: RUN_TIMEOUT_MS }
    );

    assertSuccessfulExit(runResult.exitCode, "opencode run semantic query", runResult.stdout, runResult.stderr);
    expect(runResult.events.length).toBeGreaterThan(0);

    const resumePromptPath = path.join(fixtureDir, "plans", "runtime", "test", "resume-prompt.txt");
    await waitForFile(resumePromptPath, INDEX_WAIT_TIMEOUT_MS);

    // Verify vault content surfaced in the runtime-injected resume prompt.
    // This is the adapter-facing payload that session.created/session.idle pass
    // through to OpenCode, so checking it is more stable than depending on the
    // model to quote the retrieved vault text verbatim.
    const resumePromptText = (await fs.readFile(resumePromptPath, "utf8")).toLowerCase();
    const vaultTerms = [
      "refresh token",
      "token rotation",
      "session renewal",
      "revoked session",
      "replayed credential",
      "privileged session"
    ];
    const matchedTerm = vaultTerms.find((term) => resumePromptText.includes(term))
      ?? (resumePromptText.includes("rotate") && resumePromptText.includes("token") ? "rotate+token" : undefined);

    expect(matchedTerm, `Expected vault content in resume prompt. Prompt excerpt: ${resumePromptText.slice(0, 500)}`).toBeDefined();
  }, RUN_TIMEOUT_MS);
});

function countMatchingPaths(paths: string[], expectedPath: string): number {
  return paths.filter((filePath) => filePath === expectedPath).length;
}

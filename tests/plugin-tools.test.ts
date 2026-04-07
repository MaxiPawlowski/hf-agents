import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — same two mocks required by all runtime-touching suites.
// vi.mock() calls are hoisted by vitest; they apply to the whole file.
// ---------------------------------------------------------------------------
vi.mock("../src/index/unified-index-pipeline.js", () => ({
  buildUnifiedIndex: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/index/vault-embeddings.js", () => ({
  embed: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0)),
  embedBatch: vi.fn().mockResolvedValue([]),
  warmupEmbeddingModel: vi.fn(),
  EmbeddingModelError: class EmbeddingModelError extends Error {},
}));

import { createPluginTools } from "../src/opencode/plugin-tools.js";
import type { SessionManager } from "../src/opencode/plugin-session.js";
import type { RuntimeStatus } from "../src/runtime/types.js";
import type { HybridLoopRuntime } from "../src/runtime/runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ToolContext — only sessionID and directory are used by the tools. */
function makeToolContext(sessionId: string, directory = process.cwd()) {
  return {
    sessionID: sessionId,
    messageID: "msg-test",
    agent: "hf-builder",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => {
      // no-op mock
    },
  };
}

/** Build a minimal SessionManager backed by real in-process Maps. */
function makeManager(
  overrides: Partial<Pick<SessionManager, "getRuntime">> = {}
): SessionManager {
  const planBindings = new Map<string, string>();
  const sessionRuntimes = new Map<string, Promise<HybridLoopRuntime | null>>();
  const sessionFlags = new Map<string, { interrupted: boolean; activeAgentIsHf: boolean }>();
  const sessionAccessOrder: string[] = [];

  return {
    planBindings,
    sessionRuntimes,
    sessionFlags,
    sessionAccessOrder,
    touchSession: () => undefined,
    getFlags: (id) => {
      let f = sessionFlags.get(id);
      if (!f) { f = { interrupted: false, activeAgentIsHf: false }; sessionFlags.set(id, f); }
      return f;
    },
    getRuntime: overrides.getRuntime ?? (async () => null),
  };
}

/** Build a minimal mock RuntimeStatus with sensible defaults. */
function makeMockStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    version: 1,
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- /tmp is intentional for test fixtures
    planPath: "/tmp/test/plans/test-plan.md",
    planSlug: "test-plan",
    planMtimeMs: Date.now(),
    loopState: "running",
    phase: "execution",
    currentMilestone: { index: 1, checked: false, text: "- [ ] 1. Do the thing", title: "Do the thing" },
    counters: {
      totalAttempts: 3,
      totalTurns: 2,
      maxTotalTurns: 50,
      noProgress: 0,
      repeatedBlocker: 0,
      verificationFailures: 0,
      turnsSinceLastOutcome: 1,
    },
    sessions: {},
    subagents: [],
    autoContinue: false,
    updatedAt: new Date().toISOString(),
    recommendedNextAction: "continue with M1",
    ...overrides,
  };
}

/** Build a minimal mock HybridLoopRuntime. */
function makeMockRuntime(statusOverrides: Partial<RuntimeStatus> = {}): HybridLoopRuntime {
  const status = makeMockStatus(statusOverrides);
  return {
    isPlanless: () => false,
    getStatus: () => status,
  } as unknown as HybridLoopRuntime;
}

// ---------------------------------------------------------------------------
// Minimal plan doc helpers
// ---------------------------------------------------------------------------

async function createTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "hf-plugin-tools-"));
}

async function writePlanDoc(dir: string, content: string, filename = "2026-01-01-test-plan.md"): Promise<string> {
  const plansDir = path.join(dir, "plans");
  await mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, filename);
  await writeFile(planPath, content, "utf8");
  return planPath;
}

const MINIMAL_PLAN = [
  "---",
  "status: in-progress",
  "---",
  "",
  "## Milestones",
  "- [ ] 1. Do the thing",
].join("\n");

const PLANNING_PLAN = [
  "---",
  "status: planning",
  "---",
  "",
  "## Milestones",
  "- [ ] 1. Do the thing",
].join("\n");

const MALFORMED_PLAN = "---\nstatus: planning\n---\n\n# No milestones section here\n";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("plugin-tools unit", () => {
  // -------------------------------------------------------------------------
  // hf_plan_status
  // -------------------------------------------------------------------------
  describe("hf_plan_status", () => {
    test("returns 'no plan bound' when planBindings is empty for the session", async () => {
      const manager = makeManager();
      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_status"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-1"));
      expect(result).toBe("No plan is bound to this session. Call hf_plan_start to bind one.");
    });

    test("returns a summary string containing the resolved path when a plan is bound", async () => {
      const tmpDir = await createTmpDir();
      const planPath = await writePlanDoc(tmpDir, MINIMAL_PLAN);

      const manager = makeManager({
        getRuntime: async () => makeMockRuntime(),
      });
      manager.planBindings.set("sess-2", planPath);

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_status"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-2", tmpDir));

      expect(result).toEqual(expect.any(String));
      expect(result).toContain(planPath);
    });
  });

  // -------------------------------------------------------------------------
  // hf_plan_list
  // -------------------------------------------------------------------------
  describe("hf_plan_list", () => {
    test("returns 'no active plan bindings' when planBindings is empty", async () => {
      const manager = makeManager();
      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_list"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-list-0"));
      expect(result).toBe("No active plan bindings in this process.");
    });

    test("output includes session ID and plan path when one binding exists", async () => {
      const manager = makeManager();
      manager.planBindings.set("sess-list-1", "/some/plans/my-feature-plan.md");

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_list"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-list-1"));

      expect(result).toContain("sess-list-1");
      expect(result).toContain("my-feature-plan.md");
    });

    test("output includes both sessions when two bindings exist", async () => {
      const manager = makeManager();
      manager.planBindings.set("sess-list-a", "/some/plans/plan-a-plan.md");
      manager.planBindings.set("sess-list-b", "/some/plans/plan-b-plan.md");

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_list"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-list-a"));

      expect(result).toContain("sess-list-a");
      expect(result).toContain("plan-a-plan.md");
      expect(result).toContain("sess-list-b");
      expect(result).toContain("plan-b-plan.md");
    });
  });

  // -------------------------------------------------------------------------
  // hf_plan_unbind
  // -------------------------------------------------------------------------
  describe("hf_plan_unbind", () => {
    test("returns 'nothing to unbind' when planBindings is empty for the session", async () => {
      const manager = makeManager();
      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_unbind"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-unbind-0"));
      expect(result).toBe("No plan is bound to this session — nothing to unbind.");
    });

    test("removes the binding and returns the confirmation message when a plan is bound", async () => {
      const manager = makeManager();
      manager.planBindings.set("sess-unbind-1", "/some/plans/my-plan.md");

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_unbind"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-unbind-1"));

      expect(result).toContain("/some/plans/my-plan.md");
      expect(result).toContain("planless");
      expect(manager.planBindings.has("sess-unbind-1")).toBe(false);
    });

    test("hf_plan_status returns 'no plan bound' after unbind in the same session", async () => {
      const manager = makeManager();
      manager.planBindings.set("sess-unbind-2", "/some/plans/my-plan.md");

      const tools = createPluginTools({}, manager);
      const unbindTool = tools["hf_plan_unbind"] as { execute: Function };
      const statusTool = tools["hf_plan_status"] as { execute: Function };

      await unbindTool.execute({}, makeToolContext("sess-unbind-2"));
      const statusResult = await statusTool.execute({}, makeToolContext("sess-unbind-2"));

      expect(statusResult).toBe("No plan is bound to this session. Call hf_plan_start to bind one.");
    });
  });

  // -------------------------------------------------------------------------
  // hf_runtime_status
  // -------------------------------------------------------------------------
  describe("hf_runtime_status", () => {
    test("returns 'no plan bound' when planBindings is empty for the session", async () => {
      const manager = makeManager();
      const tools = createPluginTools({}, manager);
      const tool = tools["hf_runtime_status"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-rt-0"));
      expect(result).toBe("No plan is bound to this session. Call hf_plan_start to bind one before checking runtime status.");
    });

    test("returns 'runtime not yet initialized' when getRuntime resolves to null", async () => {
      const manager = makeManager({ getRuntime: async () => null });
      manager.planBindings.set("sess-rt-1", "/some/plans/my-plan.md");

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_runtime_status"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-rt-1"));

      expect(result).toBe("Runtime not yet initialized for this session.");
    });

    test("output contains loopState, totalAttempts, and recommendedNextAction from mock runtime", async () => {
      const mockRuntime = makeMockRuntime({
        loopState: "running",
        recommendedNextAction: "continue with M1",
      });
      const manager = makeManager({ getRuntime: async () => mockRuntime });
      manager.planBindings.set("sess-rt-2", "/some/plans/test-plan.md");

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_runtime_status"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-rt-2"));

      expect(result).toContain("running");
      // totalAttempts from makeMockStatus default
      expect(result).toContain("3");
      expect(result).toContain("continue with M1");
    });
  });

  // -------------------------------------------------------------------------
  // hf_vault_write
  // -------------------------------------------------------------------------
  describe("hf_vault_write", () => {
    test("returns invalid-path error when path does not start with 'vault/'", async () => {
      const manager = makeManager();
      const tools = createPluginTools({}, manager);
      const tool = tools["hf_vault_write"] as { execute: Function };
      const result = await tool.execute({ path: "notes/file.md", content: "hello" }, makeToolContext("sess-vw-0"));
      expect(result).toContain("Invalid path");
      expect(result).toContain("notes/file.md");
    });

    test("creates a new file with a dated section header when the target does not exist", async () => {
      const tmpDir = await createTmpDir();
      const vaultDir = path.join(tmpDir, "vault", "plans", "my-plan");
      await mkdir(vaultDir, { recursive: true });

      const savedCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const manager = makeManager();
        const tools = createPluginTools({}, manager);
        const tool = tools["hf_vault_write"] as { execute: Function };
        const result = await tool.execute(
          { path: "vault/plans/my-plan/context.md", content: "First entry." },
          makeToolContext("sess-vw-1", tmpDir)
        );

        expect(result).toContain("Written to vault/plans/my-plan/context.md");

        const written = await readFile(path.join(tmpDir, "vault/plans/my-plan/context.md"), "utf-8");
        expect(written).toContain("_Dated:");
        expect(written).toContain("First entry.");
      } finally {
        process.chdir(savedCwd);
      }
    });

    test("appends a second dated block without removing the first when called twice", async () => {
      const tmpDir = await createTmpDir();
      const vaultDir = path.join(tmpDir, "vault", "shared");
      await mkdir(vaultDir, { recursive: true });

      const savedCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const manager = makeManager();
        const tools = createPluginTools({}, manager);
        const tool = tools["hf_vault_write"] as { execute: Function };

        await tool.execute(
          { path: "vault/shared/notes.md", content: "Entry one." },
          makeToolContext("sess-vw-2", tmpDir)
        );
        await tool.execute(
          { path: "vault/shared/notes.md", content: "Entry two." },
          makeToolContext("sess-vw-2", tmpDir)
        );

        const written = await readFile(path.join(tmpDir, "vault/shared/notes.md"), "utf-8");
        expect(written).toContain("Entry one.");
        expect(written).toContain("Entry two.");
        // Both dated headers must be present
        const dateHeaderCount = (written.match(/_Dated:/g) ?? []).length;
        expect(dateHeaderCount).toBe(2);
      } finally {
        process.chdir(savedCwd);
      }
    });
  });

  // -------------------------------------------------------------------------
  // hf_plan_approve
  // -------------------------------------------------------------------------
  describe("hf_plan_approve", () => {
    test("returns 'no plan bound' when planBindings is empty for the session", async () => {
      const manager = makeManager();
      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_approve"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-pa-0"));
      expect(result).toBe("No plan is bound to this session. Call hf_plan_start to bind one before approving.");
    });

    test("returns malformed-plan error when the plan file does not contain '## Milestones'", async () => {
      const tmpDir = await createTmpDir();
      const planPath = await writePlanDoc(tmpDir, MALFORMED_PLAN);

      const manager = makeManager();
      manager.planBindings.set("sess-pa-1", planPath);

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_approve"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-pa-1", tmpDir));

      expect(result).toContain("missing a ## Milestones section");
    });

    test("returns 'already approved' message when the plan already has status: in-progress", async () => {
      const tmpDir = await createTmpDir();
      const planPath = await writePlanDoc(tmpDir, MINIMAL_PLAN);
      // MINIMAL_PLAN has status: in-progress

      const manager = makeManager();
      manager.planBindings.set("sess-pa-2", planPath);

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_approve"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-pa-2", tmpDir));

      expect(result).toContain("in-progress");
      expect(result).toContain("nothing to approve");
    });

    test("updates status: planning to status: in-progress and returns the confirmation message", async () => {
      const tmpDir = await createTmpDir();
      const planPath = await writePlanDoc(tmpDir, PLANNING_PLAN);

      const manager = makeManager();
      manager.planBindings.set("sess-pa-3", planPath);

      const tools = createPluginTools({}, manager);
      const tool = tools["hf_plan_approve"] as { execute: Function };
      const result = await tool.execute({}, makeToolContext("sess-pa-3", tmpDir));

      expect(result).toContain("Plan approved:");
      expect(result).toContain("planning → in-progress");

      const updated = await readFile(planPath, "utf-8");
      expect(updated).toContain("status: in-progress");
      expect(updated).not.toMatch(/^status: planning\s*$/m);
    });
  });
});

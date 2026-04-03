import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  readStatus,
  writeStatus,
  appendEvent,
  readEventLines,
  readVaultContext,
  getVaultPaths,
  getRuntimePaths,
  ensureRuntimeDir,
  resolveLastActivePlanPath
} from "../src/runtime/persistence.js";
import { parsePlan } from "../src/runtime/plan-doc.js";
import type { RuntimeStatus, RuntimeEvent, ParsedPlan } from "../src/runtime/types.js";

let tmpDir: string;
let plan: ParsedPlan;
let runtimePaths: ReturnType<typeof getRuntimePaths>;

const MINIMAL_PLAN = [
  "# Test Plan",
  "",
  "## Milestones",
  "",
  "- [ ] 1. First milestone",
  "- [ ] 2. Second milestone"
].join("\n");

async function setupFixture(): Promise<void> {
  const plansDir = path.join(tmpDir, "plans");
  await fs.mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, "2026-03-07-test-plan.md");
  await fs.writeFile(planPath, MINIMAL_PLAN, "utf8");
  plan = await parsePlan(planPath);
  runtimePaths = getRuntimePaths(plan);
  await ensureRuntimeDir(plan);
}

function makeMinimalStatus(): RuntimeStatus {
  return {
    version: 1,
    planPath: plan.path,
    planSlug: plan.slug,
    planMtimeMs: plan.mtimeMs,
    loopState: "idle",
    phase: "execution",
    currentMilestone: plan.currentMilestone,
    counters: {
      totalAttempts: 0,
      totalTurns: 0,
      maxTotalTurns: 50,
      noProgress: 0,
      repeatedBlocker: 0,
      verificationFailures: 0,
      turnsSinceLastOutcome: 0
    },
    sessions: {},
    subagents: [],
    autoContinue: true,
    updatedAt: new Date().toISOString()
  };
}

function makeEvent(type: string): RuntimeEvent {
  return {
    vendor: "runtime",
    type,
    timestamp: new Date().toISOString(),
    payload: { detail: "test" }
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-persistence-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readStatus
// ---------------------------------------------------------------------------

describe("readStatus", () => {
  test("returns null when status.json does not exist", async () => {
    await setupFixture();
    const status = await readStatus(runtimePaths);
    expect(status).toBeNull();
  });

  test("throws on corrupted JSON", async () => {
    await setupFixture();
    await fs.writeFile(runtimePaths.statusPath, "{{{bad json", "utf8");
    await expect(readStatus(runtimePaths)).rejects.toThrow("Invalid runtime status JSON");
  });

  test("throws on valid JSON with invalid schema", async () => {
    await setupFixture();
    await fs.writeFile(runtimePaths.statusPath, JSON.stringify({ version: 1, planPath: 123 }), "utf8");
    await expect(readStatus(runtimePaths)).rejects.toThrow("must be a string");
  });

  test("reads back a previously written status", async () => {
    await setupFixture();
    const status = makeMinimalStatus();
    await writeStatus(runtimePaths, status);
    const result = await readStatus(runtimePaths);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.planSlug).toBe(plan.slug);
    expect(result!.loopState).toBe("idle");
    expect(result!.counters.totalAttempts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readEventLines / appendEvent
// ---------------------------------------------------------------------------

describe("readEventLines / appendEvent", () => {
  test("returns empty array when events.jsonl does not exist", async () => {
    await setupFixture();
    const lines = await readEventLines(runtimePaths);
    expect(lines).toEqual([]);
  });

  test("appendEvent creates file and writes one line", async () => {
    await setupFixture();
    await appendEvent(runtimePaths, makeEvent("test.created"));
    const lines = await readEventLines(runtimePaths);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as RuntimeEvent;
    expect(parsed.type).toBe("test.created");
  });

  test("multiple appendEvent calls accumulate lines", async () => {
    await setupFixture();
    await appendEvent(runtimePaths, makeEvent("event.one"));
    await appendEvent(runtimePaths, makeEvent("event.two"));
    await appendEvent(runtimePaths, makeEvent("event.three"));
    const lines = await readEventLines(runtimePaths);

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).type).toBe("event.one");
    expect(JSON.parse(lines[2]!).type).toBe("event.three");
  });

  test("concurrent appendEvent calls produce valid JSONL without interleaving", async () => {
    await setupFixture();
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(`concurrent.${i}`));
    await Promise.all(events.map((event) => appendEvent(runtimePaths, event)));
    const lines = await readEventLines(runtimePaths);

    expect(lines).toHaveLength(10);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const types = lines.map((line) => (JSON.parse(line) as RuntimeEvent).type).sort();
    expect(types).toEqual(events.map((e) => e.type).sort());
  });

  test("stress: 100 concurrent writers produce 100 valid lines", async () => {
    await setupFixture();
    const count = 100;
    const events = Array.from({ length: count }, (_, i) => makeEvent(`stress.${i}`));
    await Promise.all(events.map((event) => appendEvent(runtimePaths, event)));
    const lines = await readEventLines(runtimePaths);

    expect(lines).toHaveLength(count);
    for (const line of lines) {
      const parsed = JSON.parse(line) as RuntimeEvent;
      expect(parsed.vendor).toBe("runtime");
    }
    const types = new Set(lines.map((line) => (JSON.parse(line) as RuntimeEvent).type));
    expect(types.size).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// readVaultContext
// ---------------------------------------------------------------------------

describe("readVaultContext", () => {
  test("returns empty arrays when vault directories do not exist", async () => {
    await setupFixture();
    const vaultPaths = getVaultPaths(plan);
    const context = await readVaultContext(vaultPaths);

    expect(context.plan).toEqual([]);
    expect(context.shared).toEqual([]);
  });

  test("skips empty vault files", async () => {
    await setupFixture();
    const vaultPaths = getVaultPaths(plan);

    await fs.mkdir(vaultPaths.planDir, { recursive: true });
    await fs.writeFile(path.join(vaultPaths.planDir, "context.md"), "", "utf8");
    await fs.writeFile(path.join(vaultPaths.planDir, "discoveries.md"), "\n", "utf8");

    const context = await readVaultContext(vaultPaths);
    expect(context.plan).toEqual([]);
  });

  test("reads non-empty vault files with correct titles", async () => {
    await setupFixture();
    const vaultPaths = getVaultPaths(plan);

    await fs.mkdir(vaultPaths.planDir, { recursive: true });
    await fs.writeFile(path.join(vaultPaths.planDir, "context.md"), "# Plan context\n\nSome content.", "utf8");

    await fs.mkdir(vaultPaths.sharedDir, { recursive: true });
    await fs.writeFile(path.join(vaultPaths.sharedDir, "architecture.md"), "# Architecture\n\nShared notes.", "utf8");

    const context = await readVaultContext(vaultPaths);

    expect(context.plan).toHaveLength(1);
    expect(context.plan[0]!.title).toBe("Plan context");
    expect(context.plan[0]!.content).toContain("Some content.");

    expect(context.shared).toHaveLength(1);
    expect(context.shared[0]!.title).toBe("Shared architecture");
    expect(context.shared[0]!.content).toContain("Shared notes.");
  });

  test("reads multiple vault files in order", async () => {
    await setupFixture();
    const vaultPaths = getVaultPaths(plan);

    await fs.mkdir(vaultPaths.planDir, { recursive: true });
    await fs.writeFile(path.join(vaultPaths.planDir, "context.md"), "Plan context content.", "utf8");
    await fs.writeFile(path.join(vaultPaths.planDir, "discoveries.md"), "Discovery content.", "utf8");
    await fs.writeFile(path.join(vaultPaths.planDir, "decisions.md"), "Decision content.", "utf8");

    const context = await readVaultContext(vaultPaths);

    expect(context.plan).toHaveLength(3);
    expect(context.plan.map((d) => d.title)).toEqual([
      "Plan context",
      "Plan discoveries",
      "Plan decisions"
    ]);
  });
});

describe("resolveLastActivePlanPath", () => {
  test("returns the plan path of the most recently updated active plan", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-resolve-plan-"));
    const runtimeDir = path.join(root, "plans", "runtime", "my-feature");
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, "status.json"),
      JSON.stringify({
        version: 1,
        planPath: path.join(root, "plans", "2026-03-28-my-feature-plan.md"),
        planSlug: "my-feature",
        loopState: "running",
        updatedAt: "2026-03-28T10:00:00.000Z"
      }),
      "utf8"
    );

    const result = await resolveLastActivePlanPath(root);
    expect(result).toBe(path.join(root, "plans", "2026-03-28-my-feature-plan.md"));
  });

  test("skips completed plans", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-resolve-complete-"));
    const runtimeDir = path.join(root, "plans", "runtime", "done-feature");
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, "status.json"),
      JSON.stringify({
        version: 1,
        planPath: path.join(root, "plans", "done-plan.md"),
        planSlug: "done-feature",
        loopState: "complete",
        updatedAt: "2026-03-28T10:00:00.000Z"
      }),
      "utf8"
    );

    const result = await resolveLastActivePlanPath(root);
    expect(result).toBeNull();
  });

  test("returns null when no runtime directories exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-resolve-empty-"));
    const result = await resolveLastActivePlanPath(root);
    expect(result).toBeNull();
  });

  test("picks the most recently updated plan among multiple", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-resolve-multi-"));
    const olderDir = path.join(root, "plans", "runtime", "older-plan");
    const newerDir = path.join(root, "plans", "runtime", "newer-plan");
    await fs.mkdir(olderDir, { recursive: true });
    await fs.mkdir(newerDir, { recursive: true });

    await fs.writeFile(
      path.join(olderDir, "status.json"),
      JSON.stringify({
        version: 1,
        planPath: "/plans/older-plan.md",
        planSlug: "older-plan",
        loopState: "running",
        updatedAt: "2026-03-27T10:00:00.000Z"
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(newerDir, "status.json"),
      JSON.stringify({
        version: 1,
        planPath: "/plans/newer-plan.md",
        planSlug: "newer-plan",
        loopState: "paused",
        updatedAt: "2026-03-28T10:00:00.000Z"
      }),
      "utf8"
    );

    const result = await resolveLastActivePlanPath(root);
    expect(result).toBe("/plans/newer-plan.md");
  });

  test("skips _planless directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-resolve-planless-"));
    const planlessDir = path.join(root, "plans", "runtime", "_planless");
    await fs.mkdir(planlessDir, { recursive: true });
    await fs.writeFile(
      path.join(planlessDir, "status.json"),
      JSON.stringify({
        version: 1,
        planPath: "",
        planSlug: "_planless",
        loopState: "idle",
        updatedAt: "2026-03-28T10:00:00.000Z"
      }),
      "utf8"
    );

    const result = await resolveLastActivePlanPath(root);
    expect(result).toBeNull();
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const cliPath = path.join(repoRoot, "dist", "cli", "index.js");

function runCli(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function createLifecycleFixture() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "framework-cli-"));
  const lifecycleDir = path.join(fixtureRoot, ".tmp");
  mkdirSync(lifecycleDir, { recursive: true });

  const lifecycle = {
    version: 1,
    tasks: [
      {
        featureId: "feature-alpha",
        name: "Feature Alpha",
        objective: "Deliver feature alpha",
        status: "active",
        contextFiles: [],
        referenceFiles: [],
        exitCriteria: ["All subtasks completed"],
        subtasks: [
          {
            id: "feature-alpha-01",
            seq: "01",
            title: "Prepare implementation",
            status: "completed",
            dependsOn: [],
            parallel: false,
            suggestedAgent: "TaskPlanner",
            updatedAt: "2026-02-19T00:00:00.000Z"
          },
          {
            id: "feature-alpha-02",
            seq: "02",
            title: "Implement feature",
            status: "pending",
            dependsOn: ["01"],
            parallel: false,
            suggestedAgent: "Coder",
            updatedAt: "2026-02-19T00:00:00.000Z"
          },
          {
            id: "feature-alpha-03",
            seq: "03",
            title: "Run final review",
            status: "blocked",
            blockedReason: "Waiting for implementation completion",
            dependsOn: ["02"],
            parallel: false,
            suggestedAgent: "Reviewer",
            updatedAt: "2026-02-19T00:00:00.000Z"
          }
        ],
        researchLog: [],
        createdAt: "2026-02-19T00:00:00.000Z",
        updatedAt: "2026-02-19T00:00:00.000Z"
      }
    ]
  };

  writeFileSync(path.join(lifecycleDir, "task-lifecycle.json"), `${JSON.stringify(lifecycle, null, 2)}\n`, "utf8");
  return fixtureRoot;
}

test("doctor command supports json and text output", () => {
  const jsonResult = runCli(["doctor", "--json"]);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.jsonVersion, 1);
  assert.ok(Array.isArray(report.items));
  assert.ok(report.items.some((item) => item.id === "command-contracts"));

  const textResult = runCli(["doctor"]);
  assert.equal(textResult.status, 0, textResult.stderr);
  assert.match(textResult.stdout, /Diagnostics: /);
  assert.match(textResult.stdout, /Using markdown-first context and contracts\./);
});

test("task-status and task-resume return expected lifecycle views", () => {
  const fixtureRoot = createLifecycleFixture();

  const statusJson = runCli(["task-status", "--json"], fixtureRoot);
  assert.equal(statusJson.status, 0, statusJson.stderr);
  const statusList = JSON.parse(statusJson.stdout);
  assert.equal(statusList.length, 1);
  assert.equal(statusList[0].featureId, "feature-alpha");
  assert.equal(statusList[0].completed, 1);

  const statusText = runCli(["task-status", "--feature", "feature-alpha"], fixtureRoot);
  assert.equal(statusText.status, 0, statusText.stderr);
  assert.match(statusText.stdout, /feature-alpha \[active\]/);
  assert.match(statusText.stdout, /02 Implement feature \(pending\)/);

  const resumeJson = runCli(["task-resume", "--feature", "feature-alpha", "--json"], fixtureRoot);
  assert.equal(resumeJson.status, 0, resumeJson.stderr);
  const resume = JSON.parse(resumeJson.stdout);
  assert.equal(resume.nextSubtask.seq, "02");
  assert.ok(resume.hookNotes.includes("Using markdown-first context and contracts."));
  assert.ok(
    resume.hookNotes.includes("Continue from the next ready subtask and preserve dependency order.")
  );
});

test("task-resume --mark-in-progress updates next subtask status", () => {
  const fixtureRoot = createLifecycleFixture();

  const resume = runCli(["task-resume", "--feature", "feature-alpha", "--mark-in-progress", "--json"], fixtureRoot);
  assert.equal(resume.status, 0, resume.stderr);
  const resumePayload = JSON.parse(resume.stdout);
  assert.equal(resumePayload.nextSubtask.seq, "02");
  assert.equal(resumePayload.nextSubtask.status, "in_progress");

  const storePath = path.join(fixtureRoot, ".tmp", "task-lifecycle.json");
  const lifecycleStore = JSON.parse(readFileSync(storePath, "utf8"));
  const currentTask = lifecycleStore.tasks.find((task) => task.featureId === "feature-alpha");
  const updatedSubtask = currentTask.subtasks.find((subtask) => subtask.seq === "02");
  assert.equal(updatedSubtask.status, "in_progress");
});

test("task-next and task-blocked provide lifecycle helpers", () => {
  const fixtureRoot = createLifecycleFixture();

  const next = runCli(["task-next", "--feature", "feature-alpha"], fixtureRoot);
  assert.equal(next.status, 0, next.stderr);
  assert.match(next.stdout, /02 Implement feature \(Coder\)/);

  const blocked = runCli(["task-blocked", "--feature", "feature-alpha", "--json"], fixtureRoot);
  assert.equal(blocked.status, 0, blocked.stderr);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].reason, "Waiting for implementation completion");
});

test("task-complete enforces dependency checks", () => {
  const fixtureRoot = createLifecycleFixture();
  const failComplete = runCli(["task-complete", "--feature", "feature-alpha", "--seq", "03"], fixtureRoot);
  assert.equal(failComplete.status, 1);
  assert.match(failComplete.stderr, /Dependencies are not resolved/);

  const passComplete = runCli(["task-complete", "--feature", "feature-alpha", "--seq", "02"], fixtureRoot);
  assert.equal(passComplete.status, 0, passComplete.stderr);
  assert.match(passComplete.stdout, /Updated subtask 02 to completed/);
});

test("mcp-search can attach research to lifecycle", () => {
  const fixtureRoot = createLifecycleFixture();
  const result = runCli(
    ["mcp-search", "--provider", "tavily", "--query", "react suspense patterns", "--feature", "feature-alpha", "--json"],
    fixtureRoot
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.provider, "tavily");
  assert.ok(Array.isArray(payload.items));

  const storePath = path.join(fixtureRoot, ".tmp", "task-lifecycle.json");
  const lifecycleStore = JSON.parse(readFileSync(storePath, "utf8"));
  const currentTask = lifecycleStore.tasks.find((task) => task.featureId === "feature-alpha");
  assert.equal(currentTask.researchLog.length, 1);
  assert.equal(currentTask.researchLog[0].provider, "tavily");
});

test("background queue supports enqueue dispatch and status", () => {
  const fixtureRoot = createLifecycleFixture();
  const enqueue = runCli(
    ["background-enqueue", "--kind", "mcp-search", "--provider", "gh-grep", "--query", "useState(", "--feature", "feature-alpha"],
    fixtureRoot
  );
  assert.equal(enqueue.status, 0, enqueue.stderr);
  const queuedJob = JSON.parse(enqueue.stdout);
  assert.equal(queuedJob.status, "queued");

  const dispatch = runCli(["background-dispatch", "--mode", "fast"], fixtureRoot);
  assert.equal(dispatch.status, 0, dispatch.stderr);
  const dispatchPayload = JSON.parse(dispatch.stdout);
  assert.equal(dispatchPayload.dispatched, 1);

  const status = runCli(["background-status", "--job", queuedJob.id], fixtureRoot);
  assert.equal(status.status, 0, status.stderr);
  const completedJob = JSON.parse(status.stdout);
  assert.equal(completedJob.status, "completed");
});

test("background-enqueue rejects invalid kinds", () => {
  const fixtureRoot = createLifecycleFixture();
  const invalid = runCli(["background-enqueue", "--kind", "invalid-kind"], fixtureRoot);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid --kind/);
});

test("background mcp job fails when lifecycle feature is missing", () => {
  const fixtureRoot = createLifecycleFixture();
  const enqueue = runCli(
    ["background-enqueue", "--kind", "mcp-search", "--provider", "tavily", "--query", "routing", "--feature", "missing-feature"],
    fixtureRoot
  );
  assert.equal(enqueue.status, 0, enqueue.stderr);
  const queuedJob = JSON.parse(enqueue.stdout);

  const dispatch = runCli(["background-dispatch"], fixtureRoot);
  assert.equal(dispatch.status, 0, dispatch.stderr);

  const status = runCli(["background-status", "--job", queuedJob.id], fixtureRoot);
  assert.equal(status.status, 0, status.stderr);
  const failedJob = JSON.parse(status.stdout);
  assert.equal(failedJob.status, "failed");
  assert.match(failedJob.error, /Task not found/);
});

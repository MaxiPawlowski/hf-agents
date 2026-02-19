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

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

import {
  buildTaskResume,
  setTaskSubtaskStatusValidated,
  upsertTaskLifecycle
} from "../dist/src/tasks/task-lifecycle.js";

function createBundle() {
  return {
    featureId: "feature-lifecycle",
    name: "Feature Lifecycle",
    objective: "Validate task lifecycle mutations",
    status: "active",
    contextFiles: [],
    referenceFiles: [],
    exitCriteria: ["done"],
    subtasks: [
      {
        id: "feature-lifecycle-01",
        seq: "01",
        title: "Plan",
        status: "completed",
        dependsOn: [],
        parallel: false,
        suggestedAgent: "TaskPlanner",
        contextFiles: [],
        referenceFiles: [],
        acceptanceCriteria: [],
        deliverables: []
      },
      {
        id: "feature-lifecycle-02",
        seq: "02",
        title: "Implement",
        status: "pending",
        dependsOn: ["01"],
        parallel: false,
        suggestedAgent: "Coder",
        contextFiles: [],
        referenceFiles: [],
        acceptanceCriteria: [],
        deliverables: []
      },
      {
        id: "feature-lifecycle-03",
        seq: "03",
        title: "Review",
        status: "pending",
        dependsOn: ["02"],
        parallel: false,
        suggestedAgent: "Reviewer",
        contextFiles: [],
        referenceFiles: [],
        acceptanceCriteria: [],
        deliverables: []
      }
    ]
  };
}

test("validated lifecycle status mutation enforces dependencies", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lifecycle-"));
  const storePath = path.join(root, "task-lifecycle.json");
  upsertTaskLifecycle(createBundle(), storePath);

  const badComplete = setTaskSubtaskStatusValidated("feature-lifecycle", "03", "completed", storePath);
  assert.equal(badComplete.ok, false);
  if (!badComplete.ok) {
    assert.match(badComplete.message, /Dependencies are not resolved/);
  }

  const goodComplete = setTaskSubtaskStatusValidated("feature-lifecycle", "02", "completed", storePath);
  assert.equal(goodComplete.ok, true);
});

test("task resume returns next dependency-ready subtask", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lifecycle-research-"));
  const storePath = path.join(root, "task-lifecycle.json");
  upsertTaskLifecycle(createBundle(), storePath);

  const resume = buildTaskResume("feature-lifecycle", storePath);
  assert.ok(resume);
  assert.equal(resume?.nextSubtask?.seq, "02");
});

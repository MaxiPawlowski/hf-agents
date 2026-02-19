import test from "node:test";
import assert from "node:assert/strict";

import { createTaskBundle } from "../dist/src/tasks/task-bundle.js";

test("createTaskBundle generates fallback 3-step bundle when no plan provided", () => {
  const bundle = createTaskBundle({
    id: "task-1",
    intent: "Implement feature flags",
    constraints: [],
    successCriteria: []
  });

  assert.equal(bundle.featureId, "implement-feature-flags");
  assert.equal(bundle.subtasks.length, 3);
  assert.equal(bundle.subtasks[0].seq, "01");
  assert.deepEqual(bundle.subtasks[1].dependsOn, ["01"]);
  assert.equal(bundle.subtasks[2].suggestedAgent, "Reviewer");
});

test("createTaskBundle maps plan steps to ordered subtasks", () => {
  const bundle = createTaskBundle(
    {
      id: "task-2",
      intent: "Refactor routing",
      constraints: [],
      successCriteria: ["Routing behavior preserved"]
    },
    {
      taskId: "task-2",
      objective: "Refactor routing",
      steps: [
        { id: "s1", description: "Analyze current router" },
        { id: "s2", description: "Implement route changes" },
        { id: "s3", description: "Review output" }
      ]
    }
  );

  assert.equal(bundle.subtasks.length, 3);
  assert.equal(bundle.subtasks[1].title, "Implement route changes");
  assert.deepEqual(bundle.subtasks[2].dependsOn, ["02"]);
  assert.equal(bundle.exitCriteria[0], "Routing behavior preserved");
});

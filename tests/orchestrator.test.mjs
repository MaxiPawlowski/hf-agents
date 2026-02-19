import test from "node:test";
import assert from "node:assert/strict";

import { runTask } from "../dist/src/orchestrator/core-agent.js";

test("runTask routes complex feature intents to TaskManager with task artifacts", async () => {
  const result = await runTask(
    {
      id: "task-100",
      intent: "Implement complex multi-file feature rollout",
      constraints: [],
      successCriteria: []
    },
    {
      profile: "balanced",
      contextStrategy: "standard",
      useWorktreesByDefault: false,
      manageGitByDefault: false,
      requireTests: false,
      requireApprovalGates: false,
      requireVerification: true,
      requireCodeReview: true,
      enableTaskArtifacts: true
    }
  );

  assert.equal(result.assignedSubagent, "TaskManager");
  assert.equal(result.routingSource, "heuristic");
  assert.equal(result.matchedCategory, "feature");
  assert.ok(result.taskBundle);
  assert.deepEqual(result.executionPath?.stages, ["ContextScout", "TaskPlanner", "TaskManager", "Coder", "Reviewer"]);
  assert.ok(result.notes.some((note) => note.includes("hf-verification-before-completion")));
});

test("runTask includes enforced skills under strict settings profile", async () => {
  const result = await runTask(
    {
      id: "task-200",
      intent: "Fix bug and complete implementation",
      constraints: [],
      successCriteria: []
    },
    {
      profile: "strict",
      contextStrategy: "standard",
      useWorktreesByDefault: false,
      manageGitByDefault: false,
      requireTests: true,
      requireApprovalGates: true,
      requireVerification: true,
      requireCodeReview: true,
      enableTaskArtifacts: true
    }
  );

  assert.ok(result.enforcedSkills.includes("hf-test-driven-development"));
  assert.ok(result.enforcedSkills.includes("hf-verification-before-completion"));
  assert.equal(result.routingSource, "heuristic");
  assert.equal(result.matchedCategory, "implementation");
  assert.equal(result.requiresApproval, true);
});

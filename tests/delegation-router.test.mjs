import test from "node:test";
import assert from "node:assert/strict";

import { inferDelegationCategory, routeTaskDetailed } from "../dist/src/router/delegation-router.js";

test("routeTaskDetailed uses delegation profile when category has valid preferred subagent", () => {
  const result = routeTaskDetailed({
    intent: "Handle docs cleanup",
    category: "docs",
    profiles: {
      docs: {
        preferredSubagent: "ExternalDocsScout",
        requiredSkills: ["hf-brainstorming"],
        notes: []
      }
    }
  });

  assert.equal(result.assignedSubagent, "ExternalDocsScout");
  assert.equal(result.source, "profile");
  assert.equal(result.matchedCategory, "docs");
});

test("routeTaskDetailed falls back to heuristic when preferred subagent is unavailable", () => {
  const result = routeTaskDetailed({
    intent: "Plan implementation details",
    category: "planning",
    profiles: {
      planning: {
        preferredSubagent: "NonExistentAgent",
        requiredSkills: [],
        notes: []
      }
    }
  });

  assert.equal(result.assignedSubagent, "TaskPlanner");
  assert.equal(result.source, "heuristic");
  assert.equal(result.matchedCategory, "planning");
});

test("routeTaskDetailed infers category and routes via profile", () => {
  const result = routeTaskDetailed({
    intent: "Please review quality before shipping",
    profiles: {
      review: {
        preferredSubagent: "Reviewer",
        requiredSkills: ["hf-verification-before-completion"],
        notes: []
      }
    }
  });

  assert.equal(inferDelegationCategory("Please review quality before shipping"), "review");
  assert.equal(result.assignedSubagent, "Reviewer");
  assert.equal(result.source, "profile");
  assert.equal(result.matchedCategory, "review");
});

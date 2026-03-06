import test from "node:test";
import assert from "node:assert/strict";

import { inferDelegationCategory, routeTaskDetailed } from "../dist/src/router/delegation-router.js";

test("routeTaskDetailed uses configured rule when category has valid preferred subagent", () => {
  const result = routeTaskDetailed({
    intent: "Handle docs cleanup",
    category: "docs",
    rules: {
      docs: {
        preferredSubagent: "ExternalDocsScout",
        requiredSkills: ["hf-brainstorming"],
        notes: []
      }
    }
  });

  assert.equal(result.assignedSubagent, "ExternalDocsScout");
  assert.equal(result.source, "configured");
  assert.equal(result.matchedCategory, "docs");
});

test("routeTaskDetailed falls back to heuristic when preferred subagent is unavailable", () => {
  const result = routeTaskDetailed({
    intent: "Plan implementation details",
    category: "planning",
    rules: {
      planning: {
        preferredSubagent: "NonExistentAgent",
        requiredSkills: [],
        notes: []
      }
    }
  });

  assert.equal(result.assignedSubagent, "PlanOrchestrator");
  assert.equal(result.source, "heuristic");
  assert.equal(result.matchedCategory, "planning");
});

test("routeTaskDetailed infers category and routes via configured rule", () => {
  const result = routeTaskDetailed({
    intent: "Please review quality before shipping",
    rules: {
      review: {
        preferredSubagent: "Reviewer",
        requiredSkills: ["hf-verification-before-completion"],
        notes: []
      }
    }
  });

  assert.equal(inferDelegationCategory("Please review quality before shipping"), "review");
  assert.equal(result.assignedSubagent, "Reviewer");
  assert.equal(result.source, "configured");
  assert.equal(result.matchedCategory, "review");
});

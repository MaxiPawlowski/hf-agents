import test from "node:test";
import assert from "node:assert/strict";

import { requiredSkillsForMode, shouldEnforceSkill, suggestSkills } from "../dist/src/skills/skill-engine.js";

test("suggestSkills returns stable deduplicated matches", () => {
  const result = suggestSkills("Review quality and complete the task review");

  assert.ok(result.includes("hf-requesting-code-review"));
  assert.ok(result.includes("hf-verification-before-completion"));
  assert.equal(new Set(result).size, result.length);
});

test("shouldEnforceSkill respects mode gating", () => {
  assert.equal(shouldEnforceSkill("hf-test-driven-development", "strict"), true);
  assert.equal(shouldEnforceSkill("hf-test-driven-development", "balanced"), false);
  assert.equal(shouldEnforceSkill("hf-dispatching-parallel-agents", "fast"), true);
});

test("requiredSkillsForMode includes strict-only skills only in strict mode", () => {
  const strictSkills = requiredSkillsForMode("strict");
  const fastSkills = requiredSkillsForMode("fast");

  assert.ok(strictSkills.includes("hf-finishing-a-development-branch"));
  assert.equal(fastSkills.includes("hf-finishing-a-development-branch"), false);
});

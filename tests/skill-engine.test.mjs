import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";

import { listSkills, suggestSkills } from "../dist/src/skills/skill-engine.js";

test("suggestSkills returns stable deduplicated matches", () => {
  const result = suggestSkills("Review quality and complete the task review");

  assert.ok(result.includes("hf-verification-before-completion"));
  assert.ok(result.length >= 1);
  assert.equal(new Set(result).size, result.length);
});

test("runtime skill registry matches .opencode registry skill assets", () => {
  const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
  const registryPath = path.join(repoRoot, ".opencode", "registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));

  const registrySkillIds = registry.assets
    .filter((asset) => asset.type === "skill")
    .map((asset) => asset.id.replace(/^skill-/, "hf-"))
    .sort();

  const runtimeSkillIds = listSkills()
    .map((skill) => skill.id)
    .sort();

  assert.deepEqual(runtimeSkillIds, registrySkillIds);
});

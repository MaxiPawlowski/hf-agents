import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";

import {
  loadDelegationProfiles,
  loadHookRuntimeConfig,
  loadPolicy,
  policyFileForMode
} from "../dist/src/policies/policy-loader.js";

test("policy loader parses delegationProfiles and default requiredSkills", () => {
  const policy = loadPolicy(policyFileForMode("fast"));
  const profiles = loadDelegationProfiles(policy);

  assert.equal(profiles.feature.preferredSubagent, "TaskManager");
  assert.deepEqual(profiles.feature.requiredSkills, []);
  assert.equal(profiles.implementation.preferredSubagent, "Coder");

  const hooks = loadHookRuntimeConfig(policy);
  assert.equal(hooks.enabled, true);
  assert.equal(hooks.hooks["output-truncation-guard"].maxOutputChars, 12000);

});

test("policy loader rejects unknown delegation profile categories", () => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "policy-loader-"));
  const tmpPolicyDir = path.join(tmpRoot, "policies");
  mkdirSync(tmpPolicyDir, { recursive: true });
  const badPolicyPath = path.join(tmpPolicyDir, "bad.yaml");

  writeFileSync(
    badPolicyPath,
    [
      "mode: fast",
      "useWorktreesByDefault: false",
      "manageGitByDefault: false",
      "requireTests: false",
      "requireApprovalGates: false",
      "requireVerification: false",
      "requireCodeReview: false",
      "enableTaskArtifacts: true",
      "delegationProfiles:",
      "  unknown:",
      "    preferredSubagent: Coder"
    ].join("\n"),
    "utf8"
  );

  assert.throws(() => loadPolicy(badPolicyPath));
});

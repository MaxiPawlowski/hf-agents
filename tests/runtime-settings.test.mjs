import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";

import {
  loadDelegationProfiles,
  loadHookRuntimeConfig,
  loadRuntimeSettings,
  profilePreset,
  resolveRuntimeSettings
} from "../dist/src/settings/runtime-settings.js";

test("runtime settings presets provide lightweight defaults", () => {
  const light = profilePreset("light");
  assert.equal(light.profile, "light");
  assert.equal(light.contextStrategy, "minimal");
  assert.equal(light.enableTaskArtifacts, false);
  assert.equal(light.requireVerification, false);

  const strict = profilePreset("strict");
  assert.equal(strict.requireTests, true);
  assert.equal(strict.requireApprovalGates, true);
});

test("runtime settings override merges profile and keeps delegation defaults", () => {
  const settings = resolveRuntimeSettings({
    profile: "balanced",
    enableTaskArtifacts: false,
    delegationProfiles: {
      implementation: {
        preferredSubagent: "TaskManager"
      }
    }
  });

  assert.equal(settings.enableTaskArtifacts, false);
  const profiles = loadDelegationProfiles(settings);
  assert.equal(profiles.implementation.preferredSubagent, "TaskManager");
  assert.equal(profiles.feature.preferredSubagent, "TaskManager");

  const hooks = loadHookRuntimeConfig(settings);
  assert.equal(hooks.enabled, true);
});

test("runtime settings load from JSON file", () => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "runtime-settings-"));
  const settingsDir = path.join(tmpRoot, "settings");
  mkdirSync(settingsDir, { recursive: true });
  const settingsPath = path.join(settingsDir, "framework-settings.json");

  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        profile: "light",
        contextStrategy: "minimal",
        requireVerification: true,
        delegationProfiles: {
          docs: {
            preferredSubagent: "ContextScout"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const settings = loadRuntimeSettings(settingsPath);
  assert.equal(settings.requireVerification, true);
  assert.equal(settings.delegationProfiles.docs.preferredSubagent, "ContextScout");
});

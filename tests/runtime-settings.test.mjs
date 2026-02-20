import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";

import {
  loadDelegationRules,
  loadHookRuntimeConfig,
  loadRuntimeSettings,
  resolveRuntimeSettings
} from "../dist/src/settings/runtime-settings.js";

test("runtime settings defaults are toggle-first", () => {
  const settings = resolveRuntimeSettings();
  assert.equal(settings.contextStrategy, "minimal");
  assert.equal(settings.toggles.enableTaskArtifacts, false);
  assert.equal(settings.toggles.requireVerification, false);
});

test("runtime settings only accepts nested toggles", () => {
  const settings = resolveRuntimeSettings({
    toggles: {
      requireVerification: true,
      enableTaskArtifacts: true
    },
    delegationRules: {
      implementation: {
        preferredSubagent: "TaskManager"
      }
    }
  });

  assert.equal(settings.toggles.enableTaskArtifacts, true);
  assert.equal(settings.toggles.requireVerification, true);
  const rules = loadDelegationRules(settings);
  assert.equal(rules.implementation.preferredSubagent, "TaskManager");
  assert.equal(rules.feature.preferredSubagent, "TaskManager");

  const hooks = loadHookRuntimeConfig(settings);
  assert.equal(hooks.enabled, true);
});

test("runtime settings reject legacy top-level toggle keys", () => {
  assert.throws(
    () => resolveRuntimeSettings({ requireVerification: true }),
    /only support nested toggles/i
  );
  assert.throws(
    () => resolveRuntimeSettings({ enableTaskArtifacts: true }),
    /only support nested toggles/i
  );
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
          contextStrategy: "minimal",
          toggles: {
            enableTaskArtifacts: true,
            requireVerification: true
          },
          delegationRules: {
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
  assert.equal(settings.toggles.requireVerification, true);
  assert.equal(settings.toggles.enableTaskArtifacts, true);
  assert.equal(settings.delegationRules.docs.preferredSubagent, "ContextScout");
});

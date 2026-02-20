import { existsSync, readFileSync } from "node:fs";
import {
  delegationCategoryRulesSchema,
  hookRuntimeConfigSchema,
  runtimeTogglesSchema,
  runtimeSettingsOverridesSchema,
  runtimeSettingsSchema,
  type DelegationCategoryRules,
  type HookRuntimeConfig,
  type RuntimeSettings,
  type RuntimeSettingsOverrides,
  type RuntimeToggles
} from "../contracts/index.js";

const SETTINGS_PATH = "settings/framework-settings.json";

function resolveTogglesWithPrecedence(preset: RuntimeSettings, overrides: RuntimeSettingsOverrides): RuntimeToggles {
  return runtimeTogglesSchema.parse({
    ...preset.toggles,
    ...(overrides.toggles ?? {})
  });
}

const BASE_RUNTIME_SETTINGS: RuntimeSettings = runtimeSettingsSchema.parse({
  contextStrategy: "minimal",
  toggles: {
    useWorktreesByDefault: false,
    manageGitByDefault: false,
    requireTests: false,
    requireApprovalGates: false,
    requireVerification: false,
    requireCodeReview: false,
    enableTaskArtifacts: false
  },
  delegationRules: {
    feature: { preferredSubagent: "TaskManager" },
    planning: { preferredSubagent: "TaskPlanner" },
    context: { preferredSubagent: "ContextScout" },
    validation: { preferredSubagent: "Tester" },
    review: { preferredSubagent: "Reviewer" },
    build: { preferredSubagent: "BuildValidator" },
    docs: { preferredSubagent: "ExternalDocsScout" },
    completion: { preferredSubagent: "Reviewer" },
    implementation: { preferredSubagent: "Coder" }
  },
  hookRuntime: {
    enabled: true,
    hooks: {
      "context-injection-note": { enabled: true, note: "Using lightweight minimal context strategy." },
      "output-truncation-guard": { enabled: true, maxOutputChars: 12000 },
      "completion-continuation-reminder": {
        enabled: true,
        note: "Continue from next ready subtask."
      }
    }
  }
});

export function resolveRuntimeSettings(input?: unknown): RuntimeSettings {
  const rawOverrides =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const legacyToggleKeys = [
    "useWorktreesByDefault",
    "manageGitByDefault",
    "requireTests",
    "requireApprovalGates",
    "requireVerification",
    "requireCodeReview",
    "enableTaskArtifacts"
  ];
  const unsupportedLegacyKeys = legacyToggleKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(rawOverrides, key)
  );
  if (unsupportedLegacyKeys.length > 0) {
    throw new Error(
      `Runtime settings only support nested toggles. Move ${unsupportedLegacyKeys.join(", ")} under settings.toggles.`
    );
  }

  const overrides = runtimeSettingsOverridesSchema.parse({
    ...rawOverrides
  });
  const preset = BASE_RUNTIME_SETTINGS;
  const toggles = resolveTogglesWithPrecedence(preset, overrides);

  const merged = {
    ...preset,
    ...overrides,
    toggles,
    delegationRules: {
      ...preset.delegationRules,
      ...(overrides.delegationRules ?? {})
    },
    hookRuntime: {
      ...preset.hookRuntime,
      ...(overrides.hookRuntime ?? {}),
      hooks: {
        ...preset.hookRuntime.hooks,
        ...(overrides.hookRuntime?.hooks ?? {})
      }
    }
  };

  return runtimeSettingsSchema.parse(merged);
}

export function loadRuntimeSettings(settingsPath = SETTINGS_PATH): RuntimeSettings {
  if (!existsSync(settingsPath)) {
    return BASE_RUNTIME_SETTINGS;
  }
  const raw = readFileSync(settingsPath, "utf8");
  const parsed = JSON.parse(raw);
  return resolveRuntimeSettings(parsed);
}

export function loadDelegationRules(settings: RuntimeSettings): DelegationCategoryRules {
  return delegationCategoryRulesSchema.parse(settings.delegationRules ?? {});
}

export function loadHookRuntimeConfig(settings: RuntimeSettings): HookRuntimeConfig {
  return hookRuntimeConfigSchema.parse(settings.hookRuntime ?? { enabled: true, hooks: {} });
}

import { existsSync, readFileSync } from "node:fs";
import {
  delegationCategoryProfilesSchema,
  hookRuntimeConfigSchema,
  runtimeSettingsOverridesSchema,
  runtimeSettingsSchema,
  type DelegationCategoryProfiles,
  type HookRuntimeConfig,
  type RuntimeSettings,
  type SettingsProfile
} from "../contracts/index.js";

const SETTINGS_PATH = "settings/framework-settings.json";

const PROFILE_PRESETS: Record<SettingsProfile, RuntimeSettings> = {
  light: runtimeSettingsSchema.parse({
    profile: "light",
    contextStrategy: "minimal",
    useWorktreesByDefault: false,
    manageGitByDefault: false,
    requireTests: false,
    requireApprovalGates: false,
    requireVerification: false,
    requireCodeReview: false,
    enableTaskArtifacts: false,
    delegationProfiles: {
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
  }),
  balanced: runtimeSettingsSchema.parse({
    profile: "balanced",
    contextStrategy: "standard",
    useWorktreesByDefault: false,
    manageGitByDefault: false,
    requireTests: false,
    requireApprovalGates: false,
    requireVerification: true,
    requireCodeReview: true,
    enableTaskArtifacts: true,
    delegationProfiles: {
      feature: { preferredSubagent: "TaskManager", requiredSkills: ["hf-task-management"] },
      planning: { preferredSubagent: "TaskPlanner" },
      context: { preferredSubagent: "ContextScout" },
      validation: { preferredSubagent: "Tester", requiredSkills: ["hf-verification-before-completion"] },
      review: { preferredSubagent: "Reviewer" },
      build: { preferredSubagent: "BuildValidator" },
      docs: { preferredSubagent: "ExternalDocsScout" },
      completion: { preferredSubagent: "Reviewer", requiredSkills: ["hf-verification-before-completion"] },
      implementation: { preferredSubagent: "Coder" }
    },
    hookRuntime: {
      enabled: true,
      hooks: {
        "context-injection-note": { enabled: true, note: "Using markdown-first context and contracts." },
        "output-truncation-guard": { enabled: true, maxOutputChars: 10000 },
        "completion-continuation-reminder": {
          enabled: true,
          note: "Continue from the next ready subtask and preserve dependency order."
        }
      }
    }
  }),
  strict: runtimeSettingsSchema.parse({
    profile: "strict",
    contextStrategy: "standard",
    useWorktreesByDefault: false,
    manageGitByDefault: false,
    requireTests: true,
    requireApprovalGates: true,
    requireVerification: true,
    requireCodeReview: true,
    enableTaskArtifacts: true,
    delegationProfiles: {
      feature: { preferredSubagent: "TaskManager", requiredSkills: ["hf-task-management"] },
      planning: { preferredSubagent: "TaskPlanner" },
      context: { preferredSubagent: "ContextScout" },
      validation: {
        preferredSubagent: "Tester",
        requiredSkills: ["hf-test-driven-development", "hf-verification-before-completion"]
      },
      review: { preferredSubagent: "Reviewer", requiredSkills: ["hf-verification-before-completion"] },
      build: { preferredSubagent: "BuildValidator" },
      docs: { preferredSubagent: "ExternalDocsScout" },
      completion: { preferredSubagent: "Reviewer", requiredSkills: ["hf-verification-before-completion"] },
      implementation: { preferredSubagent: "Coder" }
    },
    hookRuntime: {
      enabled: true,
      hooks: {
        "context-injection-note": { enabled: true, note: "Using markdown-first context and contracts." },
        "output-truncation-guard": { enabled: true, maxOutputChars: 8000 },
        "completion-continuation-reminder": {
          enabled: true,
          note: "Continue from the next ready subtask and preserve dependency order."
        }
      }
    }
  })
};

export function profilePreset(profile: SettingsProfile): RuntimeSettings {
  return PROFILE_PRESETS[profile];
}

export function resolveRuntimeSettings(input?: unknown): RuntimeSettings {
  const overrides = runtimeSettingsOverridesSchema.parse(input ?? {});
  const profile = overrides.profile ?? "light";
  const preset = profilePreset(profile);

  const merged = {
    ...preset,
    ...overrides,
    delegationProfiles: {
      ...preset.delegationProfiles,
      ...(overrides.delegationProfiles ?? {})
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
    return profilePreset("light");
  }
  const raw = readFileSync(settingsPath, "utf8");
  const parsed = JSON.parse(raw);
  return resolveRuntimeSettings(parsed);
}

export function loadDelegationProfiles(settings: RuntimeSettings): DelegationCategoryProfiles {
  return delegationCategoryProfilesSchema.parse(settings.delegationProfiles ?? {});
}

export function loadHookRuntimeConfig(settings: RuntimeSettings): HookRuntimeConfig {
  return hookRuntimeConfigSchema.parse(settings.hookRuntime ?? { enabled: true, hooks: {} });
}

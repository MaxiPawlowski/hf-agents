import { readFileSync } from "node:fs";
import YAML from "yaml";
import {
  backgroundTaskConfigSchema,
  delegationCategoryProfilesSchema,
  hookRuntimeConfigSchema,
  mcpIntegrationsSchema,
  policySchema,
  type BackgroundTaskConfig,
  type DelegationCategoryProfiles,
  type HookRuntimeConfig,
  type McpIntegrations,
  type Policy,
  type PolicyMode
} from "../contracts/index.js";

export function loadPolicy(policyPath: string): Policy {
  const raw = readFileSync(policyPath, "utf8");
  const parsed = YAML.parse(raw);
  return policySchema.parse(parsed);
}

export function policyFileForMode(mode: PolicyMode): string {
  return `policies/${mode}.yaml`;
}

export function loadDelegationProfiles(policy: Policy): DelegationCategoryProfiles {
  return delegationCategoryProfilesSchema.parse(policy.delegationProfiles ?? {});
}

export function loadHookRuntimeConfig(policy: Policy): HookRuntimeConfig {
  return hookRuntimeConfigSchema.parse(policy.hookRuntime ?? { enabled: true, hooks: {} });
}

export function loadBackgroundTaskConfig(policy: Policy): BackgroundTaskConfig {
  return backgroundTaskConfigSchema.parse(policy.backgroundTask ?? { defaultConcurrency: 2, staleTimeoutMs: 180000 });
}

export function loadMcpIntegrations(policy: Policy): McpIntegrations {
  return mcpIntegrationsSchema.parse(
    policy.mcp ?? {
      tavily: { enabled: true, maxResults: 5 },
      ghGrep: { enabled: true, maxResults: 10 }
    }
  );
}

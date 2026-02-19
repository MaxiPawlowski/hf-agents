import { readFileSync } from "node:fs";
import YAML from "yaml";
import {
  delegationCategoryProfilesSchema,
  hookRuntimeConfigSchema,
  policySchema,
  type DelegationCategoryProfiles,
  type HookRuntimeConfig,
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

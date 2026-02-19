import { readFileSync } from "node:fs";
import YAML from "yaml";
import { policySchema, type PolicyMode, type Policy } from "../contracts/index.js";

export function loadPolicy(policyPath: string): Policy {
  const raw = readFileSync(policyPath, "utf8");
  const parsed = YAML.parse(raw);
  return policySchema.parse(parsed);
}

export function policyFileForMode(mode: PolicyMode): string {
  return `policies/${mode}.yaml`;
}

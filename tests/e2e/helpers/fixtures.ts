import path from "node:path";

import { isString } from "../../../src/runtime/utils.js";

export const PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY"
] as const;

export const PROVIDER_SKIP_MESSAGE = "Skipping e2e tests: no LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.";

export const FIXTURE_PLAN_PATH = path.join("plans", "2026-01-01-test-plan.md");

export const FIXTURE_PLAN_CONTENT = `---
plan: test
status: in-progress
---

# Plan: Test

## User Intent

Exercise the OpenCode subprocess harness against a minimal fixture project.

## Milestones

- [ ] 1. Smoke milestone for fixture harness
`;

export const PLAN_VAULT_FILES = {
  "vault/plans/test/context.md": `# Plan context

## Focus

Validate the e2e harness and fixture structure.
`,
  "vault/plans/test/discoveries.md": `# Plan discoveries

## Notes

The fixture plan slug resolves to test.
`,
  "vault/plans/test/decisions.md": `# Plan decisions

## Decisions

Use temporary directories for subprocess isolation.
`,
  "vault/plans/test/references.md": `# Plan references

## References

Reference the built plugin from dist.
`
} as const;

export const SHARED_VAULT_FILES = {
  "vault/shared/architecture.md": `# Shared architecture

## Runtime

The OpenCode plugin loads the hybrid runtime from the built output.
`,
  "vault/shared/patterns.md": `# Shared patterns

## Testing

Use subprocess execution for end-to-end verification.
`,
  "vault/shared/decisions.md": `# Shared decisions

## Tooling

Vitest drives the fixture lifecycle in tests.
`
} as const;

export function hasProviderApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return PROVIDER_ENV_VARS.some((name) => {
    const value = env[name];
    return isString(value) && value.trim().length > 0;
  });
}

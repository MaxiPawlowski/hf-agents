import { describe, expect, test } from "vitest";

import { buildResumePrompt, buildPlanlessResumePrompt, formatSemanticVaultContext, formatToolSearchResults } from "../src/runtime/prompt.js";
import type { ParsedPlan, RuntimeStatus, VaultContext, VaultSearchResult } from "../src/runtime/types.js";

function makePlan(overrides?: Partial<ParsedPlan>): ParsedPlan {
  return {
    path: "plans/2026-03-14-test-plan.md",
    slug: "test",
    raw: "",
    milestones: [
      { index: 1, checked: false, text: "1. Add runtime core", title: "Add runtime core" }
    ],
    currentMilestone: { index: 1, checked: false, text: "1. Add runtime core", title: "Add runtime core" },
    status: "in-progress",
    completed: false,
    approved: true,
    mtimeMs: Date.now(),
    config: { maxTotalTurns: 10, autoContinue: true },
    ...overrides
  };
}

function makeStatus(overrides?: Partial<RuntimeStatus>): RuntimeStatus {
  return {
    version: 1,
    planPath: "plans/2026-03-14-test-plan.md",
    planSlug: "test",
    planMtimeMs: Date.now(),
    loopState: "running",
    phase: "execution",
    currentMilestone: { index: 1, checked: false, text: "1. Add runtime core", title: "Add runtime core" },
    counters: {
      totalAttempts: 0,
      totalTurns: 0,
      maxTotalTurns: 10,
      noProgress: 0,
      repeatedBlocker: 0,
      verificationFailures: 0,
      turnsSinceLastOutcome: 0
    },
    sessions: {},
    subagents: [],
    autoContinue: true,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeSearchResults(count: number = 2): VaultSearchResult[] {
  const results: VaultSearchResult[] = [];
  for (let i = 0; i < count; i++) {
    results.push({
      score: 0.9 - i * 0.1,
      text: `Relevant content for chunk ${i + 1}.`,
      metadata: {
        sourcePath: `vault/plans/test/doc${i + 1}.md`,
        sectionTitle: `Section ${i + 1}`,
        documentTitle: `Document ${i + 1}`
      }
    });
  }
  return results;
}

function makeCodeSearchResult(overrides?: Partial<VaultSearchResult>): VaultSearchResult {
  return {
    score: 0.95,
    text: "function runTask() { return true; }",
    metadata: {
      sourcePath: "src/runtime/example.ts",
      sectionTitle: "runTask",
      documentTitle: "example.ts",
      kind: "code"
    },
    ...overrides
  };
}

function makeVault(): VaultContext {
  return {
    plan: [{ path: "vault/plans/test/discoveries.md", title: "Plan discoveries", content: "Brute-force plan finding" }],
    shared: [{ path: "vault/shared/patterns.md", title: "Shared patterns", content: "Brute-force shared pattern" }]
  };
}

describe("formatSemanticVaultContext", () => {
  test("produces vault section with section titles as sub-headers", () => {
    const results = makeSearchResults(2);
    const lines = formatSemanticVaultContext(results);

    expect(lines[0]).toBe("## Vault context");
    expect(lines).toContain("### Section 1");
    expect(lines).toContain("### Section 2");
    expect(lines.join("\n")).toContain("Relevant content for chunk 1.");
    expect(lines.join("\n")).toContain("Relevant content for chunk 2.");
  });

  test("returns empty array when results are empty", () => {
    const lines = formatSemanticVaultContext([]);
    expect(lines).toEqual([]);
  });

  test("respects char budget and truncates", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.95,
        text: "A".repeat(200),
        metadata: { sourcePath: "a.md", sectionTitle: "Large chunk", documentTitle: "Doc A" }
      }
    ];
    // Budget small enough that a single chunk barely fits the header + body
    const lines = formatSemanticVaultContext(results, 80);
    const text = lines.join("\n");

    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).toContain("[vault content truncated]");
  });

  test("prefixes code result section titles with [code]", () => {
    const lines = formatSemanticVaultContext([makeCodeSearchResult()]);

    expect(lines[0]).toBe("## Knowledge context");
    expect(lines).toContain("### [code] runTask");
  });

  test("uses knowledge context header for mixed vault and code results", () => {
    const [vaultResult] = makeSearchResults(1);
    const lines = formatSemanticVaultContext([vaultResult!, makeCodeSearchResult()]);

    expect(lines[0]).toBe("## Knowledge context");
  });

  test("keeps vault context header for vault-only results", () => {
    const lines = formatSemanticVaultContext(makeSearchResults(1));

    expect(lines[0]).toBe("## Vault context");
  });

  test("formatSemanticVaultContext prefixes external result section titles with [external]", () => {
    const result: VaultSearchResult = {
      score: 0.85,
      text: "function extFunc() { return 1; }",
      metadata: {
        sourcePath: "/absolute/path/external.ts",
        sectionTitle: "extFunc",
        documentTitle: "external.ts",
        kind: "external"
      }
    };
    const lines = formatSemanticVaultContext([result]);

    expect(lines[0]).toBe("## Knowledge context");
    expect(lines.join("\n")).toContain("### [external] extFunc");
  });
});

describe("buildResumePrompt with semantic retrieval", () => {
  test("uses semantic vault context when search results are provided", () => {
    const plan = makePlan();
    const status = makeStatus();
    const results = makeSearchResults(2);

    const prompt = buildResumePrompt(plan, status, null, results);

    expect(prompt).toContain("## Vault context");
    expect(prompt).toContain("### Section 1");
    expect(prompt).toContain("### Section 2");
    expect(prompt).toContain("Relevant content for chunk 1.");
    expect(prompt).toContain("Relevant content for chunk 2.");
  });

  test("falls back to brute-force when search results are null", () => {
    const plan = makePlan();
    const status = makeStatus();
    const vault = makeVault();

    const prompt = buildResumePrompt(plan, status, vault, null);

    expect(prompt).toContain("## Vault context");
    expect(prompt).toContain("### Plan discoveries");
    expect(prompt).toContain("Brute-force plan finding");
    expect(prompt).toContain("### Shared patterns");
    expect(prompt).toContain("Brute-force shared pattern");
    // Should NOT contain semantic section titles
    expect(prompt).not.toContain("### Section 1");
  });

  test("falls back to brute-force when search results are empty array", () => {
    const plan = makePlan();
    const status = makeStatus();
    const vault = makeVault();

    const prompt = buildResumePrompt(plan, status, vault, []);

    expect(prompt).toContain("## Vault context");
    expect(prompt).toContain("### Plan discoveries");
    expect(prompt).toContain("Brute-force plan finding");
  });

  test("prefers semantic results over brute-force when both are available", () => {
    const plan = makePlan();
    const status = makeStatus();
    const vault = makeVault();
    const results = makeSearchResults(1);

    const prompt = buildResumePrompt(plan, status, vault, results);

    expect(prompt).toContain("### Section 1");
    expect(prompt).not.toContain("### Plan discoveries");
    expect(prompt).not.toContain("Brute-force plan finding");
  });

  test("omits vault context when no search results and no vault context", () => {
    const plan = makePlan();
    const status = makeStatus();

    const prompt = buildResumePrompt(plan, status, null, null);

    expect(prompt).not.toContain("## Vault context");
  });

  test("vault context section appears between current milestone and last turn", () => {
    const plan = makePlan();
    const status = makeStatus();
    const results = makeSearchResults(1);

    const prompt = buildResumePrompt(plan, status, null, results);

    const milestoneIdx = prompt.indexOf("## Current milestone");
    const vaultIdx = prompt.indexOf("## Vault context");
    const lastTurnIdx = prompt.indexOf("## Last turn");

    expect(milestoneIdx).toBeGreaterThan(-1);
    expect(vaultIdx).toBeGreaterThan(milestoneIdx);
    expect(vaultIdx).toBeLessThan(lastTurnIdx);
  });

  test("planning phase includes vault context with reduced budget when vault documents exist", () => {
    const plan = makePlan({
      status: "planning",
      approved: false
    });
    const status = makeStatus({ phase: "planning" });
    const vault = makeVault();

    const prompt = buildResumePrompt(plan, status, vault, null);

    expect(prompt).toContain("planning-review loop");
    expect(prompt).toContain("## Vault context");
    expect(prompt).toContain("### Plan discoveries");
    expect(prompt).toContain("Brute-force plan finding");
    expect(prompt).toContain("### Shared patterns");
    expect(prompt).toContain("Brute-force shared pattern");
  });

  test("planning phase includes semantic vault context when search results are provided", () => {
    const plan = makePlan({
      status: "planning",
      approved: false
    });
    const status = makeStatus({ phase: "planning" });
    const results = makeSearchResults(2);

    const prompt = buildResumePrompt(plan, status, null, results);

    expect(prompt).toContain("planning-review loop");
    expect(prompt).toContain("## Vault context");
    expect(prompt).toContain("### Section 1");
    expect(prompt).toContain("### Section 2");
  });

  test("planning phase vault context uses reduced char budget", () => {
    const plan = makePlan({
      status: "planning",
      approved: false
    });
    const status = makeStatus({ phase: "planning" });
    const bigVault: VaultContext = {
      plan: [{ path: "vault/plans/test/big.md", title: "Big doc", content: "Y".repeat(4000) }],
      shared: [{ path: "vault/shared/big2.md", title: "Big shared", content: "Z".repeat(4000) }]
    };

    const prompt = buildResumePrompt(plan, status, bigVault, null);

    expect(prompt).toContain("## Vault context");
    // The vault section should be truncated due to the 4000 char planning budget
    expect(prompt).toContain("[vault content truncated]");
    // The second document should not appear because 4000 budget can't fit both
    expect(prompt).not.toContain("### Big shared");
  });

  test("planning phase omits vault context when no vault and no search results", () => {
    const plan = makePlan({
      status: "planning",
      approved: false
    });
    const status = makeStatus({ phase: "planning" });

    const prompt = buildResumePrompt(plan, status, null, null);

    expect(prompt).toContain("planning-review loop");
    expect(prompt).not.toContain("## Vault context");
  });

  test("char budget is respected with semantic search results in full prompt", () => {
    const bigResults: VaultSearchResult[] = [];
    for (let i = 0; i < 10; i++) {
      bigResults.push({
        score: 0.9 - i * 0.05,
        text: `${"X".repeat(500)} chunk ${i + 1}`,
        metadata: {
          sourcePath: `vault/doc${i}.md`,
          sectionTitle: `Big Section ${i + 1}`,
          documentTitle: `Doc ${i + 1}`
        }
      });
    }
    const plan = makePlan();
    const status = makeStatus();

    const prompt = buildResumePrompt(plan, status, null, bigResults);

    // The vault context section should not exceed the default 3000 char budget
    const vaultStart = prompt.indexOf("## Vault context");
    const afterVault = prompt.indexOf("## Last turn");
    const vaultSection = prompt.slice(vaultStart, afterVault);
    expect(vaultSection.length).toBeLessThanOrEqual(3100); // Allow small margin for headers
  });

  test("planning phase includes exploration state when vault documents exist", () => {
    const plan = makePlan({ status: "planning", approved: false });
    const status = makeStatus({ phase: "planning" });
    const vault = makeVault();

    const prompt = buildResumePrompt(plan, status, vault, null);

    expect(prompt).toContain("## Exploration state");
    expect(prompt).toContain("The following vault documents contain findings from prior exploration passes:");
    expect(prompt).toContain("**Plan discoveries**");
    expect(prompt).toContain("`vault/plans/test/discoveries.md`");
    expect(prompt).toContain("**Shared patterns**");
    expect(prompt).toContain("`vault/shared/patterns.md`");
  });

  test("planning phase omits exploration state when no vault documents exist", () => {
    const plan = makePlan({ status: "planning", approved: false });
    const status = makeStatus({ phase: "planning" });

    const prompt = buildResumePrompt(plan, status, null, null);

    expect(prompt).not.toContain("## Exploration state");
  });

  test("planning phase uses vault-referencing instruction text", () => {
    const plan = makePlan({ status: "planning", approved: false });
    const status = makeStatus({ phase: "planning" });

    const prompt = buildResumePrompt(plan, status, null, null);

    expect(prompt).toContain("Reference vault-persisted findings and the plan doc; avoid re-loading the full context bundle into conversation.");
    expect(prompt).not.toContain("Keep the full user request, local findings, constraints, and draft plan visible to both planner and reviewer.");
  });
});

describe("buildPlanlessResumePrompt", () => {
  test("returns stub message when vault is null", () => {
    const prompt = buildPlanlessResumePrompt(null);
    expect(prompt).toBe("No task is currently active. Wait for an explicit task before taking action.");
  });

  test("returns stub message when vault has no documents", () => {
    const prompt = buildPlanlessResumePrompt({ plan: [], shared: [] });
    expect(prompt).toBe("No task is currently active. Wait for an explicit task before taking action.");
  });

  test("returns enriched prompt when vault has shared documents", () => {
    const vault: VaultContext = {
      plan: [],
      shared: [{ path: "vault/shared/patterns.md", title: "Shared patterns", content: "Pattern content" }]
    };
    const prompt = buildPlanlessResumePrompt(vault);
    expect(prompt).toContain("No active plan. The runtime recovered vault context from a prior session.");
    expect(prompt).toContain("## Recovered context");
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("Shared patterns");
    expect(prompt).toContain("Pattern content");
  });

  test("uses semantic results when available", () => {
    const vault: VaultContext = {
      plan: [],
      shared: [{ path: "vault/shared/patterns.md", title: "Shared patterns", content: "Pattern content" }]
    };
    const results = makeSearchResults(1);
    const prompt = buildPlanlessResumePrompt(vault, results);
    expect(prompt).toContain("### Section 1");
    expect(prompt).not.toContain("### Shared patterns");
  });
});

describe("formatToolSearchResults", () => {
  test("returns empty message for empty results array", () => {
    const result = formatToolSearchResults([]);
    expect(result).toBe("No matching results found.");
  });

  test("formats a single vault result with number, label, source, score, and content", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.87,
        text: "Introduction content here.",
        metadata: {
          sourcePath: "vault/guides/planning.md",
          sectionTitle: "Introduction to Planning",
          documentTitle: "Planning Guide"
        }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("1. [vault] Introduction to Planning");
    expect(output).toContain("   Source: vault/guides/planning.md");
    expect(output).toContain("   Score: 0.87");
    expect(output).toContain("   Introduction content here.");
  });

  test("formats a code result with [code] kind label", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.82,
        text: "function buildResumePrompt() {}",
        metadata: {
          sourcePath: "src/runtime/prompt.ts",
          sectionTitle: "buildResumePrompt",
          documentTitle: "prompt.ts",
          kind: "code"
        }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("1. [code] buildResumePrompt");
    expect(output).toContain("   Source: src/runtime/prompt.ts");
    expect(output).toContain("   Score: 0.82");
    expect(output).toContain("   function buildResumePrompt() {}");
  });

  test("formats an external result with [external] kind label", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.78,
        text: "export function externalHelper() {}",
        metadata: {
          sourcePath: "/absolute/path/to/helper.ts",
          sectionTitle: "externalHelper",
          documentTitle: "helper.ts",
          kind: "external"
        }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("1. [external] externalHelper");
    expect(output).toContain("   Source: /absolute/path/to/helper.ts");
    expect(output).toContain("   Score: 0.78");
    expect(output).toContain("   export function externalHelper() {}");
  });

  test("uses [vault] label when kind is undefined", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.75,
        text: "Some vault content.",
        metadata: {
          sourcePath: "vault/shared/patterns.md",
          sectionTitle: "Patterns",
          documentTitle: "Patterns"
          // kind intentionally omitted
        }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("1. [vault] Patterns");
  });

  test("formats score to exactly 2 decimal places", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.9,
        text: "Content.",
        metadata: { sourcePath: "vault/a.md", sectionTitle: "A", documentTitle: "A" }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("   Score: 0.90");
  });

  test("formats mixed vault and code results with correct numbers and labels", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.95,
        text: "Vault content.",
        metadata: {
          sourcePath: "vault/guides/planning.md",
          sectionTitle: "Planning Overview",
          documentTitle: "Planning Guide",
          kind: "vault"
        }
      },
      {
        score: 0.82,
        text: "Code content.",
        metadata: {
          sourcePath: "src/runtime/runtime.ts",
          sectionTitle: "queryIndex",
          documentTitle: "runtime.ts",
          kind: "code"
        }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("1. [vault] Planning Overview");
    expect(output).toContain("   Score: 0.95");
    expect(output).toContain("2. [code] queryIndex");
    expect(output).toContain("   Score: 0.82");
  });

  test("separates multiple results with blank lines", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.9,
        text: "First content.",
        metadata: { sourcePath: "vault/a.md", sectionTitle: "First", documentTitle: "A" }
      },
      {
        score: 0.8,
        text: "Second content.",
        metadata: { sourcePath: "vault/b.md", sectionTitle: "Second", documentTitle: "B" }
      }
    ];
    const output = formatToolSearchResults(results);
    // There should be a blank line between the two blocks
    expect(output).toContain("\n\n");
    // Both results should appear
    expect(output).toContain("1. [vault] First");
    expect(output).toContain("2. [vault] Second");
  });

  test("output ends with a trailing newline", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.9,
        text: "Content.",
        metadata: { sourcePath: "vault/a.md", sectionTitle: "A", documentTitle: "A" }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output.endsWith("\n")).toBe(true);
  });

  test("formatToolSearchResults labels external results with [external]", () => {
    const results: VaultSearchResult[] = [
      {
        score: 0.88,
        text: "function ext() { return 'external'; }",
        metadata: {
          sourcePath: "/absolute/path/external.ts",
          sectionTitle: "ext",
          documentTitle: "external.ts",
          kind: "external"
        }
      }
    ];
    const output = formatToolSearchResults(results);
    expect(output).toContain("[external]");
    expect(output).toContain("1. [external] ext");
  });
});

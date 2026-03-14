import { describe, expect, test } from "vitest";

import { buildResumePrompt, formatSemanticVaultContext } from "../src/runtime/prompt.js";
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
      plan: [{ path: "vault/plans/test/big.md", title: "Big doc", content: "Y".repeat(2000) }],
      shared: [{ path: "vault/shared/big2.md", title: "Big shared", content: "Z".repeat(2000) }]
    };

    const prompt = buildResumePrompt(plan, status, bigVault, null);

    expect(prompt).toContain("## Vault context");
    // The vault section should be truncated due to the 1500 char planning budget
    expect(prompt).toContain("[vault content truncated]");
    // The second document should not appear because 1500 budget can't fit both
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
});

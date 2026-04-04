import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadIndexConfig, DEFAULT_INDEX_CONFIG } from "../src/runtime/persistence.js";

describe("loadIndexConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-cfg-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", async () => {
    const config = await loadIndexConfig(tmpDir);
    expect(config).toEqual(DEFAULT_INDEX_CONFIG);
  });

  it("returns defaults when config has no index key", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({ adapters: { claude: { enabled: true } } }),
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config).toEqual(DEFAULT_INDEX_CONFIG);
  });

  it("merges partial index overrides with defaults", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({
        index: {
          semanticTopK: 10,
          code: { roots: ["lib", "src"] },
        },
      }),
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config.semanticTopK).toBe(10);
    expect(config.code.roots).toEqual(["lib", "src"]);
    // Rest stays default
    expect(config.code.extensions).toEqual([".ts"]);
    expect(config.enabled).toBe(true);
    expect(config.maxChunkChars).toBe(2000);
    expect(config.charBudget).toBe(3000);
    expect(config.planningCharBudget).toBe(4000);
    expect(config.planningSemanticTopK).toBe(5);
  });

  it("ignores invalid types and uses defaults", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({
        index: {
          // should be boolean
          enabled: "yes",
          // should be positive
          semanticTopK: -5,
          // should be number
          planningSemanticTopK: "abc",
          code: {
            // should be string[]
            roots: 42,
            // elements should be strings
            extensions: [123],
          },
        },
      }),
    );
    const config = await loadIndexConfig(tmpDir);
    // fallback
    expect(config.enabled).toBe(true);
    // fallback
    expect(config.semanticTopK).toBe(5);
    // fallback
    expect(config.code.roots).toEqual(["src"]);
    // fallback
    expect(config.code.extensions).toEqual([".ts"]);
    // fallback
    expect(config.planningSemanticTopK).toBe(5);
  });

  it("handles malformed JSON gracefully", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      "{ not valid json }}}",
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config).toEqual(DEFAULT_INDEX_CONFIG);
  });

  it("respects enabled: false", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({ index: { enabled: false } }),
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config.enabled).toBe(false);
  });

  it("respects code.enabled: false", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({ index: { code: { enabled: false } } }),
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config.code.enabled).toBe(false);
    expect(config.enabled).toBe(true);
  });

  it("overrides planningSemanticTopK", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({ index: { planningSemanticTopK: 10 } }),
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config.planningSemanticTopK).toBe(10);
  });

  it("overrides charBudget and planningCharBudget", async () => {
    await fs.writeFile(
      path.join(tmpDir, "hybrid-framework.json"),
      JSON.stringify({ index: { charBudget: 5000, planningCharBudget: 2500 } }),
    );
    const config = await loadIndexConfig(tmpDir);
    expect(config.charBudget).toBe(5000);
    expect(config.planningCharBudget).toBe(2500);
  });
});

import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { VaultPaths } from "../src/runtime/types.js";
import { loadUnifiedIndex } from "../src/index/unified-store.js";
import { buildUnifiedIndex, chunkExternalFile, scanExternalFiles } from "../src/index/unified-index-pipeline.js";

import type * as VaultEmbeddings from "../src/index/vault-embeddings.js";

vi.mock("../src/index/vault-embeddings.js", async () => {
  const actual = await vi.importActual<typeof VaultEmbeddings>("../src/index/vault-embeddings.js");

  return {
    EmbeddingModelError: actual.EmbeddingModelError,
    embed: vi.fn(),
    embedBatch: vi.fn(),
  };
});

import { EmbeddingModelError, embedBatch } from "../src/index/vault-embeddings.js";

const mockedEmbedBatch = vi.mocked(embedBatch);

function makeVector(seed: number): number[] {
  const vector = Array.from({ length: 384 }, () => 0);
  vector[0] = seed;
  vector[1] = seed + 1;
  return vector;
}

function makeVaultPaths(root: string): VaultPaths {
  const vaultRoot = path.join(root, "vault");
  return {
    vaultRoot,
    planDir: path.join(vaultRoot, "plans", "test-plan"),
    sharedDir: path.join(vaultRoot, "shared"),
    planFiles: [],
    sharedFiles: [],
  };
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("unified-index-pipeline", () => {
  let tmpDir: string;
  let vectorSeed: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-pipeline-"));
    vectorSeed = 1;
    mockedEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map(() => makeVector(vectorSeed++)),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("full build from scratch", async () => {
    const vaultPaths = makeVaultPaths(tmpDir);
    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      "## Context\nPlan content long enough to produce a vault chunk.",
    );
    await writeFile(
      path.join(tmpDir, "src", "feature.ts"),
      "export function feature() { return 'ready'; }",
    );
    await writeFile(path.join(tmpDir, "src", "ignored.test.ts"), "export const ignored = true;");
    await writeFile(path.join(tmpDir, "src", "types.d.ts"), "export interface Ignored {}\n");

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      codeConfig: { roots: ["src"] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.index.fileHashes)).toHaveLength(2);
    expect(result.index.items.some((item) => item.metadata.kind === "vault")).toBe(true);
    expect(result.index.items.some((item) => item.metadata.kind === "code")).toBe(true);

    const persisted = await loadUnifiedIndex(tmpDir);
    expect(persisted?.index.fileHashes).toEqual(result.index.fileHashes);
  });

  test("incremental skip for unchanged files", async () => {
    const vaultPaths = makeVaultPaths(tmpDir);
    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      "## Context\nPlan content long enough to produce a vault chunk.",
    );
    await writeFile(
      path.join(tmpDir, "src", "feature.ts"),
      "export function feature() { return 'ready'; }",
    );

    const first = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      codeConfig: { roots: ["src"] },
    });
    expect(first).not.toBeNull();
    expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);

    mockedEmbedBatch.mockClear();

    const second = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      codeConfig: { roots: ["src"] },
    });

    expect(second).not.toBeNull();
    assert(second !== null, "Expected second to be non-null");
    assert(first !== null, "Expected first to be non-null");
    expect(second.index.fileHashes).toEqual(first.index.fileHashes);
    expect(mockedEmbedBatch).not.toHaveBeenCalled();
  });

  test("incremental re-embed for changed file", async () => {
    await writeFile(
      path.join(tmpDir, "src", "a.ts"),
      "export function alpha() { return 'one'; }",
    );
    await writeFile(
      path.join(tmpDir, "src", "b.ts"),
      "export function beta() { return 'two'; }",
    );

    const first = await buildUnifiedIndex({
      repoRoot: tmpDir,
      codeConfig: { roots: ["src"] },
    });
    expect(first).not.toBeNull();

    mockedEmbedBatch.mockClear();
    await writeFile(
      path.join(tmpDir, "src", "b.ts"),
      "export function beta() { return 'three'; }",
    );

    const second = await buildUnifiedIndex({
      repoRoot: tmpDir,
      codeConfig: { roots: ["src"] },
    });

    expect(second).not.toBeNull();
    assert(second !== null, "Expected second to be non-null");
    expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockedEmbedBatch.mock.calls[0]?.[0]).toHaveLength(1);
    expect(mockedEmbedBatch.mock.calls[0]?.[0]?.[0]).toContain("three");
    expect(
      second.index.items.find((item) => String(item.metadata.sourcePath).endsWith("b.ts"))?.text,
    ).toContain("three");
    expect(
      second.index.items.find((item) => String(item.metadata.sourcePath).endsWith("a.ts"))?.text,
    ).toContain("one");
  });

  test("incremental purge for removed file", async () => {
    await writeFile(
      path.join(tmpDir, "src", "a.ts"),
      "export function alpha() { return 'one'; }",
    );
    await writeFile(
      path.join(tmpDir, "src", "b.ts"),
      "export function beta() { return 'two'; }",
    );

    const first = await buildUnifiedIndex({
      repoRoot: tmpDir,
      codeConfig: { roots: ["src"] },
    });
    expect(first).not.toBeNull();

    mockedEmbedBatch.mockClear();
    await fs.rm(path.join(tmpDir, "src", "b.ts"));

    const second = await buildUnifiedIndex({
      repoRoot: tmpDir,
      codeConfig: { roots: ["src"] },
    });

    expect(second).not.toBeNull();
    assert(second !== null, "Expected second to be non-null");
    expect(mockedEmbedBatch).not.toHaveBeenCalled();
    expect(
      second.index.items.some((item) => String(item.metadata.sourcePath).endsWith("b.ts")),
    ).toBe(false);
    expect(Object.keys(second.index.fileHashes).some((filePath) => filePath.endsWith("b.ts"))).toBe(false);
  });

  test("batched embedding splits into sub-batches", async () => {
    for (let i = 0; i < 205; i++) {
      await writeFile(
        path.join(tmpDir, "src", `file-${i}.ts`),
        `export function feature${i}() { return ${i}; }`,
      );
    }

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      codeConfig: { roots: ["src"] },
    });

    expect(result).not.toBeNull();
    expect(mockedEmbedBatch).toHaveBeenCalledTimes(3);
    expect(mockedEmbedBatch.mock.calls.map((call) => call[0].length)).toEqual([100, 100, 5]);
  });

  test("mixed vault and code merges correctly", async () => {
    const vaultPaths = makeVaultPaths(tmpDir);
    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      "## Context\nPlan content long enough to produce a vault chunk.",
    );
    await writeFile(
      path.join(vaultPaths.sharedDir, "architecture.md"),
      "## Architecture\nShared content long enough to produce a vault chunk.",
    );
    await writeFile(
      path.join(tmpDir, "src", "feature.ts"),
      "export function feature() { return 'ready'; }",
    );

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      codeConfig: { roots: ["src"] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    expect(Object.keys(result.index.fileHashes)).toHaveLength(3);
    expect(result.index.items.filter((item) => item.metadata.kind === "vault")).toHaveLength(2);
    expect(result.index.items.filter((item) => item.metadata.kind === "code")).toHaveLength(1);
  });

  test("stores relative paths in fileHashes and sourcePath metadata", async () => {
    const vaultPaths = makeVaultPaths(tmpDir);
    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      "## Context\nPlan content long enough to produce a vault chunk.",
    );
    await writeFile(
      path.join(tmpDir, "src", "feature.ts"),
      "export function feature() { return 'ready'; }",
    );

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      codeConfig: { roots: ["src"] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");

    // fileHashes keys should be relative
    for (const key of Object.keys(result.index.fileHashes)) {
      expect(path.isAbsolute(key)).toBe(false);
      expect(key).not.toContain("\\");
    }

    // sourcePath metadata should be relative
    for (const item of result.index.items) {
      const sourcePath = String(item.metadata.sourcePath);
      expect(path.isAbsolute(sourcePath)).toBe(false);
      expect(sourcePath).not.toContain("\\");
    }
  });

  test("maxChunkChars splits oversized vault sections", async () => {
    const vaultPaths = makeVaultPaths(tmpDir);
    // Create a long section (~200 chars)
    const longBody = "A".repeat(200);
    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      `## LongSection\n${longBody}`,
    );

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      maxChunkChars: 100,
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    // The single section should be split into multiple chunks
    expect(result.index.items.length).toBeGreaterThan(1);
    // Each chunk's text should be <= 100 chars
    for (const item of result.index.items) {
      expect(item.text.length).toBeLessThanOrEqual(100);
    }
    // All chunks should reference the same source
    const sourcePaths = new Set(result.index.items.map((i) => String(i.metadata.sourcePath)));
    expect(sourcePaths.size).toBe(1);
  });

  test("omits code chunks when codeConfig is undefined (code.enabled: false)", async () => {
    const vaultPaths = makeVaultPaths(tmpDir);
    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      "## Context\nPlan content long enough to produce a vault chunk.",
    );
    // Also write a code file that should be ignored
    await writeFile(
      path.join(tmpDir, "src", "feature.ts"),
      "export function feature() { return 'ready'; }",
    );

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      // codeConfig intentionally omitted — simulates code.enabled: false
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    const codeItems = result.index.items.filter((item) => item.metadata.kind === "code");
    const vaultItems = result.index.items.filter((item) => item.metadata.kind === "vault");
    expect(codeItems).toHaveLength(0);
    expect(vaultItems.length).toBeGreaterThan(0);
    // fileHashes should only contain the vault file
    const keys = Object.keys(result.index.fileHashes);
    expect(keys.every((k) => k.startsWith("vault/"))).toBe(true);
  });

  test("EmbeddingModelError returns null", async () => {
    await writeFile(
      path.join(tmpDir, "src", "feature.ts"),
      "export function feature() { return 'ready'; }",
    );
    mockedEmbedBatch.mockRejectedValueOnce(new EmbeddingModelError("mock embed failure"));

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      codeConfig: { roots: ["src"] },
    });

    expect(result).toBeNull();
  });
});

describe("scanExternalFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scan-external-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("scans .ts, .js, and .md files from an absolute root path", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "utils.ts"), "export function util() {}");
    await writeFile(path.join(extRoot, "helper.js"), "module.exports = {};");
    await writeFile(path.join(extRoot, "readme.md"), "## Readme\nSome content.");
    await writeFile(path.join(extRoot, "data.csv"), "a,b,c");

    const files = await scanExternalFiles({ roots: [extRoot] });

    expect(files).toHaveLength(3);
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("utils.ts") || p.includes("utils.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("helper.js") || p.includes("helper.js"))).toBe(true);
    expect(paths.some((p) => p.endsWith("readme.md") || p.includes("readme.md"))).toBe(true);
    // .csv should not be included
    expect(paths.some((p) => p.endsWith(".csv"))).toBe(false);
  });

  test("all scanned external files have kind: 'external'", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "utils.ts"), "export function util() {}");
    await writeFile(path.join(extRoot, "readme.md"), "## Readme\nContent here.");

    const files = await scanExternalFiles({ roots: [extRoot] });

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.kind === "external")).toBe(true);
  });

  test("stores absolute paths (not relative to repoRoot)", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "utils.ts"), "export function util() {}");

    const files = await scanExternalFiles({ roots: [extRoot] });

    expect(files).toHaveLength(1);
    const [firstFile] = files;
    assert(firstFile !== undefined, "Expected files[0] to be defined");
    expect(path.isAbsolute(firstFile.path)).toBe(true);
  });

  test("respects custom extensions filter", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "utils.ts"), "export function util() {}");
    await writeFile(path.join(extRoot, "readme.md"), "## Readme\nContent.");
    await writeFile(path.join(extRoot, "script.js"), "var x = 1;");

    const files = await scanExternalFiles({ roots: [extRoot], extensions: [".md"] });

    expect(files).toHaveLength(1);
    const [firstFile] = files;
    assert(firstFile !== undefined, "Expected files[0] to be defined");
    expect(firstFile.path.endsWith("readme.md") || firstFile.path.includes("readme.md")).toBe(true);
  });

  test("respects exclude patterns", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "utils.ts"), "export function util() {}");
    await writeFile(path.join(extRoot, "node_modules", "dep.ts"), "export {};");

    const files = await scanExternalFiles({ roots: [extRoot] });

    // node_modules should be excluded by default
    expect(files.every((f) => !f.path.includes("node_modules"))).toBe(true);
  });

  test("returns empty array for non-existent root", async () => {
    const files = await scanExternalFiles({ roots: [path.join(tmpDir, "nonexistent")] });
    expect(files).toHaveLength(0);
  });

  test("returns empty array when roots is empty", async () => {
    const files = await scanExternalFiles({ roots: [] });
    expect(files).toHaveLength(0);
  });

  test("external files use absolute paths in fileHashes and sourcePath", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "helper.ts"), "export function helper() { return 42; }");
    const mockedEmbedBatch = vi.mocked((await import("../src/index/vault-embeddings.js")).embedBatch);
    mockedEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => { const v = Array.from({ length: 384 }, () => 0); v[0] = i + 1; return v; }),
    );

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      externalConfig: { roots: [extRoot] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");

    // All fileHashes keys for external files should be absolute
    for (const key of Object.keys(result.index.fileHashes)) {
      expect(path.isAbsolute(key)).toBe(true);
    }

    // All external item sourcePaths should be absolute
    const externalItems = result.index.items.filter((item) => item.metadata.kind === "external");
    expect(externalItems.length).toBeGreaterThan(0);
    for (const item of externalItems) {
      expect(path.isAbsolute(String(item.metadata.sourcePath))).toBe(true);
    }
  });
});

describe("buildUnifiedIndex with external files", () => {
  let tmpDir: string;
  let vectorSeed: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "build-external-"));
    vectorSeed = 100;
    mockedEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map(() => {
        const v = Array.from({ length: 384 }, () => 0);
        v[0] = vectorSeed++;
        return v;
      }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("external .ts files are indexed with kind: 'external'", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "helper.ts"), "export function helper() { return 42; }");

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      externalConfig: { roots: [extRoot] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    const externalItems = result.index.items.filter((item) => item.metadata.kind === "external");
    expect(externalItems.length).toBeGreaterThan(0);
  });

  test("external .md files are indexed with kind: 'external'", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "notes.md"), "## Notes\nSome external notes here.");

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      externalConfig: { roots: [extRoot] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    const externalItems = result.index.items.filter((item) => item.metadata.kind === "external");
    expect(externalItems.length).toBeGreaterThan(0);
  });

  test("stale external files are pruned on rebuild when removed from disk", async () => {
    const extRoot = path.join(tmpDir, "external");
    await writeFile(path.join(extRoot, "a.ts"), "export function a() { return 1; }");
    await writeFile(path.join(extRoot, "b.ts"), "export function b() { return 2; }");

    const first = await buildUnifiedIndex({
      repoRoot: tmpDir,
      externalConfig: { roots: [extRoot] },
    });
    expect(first).not.toBeNull();
    assert(first !== null, "Expected first to be non-null");
    expect(first.index.items.some((item) => String(item.metadata.sourcePath).includes("b.ts"))).toBe(true);

    // Remove b.ts and rebuild
    await fs.rm(path.join(extRoot, "b.ts"));

    const second = await buildUnifiedIndex({
      repoRoot: tmpDir,
      externalConfig: { roots: [extRoot] },
    });
    expect(second).not.toBeNull();
    assert(second !== null, "Expected second to be non-null");
    // b.ts chunks should be gone
    expect(second.index.items.some((item) => String(item.metadata.sourcePath).includes("b.ts"))).toBe(false);
  });

  test("mixed vault, code, and external files all indexed together", async () => {
    const vaultPaths: VaultPaths = {
      vaultRoot: path.join(tmpDir, "vault"),
      planDir: path.join(tmpDir, "vault", "plans", "test"),
      sharedDir: path.join(tmpDir, "vault", "shared"),
      planFiles: [],
      sharedFiles: [],
    };
    const extRoot = path.join(tmpDir, "external");

    await writeFile(
      path.join(vaultPaths.planDir, "context.md"),
      "## Context\nPlan content long enough to produce a vault chunk.",
    );
    await writeFile(path.join(tmpDir, "src", "feature.ts"), "export function feature() {}");
    await writeFile(path.join(extRoot, "ext.ts"), "export function ext() {}");

    const result = await buildUnifiedIndex({
      repoRoot: tmpDir,
      vaultPaths,
      codeConfig: { roots: ["src"] },
      externalConfig: { roots: [extRoot] },
    });

    expect(result).not.toBeNull();
    assert(result !== null, "Expected result to be non-null");
    expect(result.index.items.some((item) => item.metadata.kind === "vault")).toBe(true);
    expect(result.index.items.some((item) => item.metadata.kind === "code")).toBe(true);
    expect(result.index.items.some((item) => item.metadata.kind === "external")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // chunkExternalFile — whole-file threshold tests (M10)
  // ---------------------------------------------------------------------------

  describe("chunkExternalFile whole-file threshold", () => {
    test("small .md file (under threshold) returns exactly one chunk with full text", () => {
      // ~200 chars with ## headers, well under the 16KB threshold
      const content = "## Section A\nHello\n\n## Section B\nWorld\n".repeat(5);
      const file = { path: "/skills/my-skill/SKILL.md", content, hash: "", kind: "external" as const };
      const chunks = chunkExternalFile(file);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.text).toBe(content.trim());
      expect(chunks[0]?.metadata.kind).toBe("external");
    });

    test("large .md file (over threshold) returns multiple chunks", () => {
      // ~20KB — well over the 16KB threshold
      const section = `## Section\n${  "x".repeat(1000)  }\n\n`;
      const content = section.repeat(20);
      const file = { path: "/skills/large/SKILL.md", content, hash: "", kind: "external" as const };
      const chunks = chunkExternalFile(file);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test(".ts file is unaffected by threshold and goes through TS chunker", () => {
      const content = "export function hello() { return 'world'; }\n".repeat(5);
      const file = { path: "/src/hello.ts", content, hash: "", kind: "external" as const };
      const chunks = chunkExternalFile(file);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.every((c) => c.metadata.kind === "external")).toBe(true);
    });
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { VaultPaths } from "../src/runtime/types.js";
import { loadUnifiedIndex } from "../src/runtime/unified-store.js";
import { buildUnifiedIndex } from "../src/runtime/unified-index-pipeline.js";

vi.mock("../src/runtime/vault-embeddings.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/runtime/vault-embeddings.js")
  >("../src/runtime/vault-embeddings.js");

  return {
    EmbeddingModelError: actual.EmbeddingModelError,
    embed: vi.fn(),
    embedBatch: vi.fn(),
  };
});

import { EmbeddingModelError, embedBatch } from "../src/runtime/vault-embeddings.js";

const mockedEmbedBatch = vi.mocked(embedBatch);

function makeVector(seed: number): number[] {
  const vector = new Array<number>(384).fill(0);
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
    expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);
    expect(Object.keys(result!.index.fileHashes)).toHaveLength(2);
    expect(result!.index.items.some((item) => item.metadata.kind === "vault")).toBe(true);
    expect(result!.index.items.some((item) => item.metadata.kind === "code")).toBe(true);

    const persisted = await loadUnifiedIndex(tmpDir);
    expect(persisted?.index.fileHashes).toEqual(result!.index.fileHashes);
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
    expect(second!.index.fileHashes).toEqual(first!.index.fileHashes);
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
    expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockedEmbedBatch.mock.calls[0]?.[0]).toHaveLength(1);
    expect(mockedEmbedBatch.mock.calls[0]?.[0]?.[0]).toContain("three");
    expect(
      second!.index.items.find((item) => String(item.metadata.sourcePath).endsWith("b.ts"))?.text,
    ).toContain("three");
    expect(
      second!.index.items.find((item) => String(item.metadata.sourcePath).endsWith("a.ts"))?.text,
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
    expect(mockedEmbedBatch).not.toHaveBeenCalled();
    expect(
      second!.index.items.some((item) => String(item.metadata.sourcePath).endsWith("b.ts")),
    ).toBe(false);
    expect(Object.keys(second!.index.fileHashes).some((filePath) => filePath.endsWith("b.ts"))).toBe(false);
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
    expect(Object.keys(result!.index.fileHashes)).toHaveLength(3);
    expect(result!.index.items.filter((item) => item.metadata.kind === "vault")).toHaveLength(2);
    expect(result!.index.items.filter((item) => item.metadata.kind === "code")).toHaveLength(1);
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

    // fileHashes keys should be relative
    for (const key of Object.keys(result!.index.fileHashes)) {
      expect(path.isAbsolute(key)).toBe(false);
      expect(key).not.toContain("\\");
    }

    // sourcePath metadata should be relative
    for (const item of result!.index.items) {
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
    // The single section should be split into multiple chunks
    expect(result!.index.items.length).toBeGreaterThan(1);
    // Each chunk's text should be <= 100 chars
    for (const item of result!.index.items) {
      expect(item.text.length).toBeLessThanOrEqual(100);
    }
    // All chunks should reference the same source
    const sourcePaths = new Set(result!.index.items.map((i) => String(i.metadata.sourcePath)));
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
    const codeItems = result!.index.items.filter((item) => item.metadata.kind === "code");
    const vaultItems = result!.index.items.filter((item) => item.metadata.kind === "vault");
    expect(codeItems).toHaveLength(0);
    expect(vaultItems.length).toBeGreaterThan(0);
    // fileHashes should only contain the vault file
    const keys = Object.keys(result!.index.fileHashes);
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

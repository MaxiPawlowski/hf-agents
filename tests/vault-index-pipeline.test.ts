import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { VaultContext, VaultDocument, VaultIndex, VaultPaths } from "../src/runtime/types.js";
import { buildVaultIndex, isIndexStale } from "../src/runtime/vault-index-pipeline.js";

// ---------------------------------------------------------------------------
// Mock the embedding module — avoid loading the real model
// ---------------------------------------------------------------------------
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

// Import the mocked version so we can configure per-test behaviour.
import { EmbeddingModelError, embedBatch } from "../src/runtime/vault-embeddings.js";

const mockedEmbedBatch = vi.mocked(embedBatch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal VaultDocument factory. */
function doc(id: string, content: string): VaultDocument {
  return {
    path: `vault/plans/test/${id}.md`,
    title: id,
    content,
  };
}

/** Build VaultPaths pointing at a given root. */
function vaultPaths(root: string): VaultPaths {
  return {
    vaultRoot: root,
    planDir: path.join(root, "plans"),
    sharedDir: path.join(root, "shared"),
    planFiles: [],
    sharedFiles: [],
  };
}

/** Fixed 3-dimensional vector returned by the mock embedder. */
const FIXED_VECTOR: number[] = [0.1, 0.2, 0.3];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("vault-index-pipeline", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-pipeline-"));
    // Default mock: return fixed vectors for every chunk
    mockedEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map(() => [...FIXED_VECTOR]),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // isIndexStale
  // -----------------------------------------------------------------------

  describe("isIndexStale", () => {
    test("returns false when hashes match", async () => {
      const ctx: VaultContext = {
        plan: [doc("a", "hello world")],
        shared: [],
      };

      // Build an index so we get a real hash
      const index = await buildVaultIndex(vaultPaths(tmpDir), ctx);
      expect(index).not.toBeNull();

      expect(isIndexStale(index!, ctx)).toBe(false);
    });

    test("returns true when content changes", async () => {
      const ctx: VaultContext = {
        plan: [doc("a", "hello world")],
        shared: [],
      };

      const index = await buildVaultIndex(vaultPaths(tmpDir), ctx);
      expect(index).not.toBeNull();

      const changed: VaultContext = {
        plan: [doc("a", "goodbye world")],
        shared: [],
      };

      expect(isIndexStale(index!, changed)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // buildVaultIndex — empty vault
  // -----------------------------------------------------------------------

  describe("buildVaultIndex — empty vault", () => {
    test("returns null when both plan and shared are empty", async () => {
      const ctx: VaultContext = { plan: [], shared: [] };
      const result = await buildVaultIndex(vaultPaths(tmpDir), ctx);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // buildVaultIndex — rebuild
  // -----------------------------------------------------------------------

  describe("buildVaultIndex — rebuild", () => {
    test("chunks, embeds, creates, and persists a new index", async () => {
      const ctx: VaultContext = {
        plan: [doc("a", "## Section A\nSome content about section A that is long enough")],
        shared: [doc("b", "## Section B\nSome content about section B that is long enough")],
      };

      const index = await buildVaultIndex(vaultPaths(tmpDir), ctx);

      expect(index).not.toBeNull();
      expect(index!.entries.length).toBeGreaterThan(0);
      expect(index!.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(index!.timestamp).toBeTruthy();

      // Verify embedBatch was called
      expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);

      // Verify the index was persisted
      const indexPath = path.join(tmpDir, ".vault-index.json");
      const raw = await fs.readFile(indexPath, "utf8");
      const loaded = JSON.parse(raw) as VaultIndex;
      expect(loaded.contentHash).toBe(index!.contentHash);
    });
  });

  // -----------------------------------------------------------------------
  // buildVaultIndex — skip rebuild when hashes match
  // -----------------------------------------------------------------------

  describe("buildVaultIndex — skip rebuild", () => {
    test("does not call embedBatch when existing index hash matches", async () => {
      const ctx: VaultContext = {
        plan: [doc("a", "## Section A\nContent for section A is long enough to pass")],
        shared: [],
      };

      // First call: build the index
      const first = await buildVaultIndex(vaultPaths(tmpDir), ctx);
      expect(first).not.toBeNull();
      expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);

      // Reset the mock call count
      mockedEmbedBatch.mockClear();

      // Second call: same context → should skip embed
      const second = await buildVaultIndex(vaultPaths(tmpDir), ctx);
      expect(second).not.toBeNull();
      expect(second!.contentHash).toBe(first!.contentHash);

      // embedBatch must NOT have been called again
      expect(mockedEmbedBatch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // buildVaultIndex — embedding failure
  // -----------------------------------------------------------------------

  describe("buildVaultIndex — embedding failure", () => {
    test("returns null when embedBatch throws EmbeddingModelError", async () => {
      mockedEmbedBatch.mockRejectedValueOnce(
        new EmbeddingModelError("mock model load failure"),
      );

      const ctx: VaultContext = {
        plan: [doc("a", "## Section A\nContent for section A is long enough to pass")],
        shared: [],
      };

      // Spy on console.error to verify logging
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await buildVaultIndex(vaultPaths(tmpDir), ctx);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Embedding failed"),
      );

      consoleSpy.mockRestore();
    });

    test("re-throws non-EmbeddingModelError errors", async () => {
      mockedEmbedBatch.mockRejectedValueOnce(new Error("unexpected boom"));

      const ctx: VaultContext = {
        plan: [doc("a", "## Section A\nContent for section A is long enough to pass")],
        shared: [],
      };

      await expect(buildVaultIndex(vaultPaths(tmpDir), ctx)).rejects.toThrow(
        "unexpected boom",
      );
    });
  });

  // -----------------------------------------------------------------------
  // buildVaultIndex — rebuild after content change
  // -----------------------------------------------------------------------

  describe("buildVaultIndex — rebuild after change", () => {
    test("rebuilds index when content changes between calls", async () => {
      const ctx1: VaultContext = {
        plan: [doc("a", "## Section A\nVersion one content is long enough to pass")],
        shared: [],
      };

      const first = await buildVaultIndex(vaultPaths(tmpDir), ctx1);
      expect(first).not.toBeNull();
      expect(mockedEmbedBatch).toHaveBeenCalledTimes(1);

      const ctx2: VaultContext = {
        plan: [doc("a", "## Section A\nVersion two content is long enough to pass")],
        shared: [],
      };

      const second = await buildVaultIndex(vaultPaths(tmpDir), ctx2);
      expect(second).not.toBeNull();
      expect(second!.contentHash).not.toBe(first!.contentHash);

      // embedBatch called a second time for the rebuild
      expect(mockedEmbedBatch).toHaveBeenCalledTimes(2);
    });
  });
});

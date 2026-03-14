import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { VaultChunk } from "../src/runtime/types.js";
import { createIndex, loadIndex, query, saveIndex } from "../src/runtime/vault-store.js";

function chunk(id: string, text: string, sectionTitle = "Section"): VaultChunk {
  return {
    id,
    text,
    metadata: {
      sourcePath: `vault/plans/test/${id}.md`,
      sectionTitle,
      documentTitle: "Test Doc",
    },
  };
}

describe("vault-store", () => {
  describe("createIndex", () => {
    test("entries are populated correctly from chunks and embeddings", () => {
      const chunks: VaultChunk[] = [
        chunk("a", "Alpha content"),
        chunk("b", "Beta content"),
      ];
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
      ];

      const index = createIndex(chunks, embeddings);

      expect(index.entries).toHaveLength(2);
      expect(index.entries[0]!.id).toBe("a");
      expect(index.entries[0]!.text).toBe("Alpha content");
      expect(index.entries[0]!.metadata.sectionTitle).toBe("Section");
      expect(index.entries[1]!.id).toBe("b");
      expect(index.entries[1]!.text).toBe("Beta content");
    });

    test("vectors are pre-normalized at index time", () => {
      const chunks = [chunk("a", "text")];
      const embeddings = [[3, 4]]; // magnitude = 5

      const index = createIndex(chunks, embeddings);

      const vec = index.entries[0]!.vector;
      expect(vec[0]).toBeCloseTo(0.6, 10);
      expect(vec[1]).toBeCloseTo(0.8, 10);

      // Verify unit length
      const mag = Math.sqrt(vec[0]! * vec[0]! + vec[1]! * vec[1]!);
      expect(mag).toBeCloseTo(1.0, 10);
    });

    test("contentHash and timestamp are set", () => {
      const chunks = [chunk("a", "some text")];
      const index = createIndex(chunks, [[1, 0]]);

      expect(index.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(index.timestamp).toBeTruthy();
      // Timestamp should be a valid ISO string
      expect(() => new Date(index.timestamp)).not.toThrow();
    });

    test("content hash changes when chunk content changes", () => {
      const chunks1 = [chunk("a", "version one")];
      const chunks2 = [chunk("a", "version two")];

      const index1 = createIndex(chunks1, [[1, 0]]);
      const index2 = createIndex(chunks2, [[1, 0]]);

      expect(index1.contentHash).not.toBe(index2.contentHash);
    });

    test("content hash is stable for same content", () => {
      const chunks = [chunk("a", "stable content")];

      const index1 = createIndex(chunks, [[1, 0]]);
      const index2 = createIndex(chunks, [[1, 0]]);

      expect(index1.contentHash).toBe(index2.contentHash);
    });
  });

  describe("query", () => {
    test("returns correct top-K ordering (highest similarity first)", () => {
      const chunks = [
        chunk("low", "low similarity"),
        chunk("mid", "mid similarity"),
        chunk("high", "high similarity"),
      ];
      const embeddings = [
        [1, 0, 0], // low: orthogonal to query → score ≈ 0
        [1, 1, 1], // mid: partially aligned → score ≈ 0.577
        [0, 0, 1], // high: aligned with query → score = 1
      ];

      const index = createIndex(chunks, embeddings);
      // Query aligned with z-axis
      const results = query(index, [0, 0, 1], 2);

      expect(results).toHaveLength(2);
      expect(results[0]!.text).toBe("high similarity");
      expect(results[1]!.text).toBe("mid similarity");
    });

    test("cosine similarity math is correct with known vectors", () => {
      // Two 2D vectors: [1,0] and [1,1] → cosine = 1/√2 ≈ 0.7071
      const chunks = [chunk("a", "target")];
      const embeddings = [[1, 0]];

      const index = createIndex(chunks, embeddings);
      const results = query(index, [1, 1], 1);

      expect(results[0]!.score).toBeCloseTo(1 / Math.sqrt(2), 10);
    });

    test("identical vectors yield score of 1.0", () => {
      const chunks = [chunk("a", "match")];
      const embeddings = [[3, 4]];

      const index = createIndex(chunks, embeddings);
      const results = query(index, [3, 4], 1);

      expect(results[0]!.score).toBeCloseTo(1.0, 10);
    });

    test("orthogonal vectors yield score of 0.0", () => {
      const chunks = [chunk("a", "ortho")];
      const embeddings = [[1, 0]];

      const index = createIndex(chunks, embeddings);
      const results = query(index, [0, 1], 1);

      expect(results[0]!.score).toBeCloseTo(0.0, 10);
    });

    test("topK limits the number of results", () => {
      const chunks = [
        chunk("a", "one"),
        chunk("b", "two"),
        chunk("c", "three"),
      ];
      const embeddings = [[1, 0], [0, 1], [1, 1]];

      const index = createIndex(chunks, embeddings);
      const results = query(index, [1, 1], 1);

      expect(results).toHaveLength(1);
    });

    test("results include metadata", () => {
      const chunks = [chunk("a", "text", "My Section")];
      const embeddings = [[1, 0]];

      const index = createIndex(chunks, embeddings);
      const results = query(index, [1, 0], 1);

      expect(results[0]!.metadata.sectionTitle).toBe("My Section");
      expect(results[0]!.metadata.documentTitle).toBe("Test Doc");
    });
  });

  describe("loadIndex", () => {
    test("returns null for missing file", async () => {
      const result = await loadIndex("/nonexistent/path/index.json");
      expect(result).toBeNull();
    });
  });

  describe("saveIndex and loadIndex round-trip", () => {
    test("save and load round-trip preserves index data", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-store-test-"));
      const indexPath = path.join(tmpDir, "subdir", ".vault-index.json");

      try {
        const chunks = [
          chunk("a", "Alpha content", "Alpha"),
          chunk("b", "Beta content", "Beta"),
        ];
        const embeddings = [[1, 0, 0], [0, 1, 0]];

        const original = createIndex(chunks, embeddings);
        await saveIndex(indexPath, original);
        const loaded = await loadIndex(indexPath);

        expect(loaded).not.toBeNull();
        expect(loaded!.contentHash).toBe(original.contentHash);
        expect(loaded!.timestamp).toBe(original.timestamp);
        expect(loaded!.entries).toHaveLength(2);
        expect(loaded!.entries[0]!.id).toBe("a");
        expect(loaded!.entries[0]!.text).toBe("Alpha content");
        expect(loaded!.entries[0]!.metadata.sectionTitle).toBe("Alpha");

        // Vectors survive round-trip
        expect(loaded!.entries[0]!.vector).toEqual(original.entries[0]!.vector);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

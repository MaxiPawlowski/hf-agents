import { describe, expect, test } from "vitest";

import { embed, embedBatch } from "../src/runtime/vault-embeddings.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function vectorNorm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

describe("vault-embeddings", () => {
  test("embed returns a 384-dim float array with unit norm", async () => {
    const vec = await embed("The quick brown fox jumps over the lazy dog.");

    expect(vec).toHaveLength(384);
    expect(vec.every((v) => typeof v === "number" && isFinite(v))).toBe(true);

    const norm = vectorNorm(vec);
    expect(norm).toBeCloseTo(1.0, 2);
  }, 60_000);

  test("semantically similar strings have higher cosine similarity than dissimilar ones", async () => {
    const [vecA, vecB, vecC] = await Promise.all([
      embed("The cat sat on the mat."),
      embed("A kitten rested on the rug."),
      embed("Quantum physics explores subatomic particles."),
    ]);

    const simAB = cosine(vecA, vecB);
    const simAC = cosine(vecA, vecC);

    expect(simAB).toBeGreaterThan(simAC);
    // Similar sentences should have reasonably high similarity
    expect(simAB).toBeGreaterThan(0.5);
    // Dissimilar sentences should have lower similarity
    expect(simAC).toBeLessThan(simAB);
  }, 60_000);

  test("embedBatch produces correct results for multiple texts", async () => {
    const texts = [
      "Hello world",
      "Goodbye world",
      "Machine learning is fascinating",
    ];

    const batchResults = await embedBatch(texts);

    expect(batchResults).toHaveLength(3);

    for (const vec of batchResults) {
      expect(vec).toHaveLength(384);
      const norm = vectorNorm(vec);
      expect(norm).toBeCloseTo(1.0, 2);
    }

    // Verify batch results match individual embeddings
    const individual = await Promise.all(texts.map((t) => embed(t)));

    for (let i = 0; i < texts.length; i++) {
      const sim = cosine(batchResults[i]!, individual[i]!);
      // Batch and individual should produce very similar (nearly identical) results
      expect(sim).toBeGreaterThan(0.99);
    }
  }, 60_000);

  test("embedBatch with empty array returns empty array", async () => {
    const result = await embedBatch([]);
    expect(result).toEqual([]);
  });
});

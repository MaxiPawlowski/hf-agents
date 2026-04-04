import { describe, expect, test } from "vitest";

import { embed, embedBatch, disposeEmbeddingModel, EmbeddingModelError } from "../src/runtime/vault-embeddings.js";
import { isNumber } from "../src/runtime/utils.js";

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

describe("vault-embeddings (pure unit)", () => {
  test("EmbeddingModelError has correct name and cause", () => {
    const cause = new Error("network timeout");
    const err = new EmbeddingModelError("load failed", cause);
    expect(err.name).toBe("EmbeddingModelError");
    expect(err.message).toBe("load failed");
    expect(err.cause).toBe(cause);
  });

  test("embedBatch with empty array returns empty array", async () => {
    const result = await embedBatch([]);
    expect(result).toEqual([]);
  });

  test("disposeEmbeddingModel is safe to call when model was never loaded", async () => {
    await expect(disposeEmbeddingModel()).resolves.not.toThrow();
  });
});

describe.skipIf(!process.env.HF_RUN_SLOW)("vault-embeddings (model integration)", () => {
  test("embed returns a 384-dim float array with unit norm", async () => {
    const vec = await embed("The quick brown fox jumps over the lazy dog.");

    expect(vec).toHaveLength(384);
    expect(vec.every((v) => isNumber(v) && isFinite(v))).toBe(true);

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
    expect(simAB).toBeGreaterThan(0.5);
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

    const individual = await Promise.all(texts.map((t) => embed(t)));

    for (let i = 0; i < texts.length; i++) {
      const sim = cosine(batchResults[i]!, individual[i]!);
      expect(sim).toBeGreaterThan(0.99);
    }
  }, 60_000);

  test("disposeEmbeddingModel clears the loaded model", async () => {
    await embed("warmup");
    await disposeEmbeddingModel();
    const vec = await embed("after dispose");
    expect(vec).toHaveLength(384);
  }, 120_000);
});

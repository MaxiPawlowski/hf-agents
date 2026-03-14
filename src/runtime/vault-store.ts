import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { VaultChunk, VaultIndex, VaultSearchResult } from "./types.js";

/**
 * Normalize a vector to unit length (L2 norm).
 * Returns a zero vector unchanged to avoid division by zero.
 */
function normalize(vector: number[]): number[] {
  let sumSq = 0;
  for (const v of vector) {
    sumSq += v * v;
  }
  const mag = Math.sqrt(sumSq);
  if (mag === 0) {
    return vector;
  }
  return vector.map((v) => v / mag);
}

/**
 * Compute dot product of two vectors of equal length.
 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

/**
 * Compute a SHA-256 content hash from concatenated chunk texts.
 */
function computeContentHash(chunks: VaultChunk[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk.text);
  }
  return hash.digest("hex");
}

/**
 * Create a VaultIndex from chunks and their corresponding embedding vectors.
 * Vectors are pre-normalized at index time so query-time similarity is a single dot product.
 */
export function createIndex(chunks: VaultChunk[], embeddings: number[][]): VaultIndex {
  const entries = chunks.map((chunk, i) => ({
    id: chunk.id,
    vector: normalize(embeddings[i] ?? []),
    text: chunk.text,
    metadata: chunk.metadata,
  }));

  return {
    entries,
    contentHash: computeContentHash(chunks),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Load a VaultIndex from a JSON file.
 * Returns null if the file does not exist (ENOENT).
 */
export async function loadIndex(indexPath: string): Promise<VaultIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    return JSON.parse(raw) as VaultIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Save a VaultIndex to a JSON file, creating parent directories if needed.
 */
export async function saveIndex(indexPath: string, index: VaultIndex): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/**
 * Query the index for the top-K most similar entries to the given query vector.
 * The query vector is normalized before comparison; index vectors are already normalized.
 * Similarity is computed via dot product on unit vectors (equivalent to cosine similarity).
 */
export function query(index: VaultIndex, queryVector: number[], topK: number): VaultSearchResult[] {
  const normalizedQuery = normalize(queryVector);

  const scored = index.entries.map((entry) => ({
    score: dotProduct(entry.vector, normalizedQuery),
    text: entry.text,
    metadata: entry.metadata,
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

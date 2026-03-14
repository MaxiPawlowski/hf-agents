import { createHash } from "node:crypto";
import path from "node:path";

import type { VaultContext, VaultDocument, VaultIndex, VaultPaths } from "./types.js";
import { chunkVaultDocument } from "./vault-chunker.js";
import { EmbeddingModelError, embedBatch } from "./vault-embeddings.js";
import { createIndex, loadIndex, saveIndex } from "./vault-store.js";

const INDEX_FILENAME = ".vault-index.json";

/**
 * Compute a stable SHA-256 content hash from raw vault document texts.
 * Documents are sorted by path to ensure deterministic ordering.
 */
function computeVaultContentHash(documents: VaultDocument[]): string {
  const sorted = [...documents].sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash("sha256");
  for (const doc of sorted) {
    hash.update(doc.content);
  }
  return hash.digest("hex");
}

/**
 * Gather all vault documents from a VaultContext (plan + shared).
 */
function allDocuments(vaultContext: VaultContext): VaultDocument[] {
  return [...vaultContext.plan, ...vaultContext.shared];
}

/**
 * Check whether a persisted VaultIndex is stale relative to current vault content.
 *
 * @returns `true` when the index should be rebuilt (hashes differ),
 *          `false` when the index is up-to-date.
 */
export function isIndexStale(index: VaultIndex, vaultContext: VaultContext): boolean {
  const currentHash = computeVaultContentHash(allDocuments(vaultContext));
  return currentHash !== index.contentHash;
}

/**
 * Build (or reuse) a VaultIndex for the given vault paths and context.
 *
 * Lifecycle:
 * 1. Return `null` immediately when the vault context is empty.
 * 2. Try to load a previously-persisted index; if its contentHash matches the
 *    current vault content, return it without re-embedding.
 * 3. Otherwise chunk every document, batch-embed the chunks, build a new index,
 *    override its contentHash with the vault-level hash, persist it, and return it.
 * 4. If embedding fails with `EmbeddingModelError`, log the error and return `null`.
 */
export async function buildVaultIndex(
  vaultPaths: VaultPaths,
  vaultContext: VaultContext,
): Promise<VaultIndex | null> {
  const documents = allDocuments(vaultContext);

  // 1 — empty vault
  if (documents.length === 0) {
    return null;
  }

  const indexPath = path.join(vaultPaths.vaultRoot, INDEX_FILENAME);
  const currentHash = computeVaultContentHash(documents);

  // 2 — try cached index
  const existing = await loadIndex(indexPath);
  if (existing && existing.contentHash === currentHash) {
    return existing;
  }

  // 3 — rebuild
  try {
    const chunks = documents.flatMap((doc) => chunkVaultDocument(doc));
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await embedBatch(chunkTexts);

    const index = createIndex(chunks, embeddings);

    // Override with the vault-level content hash so staleness detection is
    // based on raw document content rather than chunk texts.
    index.contentHash = currentHash;

    await saveIndex(indexPath, index);
    return index;
  } catch (error: unknown) {
    if (error instanceof EmbeddingModelError) {
      console.error(
        `[vault-index-pipeline] Embedding failed, skipping index build: ${error.message}`,
      );
      return null;
    }
    throw error;
  }
}

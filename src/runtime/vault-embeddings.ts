import { pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

import { tryIpcEmbed, tryIpcEmbedBatch } from "./embedding-ipc-client.js";
import { hfLogTimed } from "./logger.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
const MODEL_LOAD_TIMEOUT_MS = 60_000;

export class EmbeddingModelError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingModelError";
  }
}

let extractor: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;
let embeddingIpcRoot: string | null = null;

export function setEmbeddingIpcRoot(repoRoot: string | null): void {
  embeddingIpcRoot = repoRoot;
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const done = hfLogTimed({ tag: "embedding-model", msg: "loadExtractor", data: { model: MODEL_ID } });
    try {
      const loadPromise = pipeline("feature-extraction", MODEL_ID, {
        dtype: "fp32",
      });
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new EmbeddingModelError(`Embedding model load timed out after ${MODEL_LOAD_TIMEOUT_MS}ms`)),
          MODEL_LOAD_TIMEOUT_MS,
        );
      });
      const ext = await Promise.race([loadPromise, timeout]).finally(() => clearTimeout(timer!));
      extractor = ext;
      done({ status: "loaded" });
      return ext;
    } catch (err: unknown) {
      loadingPromise = null;
      done({ status: "failed" });
      if (err instanceof EmbeddingModelError) throw err;
      throw new EmbeddingModelError(
        `Failed to load embedding model "${MODEL_ID}"`,
        err,
      );
    }
  })();

  return loadingPromise;
}

/**
 * Start loading the embedding model in the background.
 * Call early (e.g. during hydrate) so the model is warm
 * by the time embedBatch() is actually needed.
 * Safe to call multiple times — deduplicates via loadingPromise.
 */
export function warmupEmbeddingModel(): void {
  getExtractor().catch(() => {
    // Swallowed — callers that actually need embeddings
    // will get the real error from embed/embedBatch.
  });
}

/**
 * Release the loaded embedding model and free its resources.
 * Safe to call even if the model was never loaded.
 */
export async function disposeEmbeddingModel(): Promise<void> {
  const ext = extractor;
  extractor = null;
  loadingPromise = null;
  if (ext) {
    try {
      await ext.dispose();
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Embed a single text string into a 384-dimensional normalized vector.
 */
export async function embed(text: string): Promise<number[]> {
  if (extractor) {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM);
  }

  if (embeddingIpcRoot) {
    const ipcEmbedding = await tryIpcEmbed(embeddingIpcRoot, text);
    if (ipcEmbedding) return ipcEmbedding;
  }

  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean", normalize: true });
  const vec = Array.from(output.data as Float32Array).slice(0, EMBEDDING_DIM);
  return vec;
}

/**
 * Embed multiple text strings into 384-dimensional normalized vectors.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (extractor) {
    const done = hfLogTimed({ tag: "embedding-model", msg: "embedBatch", data: { text_count: texts.length } });
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    done({ text_count: texts.length });
    const flat = Array.from(output.data as Float32Array);

    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * EMBEDDING_DIM;
      results.push(flat.slice(start, start + EMBEDDING_DIM));
    }
    return results;
  }

  if (embeddingIpcRoot) {
    const ipcEmbeddings = await tryIpcEmbedBatch(embeddingIpcRoot, texts);
    if (ipcEmbeddings) return ipcEmbeddings;
  }

  const ext = await getExtractor();
  const done = hfLogTimed({ tag: "embedding-model", msg: "embedBatch", data: { text_count: texts.length } });
  const output = await ext(texts, { pooling: "mean", normalize: true });
  done({ text_count: texts.length });
  const flat = Array.from(output.data as Float32Array);

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM;
    results.push(flat.slice(start, start + EMBEDDING_DIM));
  }
  return results;
}

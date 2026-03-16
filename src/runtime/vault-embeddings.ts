import { pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

export class EmbeddingModelError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingModelError";
  }
}

let extractor: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const ext = await pipeline("feature-extraction", MODEL_ID, {
        dtype: "fp32",
      });
      extractor = ext;
      return ext;
    } catch (err: unknown) {
      loadingPromise = null;
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
 * Embed a single text string into a 384-dimensional normalized vector.
 */
export async function embed(text: string): Promise<number[]> {
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

  const ext = await getExtractor();
  const output = await ext(texts, { pooling: "mean", normalize: true });
  const flat = Array.from(output.data as Float32Array);

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM;
    results.push(flat.slice(start, start + EMBEDDING_DIM));
  }
  return results;
}

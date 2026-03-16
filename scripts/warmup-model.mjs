#!/usr/bin/env node

/**
 * Pre-download and cache the embedding model so the first runtime call
 * doesn't trigger a ~23MB download inside a latency-sensitive hook.
 *
 * Run automatically via postinstall, or manually:
 *   node scripts/warmup-model.mjs
 */

import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const TIMEOUT_MS = 120_000; // 2 minutes for first download

async function warmup() {
  const start = Date.now();
  console.log(`[warmup-model] Downloading and caching ${MODEL_ID}...`);

  const timer = setTimeout(() => {
    console.error(
      `[warmup-model] Timed out after ${TIMEOUT_MS / 1000}s. The model will be downloaded on first use instead.`,
    );
    process.exit(0); // non-fatal — runtime will retry
  }, TIMEOUT_MS);

  try {
    await pipeline("feature-extraction", MODEL_ID, { dtype: "fp32" });
    clearTimeout(timer);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[warmup-model] Model cached successfully (${elapsed}s).`);
  } catch (error) {
    clearTimeout(timer);
    // Non-fatal — the runtime handles missing models gracefully via brute-force fallback
    console.error(
      `[warmup-model] Failed to cache model (non-fatal): ${error.message}`,
    );
  }
}

warmup();

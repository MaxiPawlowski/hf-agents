import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// File-level locking for the shared .hf/ index store
// ---------------------------------------------------------------------------

const LOCK_FILE = "index.lock";
/** Total time (ms) we are willing to wait for the lock before giving up. */
const LOCK_TIMEOUT_MS = 1500;
/** Interval (ms) between successive acquisition attempts. */
const LOCK_RETRY_INTERVAL_MS = 50;

/**
 * Try to create the lock file exclusively.
 * Returns the file descriptor on success, null if the file already exists.
 * Propagates all other errors.
 */
async function tryCreateLock(lockPath: string): Promise<fs.FileHandle | null> {
  try {
    const handle = await fs.open(lockPath, "wx");
    return handle;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    throw err;
  }
}

/**
 * Acquire the lock at `lockPath` with retry and exponential-ish backoff.
 * Returns the FileHandle on success, or null when the timeout expires
 * (indicating the caller should skip its write).
 */
async function acquireLock(lockPath: string): Promise<fs.FileHandle | null> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let interval = LOCK_RETRY_INTERVAL_MS;

  while (true) {
    const handle = await tryCreateLock(lockPath);
    if (handle !== null) {
      // Write PID + timestamp for debuggability, ignore write errors.
      await handle
        .writeFile(`${JSON.stringify({ pid: process.pid, ts: new Date().toISOString() })}\n`, "utf8")
        .catch(() => undefined);
      return handle;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return null;
    }

    // Wait the smaller of the retry interval and the remaining budget.
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
    // Mild back-off, capped so we don't stall too long on the last attempt.
    interval = Math.min(interval * 1.5, 200);
  }
}

/**
 * Release the lock: close and unlink the file.
 * Errors are swallowed — a leftover stale lock will be overwritten by the next
 * writer after the timeout, or cleaned up on the next successful save.
 */
async function releaseLock(handle: fs.FileHandle, lockPath: string): Promise<void> {
  await handle.close().catch(() => undefined);
  await fs.unlink(lockPath).catch(() => undefined);
}

export type MetadataValue = string | number | boolean;

/**
 * Normalize a vector to unit length (L2 norm).
 * Returns a zero vector unchanged to avoid division by zero.
 */
export function normalize(vector: number[]): number[] {
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
export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

export interface IndexItem {
  id: string;
  text: string;
  metadata: Record<string, MetadataValue>;
}

export interface UnifiedIndex {
  version: 2;
  embeddingDim: 384;
  items: IndexItem[];
  fileHashes: Record<string, string>;
  timestamp: string;
}

export interface QueryItemResult {
  id: string;
  text: string;
  metadata: Record<string, MetadataValue>;
  score: number;
}

const INDEX_DIR = ".hf";
const INDEX_JSON = "index.json";
const INDEX_BIN = "index.bin";
const INDEX_VERSION = 2;
const EMBEDDING_DIM = 384;

function getIndexPaths(basePath: string): { jsonPath: string; binPath: string } {
  const storePath = path.join(basePath, INDEX_DIR);
  return {
    jsonPath: path.join(storePath, INDEX_JSON),
    binPath: path.join(storePath, INDEX_BIN),
  };
}

function cloneWithNormalizedVector(vectors: Float32Array, itemCount: number): Float32Array {
  const next = new Float32Array(itemCount * EMBEDDING_DIM);
  next.set(vectors);
  return next;
}

function writeVector(target: Float32Array, index: number, vector: number[]): void {
  const normalized = normalize(vector);
  const offset = index * EMBEDDING_DIM;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    target[offset + i] = normalized[i] ?? 0;
  }
}

function readVector(vectors: Float32Array, index: number): number[] {
  const offset = index * EMBEDDING_DIM;
  return Array.from(vectors.slice(offset, offset + EMBEDDING_DIM));
}

function isUnifiedIndex(value: unknown): value is UnifiedIndex {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<UnifiedIndex>;
  return (
    candidate.version === INDEX_VERSION &&
    candidate.embeddingDim === EMBEDDING_DIM &&
    Array.isArray(candidate.items) &&
    candidate.fileHashes !== null &&
    typeof candidate.fileHashes === "object" &&
    typeof candidate.timestamp === "string"
  );
}

export async function loadUnifiedIndex(
  basePath: string,
): Promise<{ index: UnifiedIndex; vectors: Float32Array } | null> {
  const { jsonPath, binPath } = getIndexPaths(basePath);

  try {
    const [rawIndex, rawVectors] = await Promise.all([
      fs.readFile(jsonPath, "utf8"),
      fs.readFile(binPath),
    ]);
    const parsed = JSON.parse(rawIndex) as unknown;

    if (!isUnifiedIndex(parsed)) {
      return null;
    }

    if (rawVectors.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      return null;
    }

    const vectors = new Float32Array(
      rawVectors.buffer,
      rawVectors.byteOffset,
      rawVectors.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );

    if (vectors.length !== parsed.items.length * parsed.embeddingDim) {
      return null;
    }

    return {
      index: parsed,
      vectors: Float32Array.from(vectors),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      console.error(
        `[unified-store] Corrupted index file, rebuilding from scratch: ${jsonPath}`,
      );
      return null;
    }
    throw error;
  }
}

export async function saveUnifiedIndex(
  basePath: string,
  index: UnifiedIndex,
  vectors: Float32Array,
): Promise<void> {
  const { jsonPath, binPath } = getIndexPaths(basePath);
  const storeDir = path.dirname(jsonPath);
  await fs.mkdir(storeDir, { recursive: true });

  const lockPath = path.join(storeDir, LOCK_FILE);
  const lockHandle = await acquireLock(lockPath);

  if (lockHandle === null) {
    // Another concurrent writer holds the lock. The index is a content-
    // addressable cache, so skipping this save is safe — it will be rebuilt
    // on the next invocation.
    console.warn(
      `[unified-store] Could not acquire index lock within ${LOCK_TIMEOUT_MS}ms — skipping save (index will be rebuilt next run).`,
    );
    return;
  }

  try {
    const tmpJson = `${jsonPath}.tmp`;
    const tmpBin = `${binPath}.tmp`;
    // Write to temp files first, then rename atomically to prevent corruption
    // if the process crashes mid-write.
    await Promise.all([
      fs.writeFile(tmpJson, `${JSON.stringify(index, null, 2)}\n`, "utf8"),
      fs.writeFile(tmpBin, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength)),
    ]);
    await fs.rename(tmpJson, jsonPath);
    await fs.rename(tmpBin, binPath);
  } finally {
    await releaseLock(lockHandle, lockPath);
  }
}

/**
 * Insert a new item. Mutates `index.items` in-place for performance and
 * returns the same index reference with a new vectors array.
 * Throws if an item with the same ID already exists.
 */
// oxlint-disable max-params -- index, vectors, item, vector are all required for the insert operation; no natural grouping
export function insertItem(
  index: UnifiedIndex,
  vectors: Float32Array,
  item: IndexItem,
  vector: number[],
): { index: UnifiedIndex; vectors: Float32Array } {
// oxlint-enable max-params
  if (index.items.some((entry) => entry.id === item.id)) {
    throw new Error(`Item already exists: ${item.id}`);
  }

  index.items.push(item);
  const nextVectors = cloneWithNormalizedVector(vectors, index.items.length);
  writeVector(nextVectors, index.items.length - 1, vector);
  return { index, vectors: nextVectors };
}

/**
 * Insert or update an item. Mutates `index.items` in-place for performance
 * and returns the same index reference with a new vectors array.
 */
// oxlint-disable max-params -- index, vectors, item, vector are all required for the upsert operation; no natural grouping
export function upsertItem(
  index: UnifiedIndex,
  vectors: Float32Array,
  item: IndexItem,
  vector: number[],
): { index: UnifiedIndex; vectors: Float32Array } {
// oxlint-enable max-params
  const existingIndex = index.items.findIndex((entry) => entry.id === item.id);
  if (existingIndex === -1) {
    return insertItem(index, vectors, item, vector);
  }

  index.items[existingIndex] = item;
  const nextVectors = Float32Array.from(vectors);
  writeVector(nextVectors, existingIndex, vector);
  return { index, vectors: nextVectors };
}

export interface BatchEntry {
  item: IndexItem;
  vector: number[];
}

/**
 * Batch upsert: pre-allocates a single Float32Array for all items,
 * copies existing vectors once, then writes all new/updated vectors in one pass.
 * Mutates `index.items` in-place for performance and returns the same index
 * reference with a new vectors array.
 */
export function batchUpsertItems(
  index: UnifiedIndex,
  vectors: Float32Array,
  entries: BatchEntry[],
): { index: UnifiedIndex; vectors: Float32Array } {
  if (entries.length === 0) {
    return { index, vectors };
  }

  // Build a map of existing item positions
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < index.items.length; i++) {
    idToIndex.set(index.items[i]!.id, i);
  }

  // Count truly new items
  let newCount = 0;
  for (const entry of entries) {
    if (!idToIndex.has(entry.item.id)) {
      newCount++;
    }
  }

  const finalCount = index.items.length + newCount;
  const nextVectors = new Float32Array(finalCount * EMBEDDING_DIM);
  // Copy existing vectors once
  nextVectors.set(vectors);

  // Build a new items array so the original is untouched until we succeed.
  const nextItems = [...index.items];
  let appendIndex = nextItems.length;

  for (const entry of entries) {
    const existingIdx = idToIndex.get(entry.item.id);
    if (existingIdx !== undefined) {
      nextItems[existingIdx] = entry.item;
      writeVector(nextVectors, existingIdx, entry.vector);
    } else {
      nextItems.push(entry.item);
      writeVector(nextVectors, appendIndex, entry.vector);
      idToIndex.set(entry.item.id, appendIndex);
      appendIndex++;
    }
  }

  // Commit atomically
  index.items = nextItems;
  return { index, vectors: nextVectors };
}

/**
 * Remove items by ID. Mutates `index.items` in-place for performance
 * and returns the same index reference with a new compacted vectors array.
 */
export function deleteItems(
  index: UnifiedIndex,
  vectors: Float32Array,
  ids: string[],
): { index: UnifiedIndex; vectors: Float32Array } {
  if (ids.length === 0) {
    return { index, vectors };
  }

  const idSet = new Set(ids);
  const nextItems: IndexItem[] = [];
  const keptVectors: number[] = [];

  for (let i = 0; i < index.items.length; i++) {
    const item = index.items[i]!;
    if (idSet.has(item.id)) {
      continue;
    }

    nextItems.push(item);
    keptVectors.push(...readVector(vectors, i));
  }

  index.items = nextItems;
  return {
    index,
    vectors: Float32Array.from(keptVectors),
  };
}

function matchesSourceFilter(kind: string, sourceFilter: string): boolean {
  if (sourceFilter === "code") return kind === "code" || kind === "external";
  return kind === sourceFilter;
}

// oxlint-disable max-params -- index, vectors, queryVector, topK, sourceFilter are all required for query; no natural grouping
export function queryItems(
  index: UnifiedIndex,
  vectors: Float32Array,
  queryVector: number[],
  topK: number,
  sourceFilter?: string,
): QueryItemResult[] {
// oxlint-enable max-params
  const normalizedQuery = normalize(queryVector);
  const scored: QueryItemResult[] = [];

  for (let i = 0; i < index.items.length; i++) {
    const item = index.items[i]!;
    if (sourceFilter && !matchesSourceFilter(String(item.metadata.kind ?? ""), sourceFilter)) continue;
    scored.push({
      id: item.id,
      text: item.text,
      metadata: item.metadata,
      score: dotProduct(readVector(vectors, i), normalizedQuery),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { IndexItem, UnifiedIndex } from "../src/runtime/unified-store.js";
import {
  batchUpsertItems,
  deleteItems,
  insertItem,
  loadUnifiedIndex,
  queryItems,
  saveUnifiedIndex,
  upsertItem,
} from "../src/runtime/unified-store.js";

function makeVector(values: number[]): number[] {
  const vector = Array.from({ length: 384 }, () => 0);
  for (let i = 0; i < values.length; i++) {
    vector[i] = values[i] ?? 0;
  }
  return vector;
}

function makeIndex(items: IndexItem[] = []): UnifiedIndex {
  return {
    version: 2,
    embeddingDim: 384,
    items,
    fileHashes: {},
    timestamp: new Date().toISOString(),
  };
}

function makeItem(id: string, metadata: Record<string, string | number | boolean> = {}): IndexItem {
  return {
    id,
    text: `${id} text`,
    metadata,
  };
}

describe("unified-store", () => {
  test("save and load round-trip preserves JSON and binary vectors", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-roundtrip-"));

    try {
      const index = makeIndex([
        makeItem("a", { kind: "vault", rank: 1 }),
        makeItem("b", { kind: "code", rank: 2 }),
      ]);
      index.fileHashes["src/a.ts"] = "hash-a";
      const vectors = new Float32Array(384 * 2);
      vectors.set(makeVector([1, 2, 3]), 0);
      vectors.set(makeVector([4, 5, 6]), 384);

      await saveUnifiedIndex(tmpDir, index, vectors);
      const loaded = await loadUnifiedIndex(tmpDir);

      expect(loaded).not.toBeNull();
      expect(loaded!.index).toEqual(index);
      expect(Array.from(loaded!.vectors.slice(0, 6))).toEqual(Array.from(vectors.slice(0, 6)));
      expect(Array.from(loaded!.vectors.slice(384, 390))).toEqual(
        Array.from(vectors.slice(384, 390)),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("insertItem appends item and stores a normalized vector", () => {
    const index = makeIndex();
    const result = insertItem(index, new Float32Array(), makeItem("a", { kind: "code" }), makeVector([3, 4]));

    expect(result.index.items).toHaveLength(1);
    expect(result.index.items[0]!.id).toBe("a");
    expect(result.vectors).toHaveLength(384);
    expect(result.vectors[0]).toBeCloseTo(0.6, 6);
    expect(result.vectors[1]).toBeCloseTo(0.8, 6);
  });

  test("upsertItem replaces an existing item and vector", () => {
    const initial = insertItem(
      makeIndex(),
      new Float32Array(),
      makeItem("a", { kind: "vault", rank: 1 }),
      makeVector([1, 0]),
    );

    const updated = upsertItem(
      initial.index,
      initial.vectors,
      makeItem("a", { kind: "code", rank: 2 }),
      makeVector([0, 5]),
    );

    expect(updated.index.items).toHaveLength(1);
    expect(updated.index.items[0]!.metadata.kind).toBe("code");
    expect(updated.index.items[0]!.metadata.rank).toBe(2);
    expect(updated.vectors[0]).toBeCloseTo(0, 6);
    expect(updated.vectors[1]).toBeCloseTo(1, 6);
  });

  test("deleteItems removes matching ids and compacts vectors", () => {
    let state = insertItem(makeIndex(), new Float32Array(), makeItem("a"), makeVector([1, 0, 0]));
    state = insertItem(state.index, state.vectors, makeItem("b"), makeVector([0, 1, 0]));
    state = insertItem(state.index, state.vectors, makeItem("c"), makeVector([0, 0, 1]));

    const updated = deleteItems(state.index, state.vectors, ["b"]);

    expect(updated.index.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(updated.vectors).toHaveLength(384 * 2);
    expect(updated.vectors[0]).toBeCloseTo(1, 10);
    expect(updated.vectors[384 + 2]).toBeCloseTo(1, 10);
  });

  test("queryItems returns top-K results in score order", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "low", text: "low similarity", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "mid", text: "mid similarity", metadata: { kind: "vault" } },
      makeVector([1, 1, 1]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "high", text: "high similarity", metadata: { kind: "code" } },
      makeVector([0, 0, 1]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([0, 0, 1]), 2);

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("high");
    expect(results[1]!.id).toBe("mid");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  test("queryItems: sourceFilter='vault' returns only vault chunks", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk one", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-1", text: "code chunk one", metadata: { kind: "code" } },
      makeVector([0, 1, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "vault-2", text: "vault chunk two", metadata: { kind: "vault" } },
      makeVector([0, 0, 1]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 1]), 10, "vault");

    expect(results.every((r) => r.metadata.kind === "vault")).toBe(true);
    expect(results.map((r) => r.id).sort()).toEqual(["vault-1", "vault-2"]);
  });

  test("queryItems: sourceFilter='code' returns only code chunks", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-1", text: "code chunk one", metadata: { kind: "code" } },
      makeVector([0, 1, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-2", text: "code chunk two", metadata: { kind: "code" } },
      makeVector([0, 0, 1]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 1]), 10, "code");

    expect(results.every((r) => r.metadata.kind === "code")).toBe(true);
    expect(results.map((r) => r.id).sort()).toEqual(["code-1", "code-2"]);
  });

  test("queryItems: sourceFilter='code' also matches external chunks", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-1", text: "code chunk", metadata: { kind: "code" } },
      makeVector([0, 1, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "external-1", text: "external chunk", metadata: { kind: "external" } },
      makeVector([0, 0, 1]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 1]), 10, "code");

    // Should include both code and external, but not vault
    expect(results.map((r) => r.id).sort()).toEqual(["code-1", "external-1"]);
    expect(results.every((r) => r.metadata.kind !== "vault")).toBe(true);
  });

  test("queryItems: sourceFilter='vault' does not match external chunks", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "external-1", text: "external chunk", metadata: { kind: "external" } },
      makeVector([0, 1, 0]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 1]), 10, "vault");

    expect(results.map((r) => r.id)).toEqual(["vault-1"]);
    expect(results.every((r) => r.metadata.kind === "vault")).toBe(true);
  });

  test("queryItems: no sourceFilter (or 'all') returns all chunks", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-1", text: "code chunk", metadata: { kind: "code" } },
      makeVector([0, 1, 0]),
    );

    const resultsNoFilter = queryItems(state.index, state.vectors, makeVector([1, 1, 0]), 10);
    expect(resultsNoFilter).toHaveLength(2);

    const resultsAllFilter = queryItems(state.index, state.vectors, makeVector([1, 1, 0]), 10, undefined);
    expect(resultsAllFilter).toHaveLength(2);
  });

  test("queryItems: sourceFilter with no matching kind returns empty array", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "vault-2", text: "another vault chunk", metadata: { kind: "vault" } },
      makeVector([0, 1, 0]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 0]), 10, "code");
    expect(results).toHaveLength(0);
  });

  test("loadUnifiedIndex returns null for missing or corrupt files", async () => {
    const missingDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-missing-"));
    const corruptDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-corrupt-"));

    try {
      expect(await loadUnifiedIndex(missingDir)).toBeNull();

      const hfDir = path.join(corruptDir, ".hf");
      await fs.mkdir(hfDir, { recursive: true });
      await fs.writeFile(path.join(hfDir, "index.json"), "{ not valid json", "utf8");
      await fs.writeFile(path.join(hfDir, "index.bin"), new Uint8Array(4));

      expect(await loadUnifiedIndex(corruptDir)).toBeNull();
    } finally {
      await fs.rm(missingDir, { recursive: true, force: true });
      await fs.rm(corruptDir, { recursive: true, force: true });
    }
  });

  test("loadUnifiedIndex returns null for version mismatch", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-version-"));

    try {
      const hfDir = path.join(tmpDir, ".hf");
      await fs.mkdir(hfDir, { recursive: true });
      await fs.writeFile(
        path.join(hfDir, "index.json"),
        `${JSON.stringify({
          version: 1,
          embeddingDim: 384,
          items: [],
          fileHashes: {},
          timestamp: new Date().toISOString(),
        })}\n`,
        "utf8",
      );
      await fs.writeFile(path.join(hfDir, "index.bin"), new Uint8Array());

      expect(await loadUnifiedIndex(tmpDir)).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("batchUpsertItems: all new items", () => {
    const index = makeIndex();
    const vectors = new Float32Array(0);

    const result = batchUpsertItems(index, vectors, [
      { item: makeItem("a"), vector: makeVector([1, 0]) },
      { item: makeItem("b"), vector: makeVector([0, 1]) },
    ]);

    expect(result.index.items).toHaveLength(2);
    expect(result.vectors.length).toBe(384 * 2);
    expect(result.index.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  test("batchUpsertItems: mix of new and existing", () => {
    const state = insertItem(makeIndex(), new Float32Array(0), makeItem("a", { v: 1 }), makeVector([1, 0]));

    const result = batchUpsertItems(state.index, state.vectors, [
      { item: makeItem("a", { v: 2 }), vector: makeVector([2, 0]) },
      { item: makeItem("b"), vector: makeVector([0, 1]) },
    ]);

    expect(result.index.items).toHaveLength(2);
    expect(result.index.items[0]!.metadata.v).toBe(2); // updated
    expect(result.index.items[1]!.id).toBe("b"); // new
    expect(result.vectors.length).toBe(384 * 2);
  });

  test("batchUpsertItems: empty batch is no-op", () => {
    const index = makeIndex([makeItem("a")]);
    const vectors = new Float32Array(384);

    const result = batchUpsertItems(index, vectors, []);

    expect(result.index.items).toHaveLength(1);
    expect(result.vectors).toBe(vectors); // same reference
  });

  test("loadUnifiedIndex returns null when JSON/binary item count mismatches", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-mismatch-"));

    try {
      const hfDir = path.join(tmpDir, ".hf");
      await fs.mkdir(hfDir, { recursive: true });

      // Write valid JSON with 2 items but binary vectors for only 1 item
      const index = makeIndex([makeItem("a"), makeItem("b")]);
      await fs.writeFile(path.join(hfDir, "index.json"), `${JSON.stringify(index)}\n`, "utf8");
      await fs.writeFile(path.join(hfDir, "index.bin"), Buffer.from(new Float32Array(384).buffer));

      expect(await loadUnifiedIndex(tmpDir)).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("concurrent saveUnifiedIndex calls do not corrupt the index", async () => {
    // Two concurrent saves with different items must not leave a corrupt or
    // empty index on disk.  One write wins; the other either also completes or
    // is skipped — but the result must be a valid, loadable index.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-concurrent-"));

    try {
      const indexA = makeIndex([makeItem("a")]);
      const vectorsA = new Float32Array(384);
      vectorsA.set(makeVector([1, 0, 0]), 0);

      const indexB = makeIndex([makeItem("b")]);
      const vectorsB = new Float32Array(384);
      vectorsB.set(makeVector([0, 1, 0]), 0);

      // Fire both saves concurrently without awaiting either individually.
      await Promise.all([
        saveUnifiedIndex(tmpDir, indexA, vectorsA),
        saveUnifiedIndex(tmpDir, indexB, vectorsB),
      ]);

      // The on-disk state must be a valid, loadable index.
      const loaded = await loadUnifiedIndex(tmpDir);
      expect(loaded).not.toBeNull();
      // Must have exactly the items that the winning write serialised.
      expect(loaded!.index.items.length).toBeGreaterThan(0);
      expect(loaded!.vectors.length).toBe(384 * loaded!.index.items.length);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("saveUnifiedIndex skips saving gracefully when lock cannot be acquired", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "unified-store-lockskip-"));

    try {
      const hfDir = path.join(tmpDir, ".hf");
      await fs.mkdir(hfDir, { recursive: true });

      // Pre-create the lock file to simulate a held lock for the entire timeout.
      const lockPath = path.join(hfDir, "index.lock");
      await fs.writeFile(lockPath, '{"pid":0,"ts":"held"}\n', "utf8");

      const index = makeIndex([makeItem("x")]);
      const vectors = new Float32Array(384);

      // saveUnifiedIndex must resolve (not throw) even though the lock is held.
      await expect(saveUnifiedIndex(tmpDir, index, vectors)).resolves.toBeUndefined();

      // The index files must NOT have been written because the save was skipped.
      const jsonExists = await fs
        .access(path.join(hfDir, "index.json"))
        .then(() => true)
        .catch(() => false);
      expect(jsonExists).toBe(false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("source filter code matches both code and external kind", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-1", text: "code chunk", metadata: { kind: "code" } },
      makeVector([0, 1, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "external-1", text: "external chunk", metadata: { kind: "external" } },
      makeVector([0, 0, 1]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 1]), 10, "code");

    // vault should NOT appear
    expect(results.some((r) => r.id === "vault-1")).toBe(false);
    // code should appear
    expect(results.some((r) => r.id === "code-1")).toBe(true);
    // external should also appear when filtering by "code"
    expect(results.some((r) => r.id === "external-1")).toBe(true);
  });

  test("source filter vault matches only vault kind (not external)", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      { id: "vault-1", text: "vault chunk", metadata: { kind: "vault" } },
      makeVector([1, 0, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "code-1", text: "code chunk", metadata: { kind: "code" } },
      makeVector([0, 1, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      { id: "external-1", text: "external chunk", metadata: { kind: "external" } },
      makeVector([0, 0, 1]),
    );

    const results = queryItems(state.index, state.vectors, makeVector([1, 1, 1]), 10, "vault");

    // only vault items
    expect(results.map((r) => r.id)).toEqual(["vault-1"]);
  });
});

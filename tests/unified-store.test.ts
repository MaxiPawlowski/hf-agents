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
  const vector = new Array<number>(384).fill(0);
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

  test("queryItems supports metadata filter operators", () => {
    let state = insertItem(
      makeIndex(),
      new Float32Array(),
      makeItem("vault-a", { kind: "vault", tag: "plan", rank: 1, active: true }),
      makeVector([1, 0]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      makeItem("code-a", { kind: "code", tag: "runtime", rank: 2, active: true }),
      makeVector([0, 1]),
    );
    state = insertItem(
      state.index,
      state.vectors,
      makeItem("code-b", { kind: "code", tag: "tests", rank: 3, active: false }),
      makeVector([0, 1]),
    );

    expect(
      queryItems(state.index, state.vectors, makeVector([0, 1]), 10, {
        kind: { $eq: "code" },
      }).map((result) => result.id),
    ).toEqual(["code-a", "code-b"]);

    expect(
      queryItems(state.index, state.vectors, makeVector([0, 1]), 10, {
        kind: { $ne: "vault" },
      }).map((result) => result.id),
    ).toEqual(["code-a", "code-b"]);

    expect(
      queryItems(state.index, state.vectors, makeVector([0, 1]), 10, {
        tag: { $in: ["runtime", "plan"] },
      }).map((result) => result.id),
    ).toEqual(["code-a", "vault-a"]);

    expect(
      queryItems(state.index, state.vectors, makeVector([0, 1]), 10, {
        $and: [{ kind: "code" }, { active: true }],
      }).map((result) => result.id),
    ).toEqual(["code-a"]);

    expect(
      queryItems(state.index, state.vectors, makeVector([0, 1]), 10, {
        $or: [{ tag: "tests" }, { rank: { $eq: 1 } }],
      }).map((result) => result.id),
    ).toEqual(["code-b", "vault-a"]);
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

  test("queryItems: $or with multiple clauses returns union", () => {
    let state = insertItem(makeIndex(), new Float32Array(), makeItem("a", { kind: "vault" }), makeVector([1, 0]));
    state = insertItem(state.index, state.vectors, makeItem("b", { kind: "code" }), makeVector([0, 1]));
    state = insertItem(state.index, state.vectors, makeItem("c", { kind: "other" }), makeVector([1, 1]));

    const results = queryItems(state.index, state.vectors, makeVector([1, 1]), 10, {
      $or: [{ kind: "vault" }, { kind: "code" }],
    });

    expect(results.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("queryItems: nested $and + $or filters", () => {
    let state = insertItem(makeIndex(), new Float32Array(), makeItem("a", { kind: "vault", rank: 1 }), makeVector([1, 0]));
    state = insertItem(state.index, state.vectors, makeItem("b", { kind: "code", rank: 1 }), makeVector([0, 1]));
    state = insertItem(state.index, state.vectors, makeItem("c", { kind: "code", rank: 2 }), makeVector([1, 1]));

    const results = queryItems(state.index, state.vectors, makeVector([1, 1]), 10, {
      $and: [
        { $or: [{ kind: "vault" }, { kind: "code" }] },
        { rank: { $gte: 2 } },
      ],
    });

    expect(results.map((r) => r.id)).toEqual(["c"]);
  });

  test("queryItems: empty $or returns nothing, empty $and returns everything", () => {
    let state = insertItem(makeIndex(), new Float32Array(), makeItem("a"), makeVector([1, 0]));

    expect(queryItems(state.index, state.vectors, makeVector([1, 0]), 10, { $or: [] })).toHaveLength(0);
    expect(queryItems(state.index, state.vectors, makeVector([1, 0]), 10, { $and: [] })).toHaveLength(1);
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
});

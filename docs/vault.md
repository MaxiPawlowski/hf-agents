# Vault Semantic Index — Technical Reference

The vault is an optional markdown context layer that the runtime indexes locally and retrieves semantically. This document covers the implementation, the data model, the query API, and the testing strategy.

---

## Overview

When `vault/` is present, the runtime builds a vector index of vault documents and (optionally) TypeScript source files. At query time it embeds the current milestone description and returns the top-K most relevant chunks, which are injected as supplemental context for the active agent. When `vault/` is absent or the index cannot be loaded, the runtime falls back to brute-force character-budget inclusion and continues unaffected.

The plan doc remains the executable contract: milestones, acceptance, evidence, and completion state stay in `plans/`. Runtime state remains in `plans/runtime/<slug>/`; the runtime never depends on `vault/` for correctness.

---

## Vault Layout And Rules

Vault context lives under `vault/`:

| Path | Purpose |
|---|---|
| `vault/plans/<slug>/context.md` | Active-plan discoveries, constraints, and cross-cutting notes that do not belong in milestone metadata |
| `vault/plans/<slug>/discoveries.md` | Execution-time findings, blocker resolutions, and implementation notes that may matter across milestones |
| `vault/plans/<slug>/decisions.md` | In-flight plan-specific decisions and rationale |
| `vault/plans/<slug>/references.md` | Short references, commands, and pointers worth preserving for the active plan |
| `vault/shared/architecture.md` | Durable architecture notes reusable across plans |
| `vault/shared/patterns.md` | Established implementation patterns and conventions |
| `vault/shared/decisions.md` | Cross-plan decisions and lessons learned |

Rules:

- `vault/` is optional. When it is absent, execution and prompt generation continue exactly as before.
- Agents create and update vault content; the runtime only reads it and never auto-creates vault directories.
- `hf-vault-bootstrap` is the packaged skill for first-pass vault authoring; it gathers kickoff context through dialogue and writes only approved vault files.
- Keep shared vault content lightweight and durable. Put task-specific notes under `vault/plans/<slug>/`.

---

## Module Map

| Module | Responsibility |
|---|---|
| `src/runtime/vault-embeddings.ts` | Lazy-loads `Xenova/all-MiniLM-L6-v2`, exposes `embed()` and `embedBatch()` |
| `src/runtime/vault-chunker.ts` | Splits vault markdown into header-bounded chunks (`VaultChunk[]`) |
| `src/runtime/code-chunker.ts` | Splits TypeScript source into export/declaration-bounded chunks (`VaultChunk[]`) |
| `src/runtime/unified-store.ts` | Dual-format index: JSON metadata + binary `Float32Array` vectors; CRUD + query |
| `src/runtime/unified-index-pipeline.ts` | Orchestrates scan → hash → diff → chunk → embed → upsert → persist |
| `src/runtime/vault-store.ts` | Legacy JSON-only index (superseded by unified-store, kept for reference) |

---

## Embedding Model

- **Model**: `Xenova/all-MiniLM-L6-v2` (HuggingFace Transformers.js, runs locally, no network required after first download)
- **Dimension**: 384
- **Pooling**: mean pooling with L2 normalization
- **Loading**: singleton with deduplication — `getExtractor()` returns the same `Promise` if loading is already in progress
- **Warmup**: `warmupEmbeddingModel()` fires the load early (e.g., during session hydrate) so the model is ready before the first `embedBatch()` call
- **Error type**: `EmbeddingModelError` — thrown when the model fails to load or embed; the pipeline catches this and returns `null` instead of crashing

---

## Index Storage

The index lives at `.hf/` in the repo root (or the `repoRoot` passed to `buildUnifiedIndex`):

```
.hf/
├── index.json   # IndexItem[] metadata + fileHashes + schema version (v2)
└── index.bin    # Flat Float32Array of 384-dim unit vectors (one per item)
```

**Schema version**: `2`. `loadUnifiedIndex` returns `null` (triggering a rebuild) if the version does not match or either file is missing or corrupt.

**Vector layout**: item `i` occupies `vectors[i * 384 .. (i+1) * 384 - 1]`. Vectors are normalized at write time; the store never stores unnormalized vectors.

---

## Indexing Pipeline

`buildUnifiedIndex(config)` in `unified-index-pipeline.ts`:

```typescript
interface BuildUnifiedIndexConfig {
  repoRoot: string;
  vaultPaths?: VaultPaths;       // vault/plans/<slug>/ and vault/shared/
  vaultContext?: VaultContext;    // pre-loaded docs (avoids re-reading from disk)
  codeConfig?: CodeIndexConfig;  // TypeScript roots + excludes
}
```

**Step-by-step**:

1. **Scan** — recursively reads vault markdown files and `.ts` source files (excluding `.test.ts`, `.d.ts`, `node_modules/`, `dist/` by default).
2. **Hash** — SHA-256 each file's content.
3. **Diff** — compare against `index.fileHashes`; bucket files into `changedOrAdded` and `removedPaths`.
4. **Short-circuit** — if nothing changed and nothing was removed, return the existing index immediately (no embeddings, no writes).
5. **Purge stale** — call `deleteItems()` for items whose source file changed or was removed; this compacts the vector array.
6. **Chunk** — vault files → `chunkVaultDocument()`; TypeScript files → `chunkTypeScriptFile()`.
7. **Embed** — `embedInBatches()` sends chunks in groups of 100 to `embedBatch()`.
8. **Upsert** — `upsertItem()` for each chunk (insert or replace by deterministic chunk ID).
9. **Persist** — `saveUnifiedIndex()` writes both `.hf/index.json` and `.hf/index.bin`.
10. **Error handling** — if `embedBatch()` throws `EmbeddingModelError`, the pipeline logs and returns `null`; any other error propagates.

---

## Chunking

### Vault markdown (`vault-chunker.ts`)

- Splits at `##` and `###` header lines (not `#` top-level).
- Filters empty preamble before the first header.
- Merges "thin" sections (body content < 20 characters) with the adjacent section to avoid noise chunks.
- Each `VaultChunk` carries a deterministic `id` (SHA-256 of `sourcePath + sectionTitle`).

### TypeScript source (`code-chunker.ts`)

- Splits at top-level declaration boundaries: `import`/`export` blocks, functions, classes, interfaces, type aliases, enums, exported variables.
- Groups all import/export statements into a single "imports" chunk.
- Merges thin chunks (< 20 chars) forward.
- `metadata.kind` is set to `"code"`.

Both chunkers share the same `VaultChunk` output type:

```typescript
interface VaultChunk {
  id: string;
  text: string;
  metadata: {
    sourcePath: string;
    sectionTitle: string;
    documentTitle: string;
    kind?: "vault" | "code";
  };
}
```

---

## Query API

`queryItems()` in `unified-store.ts`:

```typescript
function queryItems(
  index: UnifiedIndex,
  vectors: Float32Array,
  queryVector: number[],    // will be normalized internally
  topK: number,
  filter?: MetadataFilter,
): QueryItemResult[]
```

- Normalizes the query vector before scoring.
- Uses dot product on unit vectors (equivalent to cosine similarity).
- Filters items by `MetadataFilter` before scoring.
- Returns up to `topK` results sorted by descending score.

### Metadata Filters

```typescript
// Exact match (shorthand)
{ kind: "vault" }

// Operator form
{ kind: { $eq: "vault" } }
{ kind: { $ne: "code" } }
{ rank: { $gt: 1 } }
{ rank: { $gte: 2, $lte: 5 } }
{ tag: { $in: ["runtime", "plan"] } }
{ tag: { $nin: ["tests"] } }

// Logical combinators
{ $and: [{ kind: "code" }, { active: true }] }
{ $or: [{ tag: "tests" }, { rank: { $eq: 1 } }] }
```

Field values are `string | number | boolean`.

---

## Testing Strategy

Tests are split across three layers: unit, integration, and end-to-end.

### Unit: `tests/unified-store.test.ts`

Tests the storage layer in isolation — no filesystem mocking, uses real temp directories.

| Test | What it covers |
|---|---|
| `save and load round-trip` | JSON and binary vectors survive a write/read cycle |
| `insertItem appends item and stores a normalized vector` | Vector normalization (3-4-5 triangle → 0.6, 0.8) |
| `upsertItem replaces an existing item and vector` | Idempotent update of both metadata and vector |
| `deleteItems removes matching ids and compacts vectors` | Compaction keeps correct positional mapping for remaining items |
| `queryItems returns top-K results in score order` | Cosine ranking with topK limit |
| `queryItems supports metadata filter operators` | All operators: `$eq`, `$ne`, `$in`, `$and`, `$or`, etc. |
| `loadUnifiedIndex returns null for missing or corrupt files` | Graceful `null` on ENOENT and JSON parse errors |
| `loadUnifiedIndex returns null for version mismatch` | Schema version guard triggers rebuild |

### Integration: `tests/unified-index-pipeline.test.ts`

Tests the full pipeline using real temp directories and **mocked** `embedBatch`. The mock returns deterministic seed-based vectors so tests are fast and reproducible without loading the model.

```typescript
vi.mock("../src/runtime/vault-embeddings.js", async () => ({
  EmbeddingModelError: actual.EmbeddingModelError,
  embed: vi.fn(),
  embedBatch: vi.fn(),
}));
```

| Test | What it covers |
|---|---|
| `full build from scratch` | Vault + code files indexed together; `.test.ts` and `.d.ts` excluded; result persisted and loadable |
| `incremental skip for unchanged files` | Second run with same files calls `embedBatch` zero times |
| `incremental re-embed for changed file` | Only the changed file's chunks are re-embedded; unchanged file's text preserved |
| `incremental purge for removed file` | Deleted file disappears from items and fileHashes; no re-embedding needed |
| `batched embedding splits into sub-batches` | 205 files → 3 calls: [100, 100, 5] |
| `mixed vault and code merges correctly` | `kind` metadata set correctly per source type |
| `EmbeddingModelError returns null` | Pipeline returns `null` and logs; does not throw |

### End-to-end: `tests/e2e/vault-index.test.ts`

Tests the full stack through the OpenCode plugin in a real fixture project. Requires a live OpenCode session; skipped automatically if auth is unavailable.

**Setup**:
1. `createFixtureProject()` — scaffolds a temporary project directory.
2. `seedVaultIndexFixture()` — writes fixture vault files:
   - `vault/plans/test/context.md` — 3 sections (produces 3 chunks)
   - `vault/shared/architecture.md` — 2 sections (produces 2 chunks)
3. Removes the existing index to force a rebuild.
4. `installFixturePluginLoader()` — writes a `.opencode/plugins/hybrid-runtime.js` pointing at the local build.

**Flow**:
1. Warmup run: `"Warm the plugin and reply with the single word warmed."` — confirms the plugin loaded and the index was built.
2. Wait for `.hf/index.json` to appear on disk (up to 15 s).
3. Query run: `"Use the vault notes if available. In one sentence, explain the authentication guidance..."` — triggers semantic retrieval.

**Assertions**:
- Index has exactly 5 entries (3 from context.md + 2 from architecture.md).
- `sourcePath` values match expected vault paths.
- Model response contains `"token rotation"` — a term from the seeded fixture content.

---

## Adding Vault Content

See `hf-vault-bootstrap` skill for interactive first-pass authoring. For manual additions:

- Put plan-specific notes in `vault/plans/<slug>/context.md` (or the other per-plan files).
- Put durable cross-plan knowledge in `vault/shared/`.
- Use `##` or `###` headers to create meaningful chunk boundaries — one concept per section is ideal.
- Sections with very short bodies (< 20 chars) are merged automatically; avoid stub sections.
- The index rebuilds incrementally on next use; only changed files are re-embedded.

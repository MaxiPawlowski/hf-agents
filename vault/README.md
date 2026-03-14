# Vault

The vault is an optional markdown knowledge layer that sits beside the canonical plan doc and runtime sidecars.

Use it for:

- discoveries that span multiple milestones
- design rationale and in-flight decisions
- blocker resolutions worth preserving across handoffs
- references, commands, and constraints that would otherwise be rediscovered
- durable shared architecture and pattern notes

Do not use it for:

- milestone checkboxes, acceptance criteria, or completion evidence
- runtime counters, session state, or other execution bookkeeping
- anything the runtime must read to execute correctly

## Layout

```text
vault/
  plans/
    <plan-slug>/
      context.md
      discoveries.md
      decisions.md
      references.md
  shared/
    architecture.md
    patterns.md
    decisions.md
  templates/
    plan-context.md
    plan-discoveries.md
    plan-decisions.md
    plan-references.md
    shared-architecture.md
    shared-patterns.md
    shared-decisions.md
```

## Conventions

- `vault/plans/<plan-slug>/` is plan-scoped context only.
- `vault/shared/` is cross-plan context only.
- Append or make small targeted edits when recording new findings so concurrent handoffs are less likely to clobber notes.
- Prefer short factual entries over long narrative prose.
- If a file does not exist, that is a valid empty state.

## Runtime relationship

- The runtime reads well-known markdown files from `vault/plans/<slug>/` and `vault/shared/`.
- Vault content is embedded locally using `@huggingface/transformers` with the `all-MiniLM-L6-v2` model (384-dim, ~23MB ONNX) and stored in a JSON-backed vector index at `vault/.vault-index.json`.
- When a current milestone exists, the resume prompt retrieves the top-5 most relevant vault sections via cosine similarity instead of dumping content sequentially.
- The index rebuilds automatically when vault file content changes (SHA-256 hash-based staleness detection).
- When the index is unavailable (first run without network, embedding failure, or empty vault), the runtime falls back to the existing brute-force character-budget inclusion.
- When content does not exist, the runtime behaves identically to the no-vault case.

## Semantic retrieval pipeline

1. Vault markdown files are split into sections at `##`/`###` header boundaries.
2. Each section is embedded into a 384-dimensional vector using `all-MiniLM-L6-v2` via `@huggingface/transformers`.
3. Vectors are stored in `vault/.vault-index.json` (gitignored) alongside a content hash for staleness detection.
4. At prompt-build time, the current milestone description is embedded and used as a query to retrieve the top-5 most relevant sections via cosine similarity.
5. Retrieved sections replace the sequential dump in the `## Vault context` section of the resume prompt.

**First-run note**: The `all-MiniLM-L6-v2` model (~23MB) is downloaded on first use and cached locally by the library. Subsequent runs use the cached model. If the model cannot be downloaded (offline environment), the system falls back to brute-force vault inclusion.

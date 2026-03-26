import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { VaultContext, VaultDocument, VaultPaths } from "./types.js";
import { normalizePath } from "./chunk-utils.js";
import { chunkTypeScriptFile } from "./code-chunker.js";
import { hfLog } from "./logger.js";
import {
  batchUpsertItems,
  deleteItems,
  loadUnifiedIndex,
  saveUnifiedIndex,
  type UnifiedIndex,
} from "./unified-store.js";
import { EmbeddingModelError, embedBatch } from "./vault-embeddings.js";
import { chunkVaultDocument } from "./vault-chunker.js";

const EMBEDDING_BATCH_SIZE = 100;
const DEFAULT_EXCLUDES = ["node_modules/", "dist/"];

export interface CodeIndexConfig {
  roots: string[];
  extensions?: string[] | undefined;
  exclude?: string[] | undefined;
}

interface BuildUnifiedIndexConfig {
  repoRoot: string;
  vaultPaths?: VaultPaths;
  vaultContext?: VaultContext;
  codeConfig?: CodeIndexConfig | undefined;
  embeddingBatchSize?: number | undefined;
  maxChunkChars?: number | undefined;
}

interface ScannedFile {
  path: string;
  hash: string;
  kind: "vault" | "code";
  content: string;
  title?: string;
}

function computeFileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function createEmptyIndex(): UnifiedIndex {
  return {
    version: 2,
    embeddingDim: 384,
    items: [],
    fileHashes: {},
    timestamp: new Date().toISOString(),
  };
}

function toRelative(filePath: string, baseDir: string): string {
  return normalizePath(path.relative(baseDir, filePath));
}

function matchesExclude(filePath: string, rootPath: string, exclude: readonly string[]): boolean {
  const relativePath = normalizePath(path.relative(rootPath, filePath));
  const normalizedPath = normalizePath(filePath);

  return exclude.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    return (
      normalizedPath.includes(normalizedPattern) ||
      relativePath.includes(normalizedPattern) ||
      path.basename(filePath) === normalizedPattern
    );
  });
}

async function scanRecursive(rootPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootPath, { recursive: true });
    return entries.map((entry) => path.join(rootPath, entry)).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function buildVaultContextMap(vaultContext?: VaultContext): Map<string, VaultDocument> {
  const docs = vaultContext ? [...vaultContext.plan, ...vaultContext.shared] : [];
  return new Map(docs.map((doc) => [path.resolve(doc.path), doc]));
}

async function scanVaultFiles(
  repoRoot: string,
  vaultPaths: VaultPaths,
  vaultContext?: VaultContext,
): Promise<ScannedFile[]> {
  const vaultDocs = buildVaultContextMap(vaultContext);
  const files = await Promise.all(
    [vaultPaths.planDir, vaultPaths.sharedDir].map(async (rootPath) => {
      const entries = await scanRecursive(rootPath);
      const markdownFiles = entries.filter((filePath) => filePath.endsWith(".md"));

      return Promise.all(
        markdownFiles.map(async (filePath) => {
          const resolvedPath = path.resolve(filePath);
          const knownDoc = vaultDocs.get(resolvedPath);
          const content = knownDoc ? knownDoc.content : await fs.readFile(resolvedPath, "utf8");

          return {
            path: toRelative(resolvedPath, repoRoot),
            hash: computeFileHash(content),
            kind: "vault" as const,
            content,
            title: knownDoc?.title ?? path.basename(resolvedPath, path.extname(resolvedPath)),
          };
        }),
      );
    }),
  );

  return files.flat();
}

async function scanCodeFiles(repoRoot: string, codeConfig: CodeIndexConfig): Promise<ScannedFile[]> {
  const exclude = [...DEFAULT_EXCLUDES, ...(codeConfig.exclude ?? [])];
  const roots = [...new Set(codeConfig.roots.map((root) => path.resolve(repoRoot, root)))].sort((a, b) =>
    a.localeCompare(b),
  );

  const files = await Promise.all(
    roots.map(async (rootPath) => {
      const entries = await scanRecursive(rootPath);
      const extensions = codeConfig.extensions ?? [".ts"];
      const sourceFiles = entries.filter((filePath) => {
        const matchesExt = extensions.some((ext) => filePath.endsWith(ext));
        if (!matchesExt) {
          return false;
        }
        // Exclude test and declaration files for each configured extension
        if (extensions.some((ext) => filePath.endsWith(`.test${ext}`) || filePath.endsWith(`.d${ext}`))) {
          return false;
        }
        return !matchesExclude(filePath, repoRoot, exclude);
      });

      return Promise.all(
        sourceFiles.map(async (filePath) => {
          const resolvedPath = path.resolve(filePath);
          const content = await fs.readFile(resolvedPath, "utf8");
          return {
            path: toRelative(resolvedPath, repoRoot),
            hash: computeFileHash(content),
            kind: "code" as const,
            content,
          };
        }),
      );
    }),
  );

  return files.flat();
}

async function embedInBatches(texts: string[], batchSize: number = EMBEDDING_BATCH_SIZE): Promise<number[][]> {
  const results: number[][] = [];
  const totalBatches = Math.ceil(texts.length / batchSize);

  for (let i = 0; i < totalBatches; i++) {
    hfLog({
      tag: "unified-index-pipeline",
      msg: `Embedding batch ${i + 1}/${totalBatches}...`,
    });
    const start = i * batchSize;
    const batchTexts = texts.slice(start, start + batchSize);
    const batchEmbeddings = await embedBatch(batchTexts);
    results.push(...batchEmbeddings);
  }

  return results;
}

function toIndexMetadata(
  metadata: {
    sourcePath: string;
    sectionTitle: string;
    documentTitle: string;
    kind?: "vault" | "code";
  },
): Record<string, string> {
  return {
    sourcePath: metadata.sourcePath,
    sectionTitle: metadata.sectionTitle,
    documentTitle: metadata.documentTitle,
    kind: metadata.kind ?? "vault",
  };
}

export async function buildUnifiedIndex(
  config: BuildUnifiedIndexConfig,
): Promise<{ index: UnifiedIndex; vectors: Float32Array } | null> {
  const scannedFiles = [...new Map([
    ...(config.vaultPaths ? await scanVaultFiles(config.repoRoot, config.vaultPaths, config.vaultContext) : []),
    ...(config.codeConfig ? await scanCodeFiles(config.repoRoot, config.codeConfig) : []),
  ].map((file) => [file.path, file] as const)).values()].sort((a, b) => a.path.localeCompare(b.path));

  if (scannedFiles.length === 0) {
    const emptyIndex = createEmptyIndex();
    return { index: emptyIndex, vectors: new Float32Array() };
  }

  const currentHashes = Object.fromEntries(scannedFiles.map((file) => [file.path, file.hash]));
  const existing = await loadUnifiedIndex(config.repoRoot);
  const previousHashes = existing?.index.fileHashes ?? {};
  const currentPaths = new Set(scannedFiles.map((file) => file.path));
  const changedOrAdded = scannedFiles.filter((file) => previousHashes[file.path] !== file.hash);
  const removedPaths = Object.keys(previousHashes)
    .filter((filePath) => !currentPaths.has(filePath))
    .sort((a, b) => a.localeCompare(b));

  if (existing && changedOrAdded.length === 0 && removedPaths.length === 0) {
    return existing;
  }

  let state = existing ?? { index: createEmptyIndex(), vectors: new Float32Array() };
  const stalePaths = new Set([...changedOrAdded.map((file) => file.path), ...removedPaths]);
  if (stalePaths.size > 0) {
    const staleIds = state.index.items
      .filter((item) => stalePaths.has(String(item.metadata.sourcePath)))
      .map((item) => item.id);
    state = deleteItems(state.index, state.vectors, staleIds);
  }

  state.index.fileHashes = currentHashes;
  state.index.timestamp = new Date().toISOString();

  const changedChunks = changedOrAdded.flatMap((file) => {
    if (file.kind === "vault") {
      return chunkVaultDocument({
        path: file.path,
        title: file.title ?? path.basename(file.path, path.extname(file.path)),
        content: file.content,
      }, config.maxChunkChars);
    }
    return chunkTypeScriptFile(file.path, file.content, config.maxChunkChars);
  });

  if (changedChunks.length === 0) {
    await saveUnifiedIndex(config.repoRoot, state.index, state.vectors);
    return state;
  }

  try {
    const embeddings = await embedInBatches(changedChunks.map((chunk) => chunk.text), config.embeddingBatchSize);

    const batchEntries = changedChunks.map((chunk, i) => ({
      item: {
        id: chunk.id,
        text: chunk.text,
        metadata: toIndexMetadata(chunk.metadata),
      },
      vector: embeddings[i]!,
    }));

    state = batchUpsertItems(state.index, state.vectors, batchEntries);

    await saveUnifiedIndex(config.repoRoot, state.index, state.vectors);
    return state;
  } catch (error) {
    if (error instanceof EmbeddingModelError) {
      hfLog({ tag: "unified-index", msg: "embedding failed, skipping index build", data: { error: error.message } });
      return null;
    }
    throw error;
  }
}

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ExternalIndexConfig, VaultChunk, VaultContext, VaultDocument, VaultPaths } from "./types.js";
import { normalizePath } from "./chunk-utils.js";
import { chunkTypeScriptFile } from "./code-chunker.js";
import { hfLog } from "./logger.js";
import {
  batchUpsertItems,
  deleteItems,
  loadUnifiedIndex,
  saveUnifiedIndex,
  type StoreState,
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
  externalConfig?: ExternalIndexConfig | undefined;
  embeddingBatchSize?: number | undefined;
  maxChunkChars?: number | undefined;
}

export interface ScannedFile {
  path: string;
  hash: string;
  kind: "vault" | "code" | "external";
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

const EXTERNAL_DEFAULT_EXTENSIONS = [".ts", ".js", ".md"];
const TS_JS_EXTENSIONS = [".ts", ".js"];

export async function scanExternalFiles(externalConfig: ExternalIndexConfig): Promise<ScannedFile[]> {
  const exclude = [...DEFAULT_EXCLUDES, ...(externalConfig.exclude ?? [])];
  const extensions = externalConfig.extensions ?? EXTERNAL_DEFAULT_EXTENSIONS;
  const roots = [...new Set(externalConfig.roots.map((root) => path.resolve(root)))].sort((a, b) =>
    a.localeCompare(b),
  );

  const files = await Promise.all(
    roots.map(async (rootPath) => {
      const entries = await scanRecursive(rootPath);
      const sourceFiles = entries.filter((filePath) => {
        const matchesExt = extensions.some((ext) => filePath.endsWith(ext));
        if (!matchesExt) {
          return false;
        }
        // For .ts/.js only: exclude test and declaration files
        if (TS_JS_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
          if (TS_JS_EXTENSIONS.some((ext) => filePath.endsWith(`.test${ext}`) || filePath.endsWith(`.d${ext}`))) {
            return false;
          }
        }
        return !matchesExclude(filePath, rootPath, exclude);
      });

      return (
        await Promise.all(
          sourceFiles.map(async (filePath) => {
            const resolvedPath = path.resolve(filePath);
            let content: string;
            try {
              content = await fs.readFile(resolvedPath, "utf8");
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code;
              if (code === "EACCES" || code === "EPERM") {
                hfLog({ tag: "unified-index-pipeline", msg: `Skipping file due to permission error: ${resolvedPath}` });
                return null;
              }
              throw err;
            }
            const result: ScannedFile = {
              path: resolvedPath,
              hash: computeFileHash(content),
              kind: "external",
              content,
            };
            return result;
          }),
        )
      ).filter((f): f is ScannedFile => f !== null);
    }),
  );

  return files.flat();
}

function chunkTextFile(filePath: string, content: string, maxChunkChars: number = 2000): VaultChunk[] {
  const documentTitle = path.basename(filePath, path.extname(filePath));
  const paragraphs = content.split(/\n\n+/);
  const chunks: VaultChunk[] = [];
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Split oversized paragraphs by maxChunkChars
    let offset = 0;
    while (offset < trimmed.length) {
      const slice = trimmed.slice(offset, offset + maxChunkChars);
      const id = createHash("sha256")
        .update(`${filePath}:${chunkIndex}`)
        .digest("hex")
        .slice(0, 16);
      chunks.push({
        id,
        text: slice,
        metadata: {
          sourcePath: filePath,
          sectionTitle: documentTitle,
          documentTitle,
          kind: "external",
        },
      });
      chunkIndex++;
      offset += maxChunkChars;
    }
  }

  if (chunks.length === 0 && content.trim()) {
    const id = createHash("sha256").update(`${filePath}:0`).digest("hex").slice(0, 16);
    chunks.push({
      id,
      text: content.trim().slice(0, maxChunkChars),
      metadata: {
        sourcePath: filePath,
        sectionTitle: documentTitle,
        documentTitle,
        kind: "external",
      },
    });
  }

  return chunks;
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
    kind?: "vault" | "code" | "external";
  },
): Record<string, string> {
  return {
    sourcePath: metadata.sourcePath,
    sectionTitle: metadata.sectionTitle,
    documentTitle: metadata.documentTitle,
    kind: metadata.kind ?? "vault",
  };
}

interface DiffResult {
  changedOrAdded: ScannedFile[];
  removedPaths: string[];
  currentHashes: Record<string, string>;
  noChanges: boolean;
}

function diffFiles(scannedFiles: ScannedFile[], existing: StoreState | null): DiffResult {
  const currentHashes = Object.fromEntries(scannedFiles.map((file) => [file.path, file.hash]));
  const previousHashes = existing?.index.fileHashes ?? {};
  const currentPaths = new Set(scannedFiles.map((file) => file.path));
  const changedOrAdded = scannedFiles.filter((file) => previousHashes[file.path] !== file.hash);
  const removedPaths = Object.keys(previousHashes)
    .filter((filePath) => !currentPaths.has(filePath))
    .sort((a, b) => a.localeCompare(b));
  const noChanges = existing !== null && changedOrAdded.length === 0 && removedPaths.length === 0;
  return { changedOrAdded, removedPaths, currentHashes, noChanges };
}

function purgeStaleItems(
  state: StoreState,
  changedOrAdded: ScannedFile[],
  removedPaths: string[],
): StoreState {
  const stalePaths = new Set([...changedOrAdded.map((file) => file.path), ...removedPaths]);
  if (stalePaths.size === 0) {
    return state;
  }
  const staleIds = state.index.items
    .filter((item) => stalePaths.has(String(item.metadata.sourcePath)))
    .map((item) => item.id);
  return deleteItems(state.index, state.vectors, staleIds);
}

function chunkExternalFile(file: ScannedFile, maxChunkChars?: number): VaultChunk[] {
  const ext = path.extname(file.path).toLowerCase();
  if (ext === ".ts" || ext === ".js") {
    return chunkTypeScriptFile(file.path, file.content, maxChunkChars).map((chunk) => ({
      ...chunk,
      metadata: { ...chunk.metadata, kind: "external" as const },
    }));
  }
  if (ext === ".md") {
    return chunkVaultDocument({
      path: file.path,
      title: path.basename(file.path, ext),
      content: file.content,
    }, maxChunkChars).map((chunk) => ({
      ...chunk,
      metadata: { ...chunk.metadata, kind: "external" as const },
    }));
  }
  return chunkTextFile(file.path, file.content, maxChunkChars);
}

function chunkChangedFiles(changedOrAdded: ScannedFile[], maxChunkChars?: number): VaultChunk[] {
  return changedOrAdded.flatMap((file) => {
    if (file.kind === "vault") {
      return chunkVaultDocument({
        path: file.path,
        title: file.title ?? path.basename(file.path, path.extname(file.path)),
        content: file.content,
      }, maxChunkChars);
    }
    if (file.kind === "external") {
      return chunkExternalFile(file, maxChunkChars);
    }
    return chunkTypeScriptFile(file.path, file.content, maxChunkChars);
  });
}

async function embedAndInsertChunks(
  state: StoreState,
  chunks: VaultChunk[],
  embeddingBatchSize?: number,
): Promise<StoreState> {
  const embeddings = await embedInBatches(chunks.map((chunk) => chunk.text), embeddingBatchSize);
  const batchEntries = chunks.map((chunk, i) => ({
    item: {
      id: chunk.id,
      text: chunk.text,
      metadata: toIndexMetadata(chunk.metadata),
    },
    vector: embeddings[i]!,
  }));
  return batchUpsertItems(state.index, state.vectors, batchEntries);
}

export async function buildUnifiedIndex(
  config: BuildUnifiedIndexConfig,
): Promise<StoreState | null> {
  const scannedFiles = [...new Map([
    ...(config.vaultPaths ? await scanVaultFiles(config.repoRoot, config.vaultPaths, config.vaultContext) : []),
    ...(config.codeConfig ? await scanCodeFiles(config.repoRoot, config.codeConfig) : []),
    ...(config.externalConfig ? await scanExternalFiles(config.externalConfig) : []),
  ].map((file) => [file.path, file] as const)).values()].sort((a, b) => a.path.localeCompare(b.path));

  if (scannedFiles.length === 0) {
    return { index: createEmptyIndex(), vectors: new Float32Array() };
  }

  const existing = await loadUnifiedIndex(config.repoRoot);
  const { changedOrAdded, removedPaths, currentHashes, noChanges } = diffFiles(scannedFiles, existing);

  if (noChanges) {
    return existing;
  }

  let state = purgeStaleItems(existing ?? { index: createEmptyIndex(), vectors: new Float32Array() }, changedOrAdded, removedPaths);
  state.index.fileHashes = currentHashes;
  state.index.timestamp = new Date().toISOString();

  const changedChunks = chunkChangedFiles(changedOrAdded, config.maxChunkChars);

  if (changedChunks.length === 0) {
    await saveUnifiedIndex(config.repoRoot, state.index, state.vectors);
    return state;
  }

  try {
    state = await embedAndInsertChunks(state, changedChunks, config.embeddingBatchSize);
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

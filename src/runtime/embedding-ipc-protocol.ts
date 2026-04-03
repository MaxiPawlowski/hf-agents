import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const EMBEDDING_IPC_JSONRPC_VERSION = "2.0" as const;
export const EMBEDDING_IPC_PROTOCOL_VERSION = 1 as const;

export const EMBEDDING_IPC_METHOD_EMBED = "embed" as const;
export const EMBEDDING_IPC_METHOD_EMBED_BATCH = "embedBatch" as const;

export const EMBEDDING_IPC_TRANSPORT_NAMED_PIPE = "named-pipe" as const;
export const EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET = "unix-socket" as const;

export type EmbeddingIpcMethod =
  | typeof EMBEDDING_IPC_METHOD_EMBED
  | typeof EMBEDDING_IPC_METHOD_EMBED_BATCH;

export type EmbeddingIpcTransport =
  | typeof EMBEDDING_IPC_TRANSPORT_NAMED_PIPE
  | typeof EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET;

export type JsonRpcId = number | string | null;

export interface JsonRpcRequest<TParams = Record<string, unknown>> {
  jsonrpc: typeof EMBEDDING_IPC_JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: typeof EMBEDDING_IPC_JSONRPC_VERSION;
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof EMBEDDING_IPC_JSONRPC_VERSION;
  id: JsonRpcId;
  error: JsonRpcError;
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

export interface EmbedRequestParams {
  text: string;
}

export interface EmbedBatchRequestParams {
  texts: string[];
}

export interface EmbedResponseResult {
  embedding: number[];
}

export interface EmbedBatchResponseResult {
  embeddings: number[][];
}

export type EmbedJsonRpcRequest = JsonRpcRequest<EmbedRequestParams> & {
  method: typeof EMBEDDING_IPC_METHOD_EMBED;
};

export type EmbedBatchJsonRpcRequest = JsonRpcRequest<EmbedBatchRequestParams> & {
  method: typeof EMBEDDING_IPC_METHOD_EMBED_BATCH;
};

export type EmbeddingIpcRequest = EmbedJsonRpcRequest | EmbedBatchJsonRpcRequest;

export interface EmbeddingIpcManifest {
  version: typeof EMBEDDING_IPC_PROTOCOL_VERSION;
  transport: EmbeddingIpcTransport;
  endpoint: string;
}

export interface EmbeddingIpcEndpointResolution {
  transport: EmbeddingIpcTransport;
  endpoint: string;
  manifestPath: string;
  repoRootHash: string;
  usesTmpdirFallback: boolean;
}

export const EMBEDDING_IPC_MANIFEST_FILENAME = "embed-ipc.json" as const;
export const EMBEDDING_IPC_SOCKET_FILENAME = "embed-ipc.sock" as const;
export const EMBEDDING_IPC_PIPE_PREFIX = "hf-embed-" as const;

export const EMBEDDING_IPC_CONNECT_TIMEOUT_MS = 750;
export const EMBEDDING_IPC_REQUEST_TIMEOUT_MS = 3_000;
export const EMBEDDING_IPC_SHUTDOWN_TIMEOUT_MS = 1_000;

// Keep safely under common sockaddr_un path limits across platforms.
export const EMBEDDING_IPC_MAX_UNIX_SOCKET_PATH_LENGTH = 103;

function normalizeRepoRootForHash(repoRoot: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(repoRoot);
  const normalized = resolved.replace(/\\/g, "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function hashEmbeddingIpcRepoRoot(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return createHash("sha256")
    .update(normalizeRepoRootForHash(repoRoot, platform))
    .digest("hex")
    .slice(0, 16);
}

export function getEmbeddingIpcManifestPath(repoRoot: string): string {
  return path.join(repoRoot, ".hf", EMBEDDING_IPC_MANIFEST_FILENAME);
}

export function getPreferredEmbeddingIpcSocketPath(repoRoot: string): string {
  return path.join(repoRoot, ".hf", EMBEDDING_IPC_SOCKET_FILENAME);
}

export function getFallbackEmbeddingIpcSocketPath(
  repoRoot: string,
  tmpdirPath: string = os.tmpdir(),
  platform: NodeJS.Platform = process.platform
): string {
  const repoRootHash = hashEmbeddingIpcRepoRoot(repoRoot, platform);
  return path.join(tmpdirPath, `${EMBEDDING_IPC_PIPE_PREFIX}${repoRootHash}.sock`);
}

export function getEmbeddingIpcPipeName(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform
): string {
  const repoRootHash = hashEmbeddingIpcRepoRoot(repoRoot, platform);
  return `\\\\.\\pipe\\${EMBEDDING_IPC_PIPE_PREFIX}${repoRootHash}`;
}

export function resolveEmbeddingIpcEndpoint(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
  tmpdirPath: string = os.tmpdir()
): EmbeddingIpcEndpointResolution {
  const manifestPath = getEmbeddingIpcManifestPath(repoRoot);
  const repoRootHash = hashEmbeddingIpcRepoRoot(repoRoot, platform);

  if (platform === "win32") {
    return {
      transport: EMBEDDING_IPC_TRANSPORT_NAMED_PIPE,
      endpoint: getEmbeddingIpcPipeName(repoRoot, platform),
      manifestPath,
      repoRootHash,
      usesTmpdirFallback: false,
    };
  }

  const preferredSocketPath = getPreferredEmbeddingIpcSocketPath(repoRoot);
  if (preferredSocketPath.length <= EMBEDDING_IPC_MAX_UNIX_SOCKET_PATH_LENGTH) {
    return {
      transport: EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET,
      endpoint: preferredSocketPath,
      manifestPath,
      repoRootHash,
      usesTmpdirFallback: false,
    };
  }

  return {
    transport: EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET,
    endpoint: getFallbackEmbeddingIpcSocketPath(repoRoot, tmpdirPath, platform),
    manifestPath,
    repoRootHash,
    usesTmpdirFallback: true,
  };
}

export function createEmbeddingIpcManifest(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
  tmpdirPath: string = os.tmpdir()
): EmbeddingIpcManifest {
  const resolved = resolveEmbeddingIpcEndpoint(repoRoot, platform, tmpdirPath);
  return {
    version: EMBEDDING_IPC_PROTOCOL_VERSION,
    transport: resolved.transport,
    endpoint: resolved.endpoint,
  };
}

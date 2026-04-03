import { readFile, stat } from "node:fs/promises";
import net from "node:net";

import {
  EMBEDDING_IPC_CONNECT_TIMEOUT_MS,
  EMBEDDING_IPC_JSONRPC_VERSION,
  EMBEDDING_IPC_METHOD_EMBED,
  EMBEDDING_IPC_METHOD_EMBED_BATCH,
  EMBEDDING_IPC_PROTOCOL_VERSION,
  EMBEDDING_IPC_REQUEST_TIMEOUT_MS,
  type EmbedBatchResponseResult,
  type EmbedResponseResult,
  type EmbeddingIpcManifest,
  type JsonRpcId,
  getEmbeddingIpcManifestPath,
  resolveEmbeddingIpcEndpoint,
} from "./embedding-ipc-protocol.js";
import { isNumber, isRecord, isString } from "./utils.js";

interface CachedManifestEntry {
  mtimeMs: number;
  size: number;
  manifest: EmbeddingIpcManifest | null;
}

type JsonRpcRequest = { jsonrpc: string; id: JsonRpcId; method: string; params: Record<string, unknown> };

const manifestCache = new Map<string, CachedManifestEntry>();

let nextRequestId = 1;

export async function tryIpcEmbed(repoRoot: string, text: string): Promise<number[] | null> {
  const result = await tryIpcRequest(repoRoot, EMBEDDING_IPC_METHOD_EMBED, { text }, isEmbedResponseResult);
  return result?.embedding ?? null;
}

export async function tryIpcEmbedBatch(repoRoot: string, texts: string[]): Promise<number[][] | null> {
  const result = await tryIpcRequest(repoRoot, EMBEDDING_IPC_METHOD_EMBED_BATCH, { texts }, isEmbedBatchResponseResult);
  return result?.embeddings ?? null;
}

async function tryIpcRequest<TResult>(
  repoRoot: string,
  method: typeof EMBEDDING_IPC_METHOD_EMBED | typeof EMBEDDING_IPC_METHOD_EMBED_BATCH,
  params: Record<string, unknown>,
  isExpectedResult: (value: unknown) => value is TResult
// eslint-disable-next-line max-params -- repoRoot, method, params, isExpectedResult are all required for a typed JSON-RPC dispatch; no natural grouping
): Promise<TResult | null> {
  const manifest = await readCachedManifest(repoRoot);
  if (!manifest) {
    return null;
  }

  const expectedTransport = resolveEmbeddingIpcEndpoint(repoRoot).transport;
  if (manifest.transport !== expectedTransport) {
    return null;
  }

  const requestId = nextRequestId++;

  try {
    const response = await sendJsonRpcRequest(manifest, {
      jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
      id: requestId,
      method,
      params,
    });

    if (!isJsonRpcSuccessResponse(response, requestId)) {
      return null;
    }

    return isExpectedResult(response.result) ? response.result : null;
  } catch {
    return null;
  }
}

async function readCachedManifest(repoRoot: string): Promise<EmbeddingIpcManifest | null> {
  const manifestPath = getEmbeddingIpcManifestPath(repoRoot);

  let fileStat;
  try {
    fileStat = await stat(manifestPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      manifestCache.delete(manifestPath);
      return null;
    }
    return null;
  }

  const cached = manifestCache.get(manifestPath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.manifest;
  }

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch {
    manifestCache.delete(manifestPath);
    return null;
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestRaw);
  } catch {
    manifestCache.set(manifestPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, manifest: null });
    return null;
  }

  const manifest = isEmbeddingIpcManifest(manifestValue) ? manifestValue : null;
  manifestCache.set(manifestPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, manifest });
  return manifest;
}

interface ResponseParser {
  onData: (chunk: Buffer) => void;
  onEnd: () => void;
  tryFinish: () => boolean;
}

interface SocketHandlerOpts {
  socket: net.Socket;
  request: JsonRpcRequest;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

function createResponseParser(
  finish: (value: unknown) => void,
  fail: (error: Error) => void,
): ResponseParser {
  let buffer = "";

  const tryFinish = (): boolean => {
    const trimmed = buffer.trim();
    if (!trimmed) return false;
    try {
      finish(JSON.parse(trimmed));
      return true;
    } catch {
      return false;
    }
  };

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    tryFinish();
  };

  const onEnd = () => {
    if (tryFinish()) return;
    fail(new Error("Malformed embedding IPC response"));
  };

  return { onData, onEnd, tryFinish };
}

function attachSocketHandlers(opts: SocketHandlerOpts): void {
  const { socket, request, resolve, reject } = opts;
  const finish = (value: unknown) => { cleanup(); resolve(value); };
  const fail = (error: Error) => { cleanup(); reject(error); };

  const { onData, onEnd } = createResponseParser(finish, fail);

  const onError = (error: Error) => { fail(error); };

  const cleanup = () => {
    clearTimeout(timer);
    socket.off("data", onData);
    socket.off("end", onEnd);
    socket.off("error", onError);
  };

  const timer = setTimeout(() => {
    cleanup();
    socket.destroy();
    reject(new Error(`Timed out waiting for embedding IPC response after ${EMBEDDING_IPC_REQUEST_TIMEOUT_MS}ms`));
  }, EMBEDDING_IPC_REQUEST_TIMEOUT_MS);

  socket.on("data", onData);
  socket.once("end", onEnd);
  socket.once("error", onError);
  socket.write(`${JSON.stringify(request)}\n`, (error?: Error | null) => {
    if (error) fail(error);
  });
}

async function sendJsonRpcRequest(
  manifest: EmbeddingIpcManifest,
  request: JsonRpcRequest,
): Promise<unknown> {
  const socket = await connectToEndpoint(manifest.endpoint);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      attachSocketHandlers({ socket, request, resolve, reject });
    });
  } finally {
    socket.destroy();
  }
}

async function connectToEndpoint(endpoint: string): Promise<net.Socket> {
  return await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection(endpoint);

    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error(`Timed out connecting to embedding IPC endpoint after ${EMBEDDING_IPC_CONNECT_TIMEOUT_MS}ms`));
    }, EMBEDDING_IPC_CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };

    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function isEmbeddingIpcManifest(value: unknown): value is EmbeddingIpcManifest {
  return (
    isRecord(value) &&
    value.version === EMBEDDING_IPC_PROTOCOL_VERSION &&
    isString(value.endpoint) &&
    (value.transport === "named-pipe" || value.transport === "unix-socket")
  );
}

function isJsonRpcSuccessResponse(
  value: unknown,
  requestId: JsonRpcId
): value is { jsonrpc: typeof EMBEDDING_IPC_JSONRPC_VERSION; id: JsonRpcId; result: unknown } {
  return (
    isRecord(value) &&
    value.jsonrpc === EMBEDDING_IPC_JSONRPC_VERSION &&
    value.id === requestId &&
    "result" in value &&
    !("error" in value)
  );
}

function isEmbedResponseResult(value: unknown): value is EmbedResponseResult {
  return isRecord(value) && Array.isArray(value.embedding) && value.embedding.every(isNumber);
}

function isEmbedBatchResponseResult(value: unknown): value is EmbedBatchResponseResult {
  return (
    isRecord(value) &&
    Array.isArray(value.embeddings) &&
    value.embeddings.every(
      (embedding) => Array.isArray(embedding) && embedding.every(isNumber)
    )
  );
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import {
  EMBEDDING_IPC_JSONRPC_VERSION,
  EMBEDDING_IPC_METHOD_EMBED,
  EMBEDDING_IPC_METHOD_EMBED_BATCH,
  EMBEDDING_IPC_PROTOCOL_VERSION,
  EMBEDDING_IPC_SHUTDOWN_TIMEOUT_MS,
  EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET,
  type EmbedBatchRequestParams,
  type EmbedBatchResponseResult,
  type EmbedRequestParams,
  type EmbedResponseResult,
  type EmbeddingIpcManifest,
  type EmbeddingIpcRequest,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
  resolveEmbeddingIpcEndpoint,
} from "./embedding-ipc-protocol.js";
import { embed, embedBatch } from "./vault-embeddings.js";
import { isNumber, isRecord, isString } from "./utils.js";

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_INTERNAL_ERROR = -32603;

export interface EmbeddingIpcServerHandle {
  readonly repoRoot: string;
  readonly transport: EmbeddingIpcManifest["transport"];
  readonly endpoint: string;
  readonly manifestPath: string;
  close(): Promise<void>;
}

class EmbeddingIpcServer implements EmbeddingIpcServerHandle {
  private readonly ownedSocketPath: string | null;
  private closed = false;

  constructor(
    readonly repoRoot: string,
    readonly transport: EmbeddingIpcManifest["transport"],
    readonly endpoint: string,
    readonly manifestPath: string,
    private readonly server: net.Server
   
  ) {
    this.ownedSocketPath = transport === EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET ? endpoint : null;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const manifestCleanup = removeFileIfPresent(this.manifestPath);
    const closeServer = closeServerWithTimeout(this.server, EMBEDDING_IPC_SHUTDOWN_TIMEOUT_MS);
    await Promise.allSettled([manifestCleanup, closeServer]);

    if (this.ownedSocketPath) {
      await removeFileIfPresent(this.ownedSocketPath);
    }
  }
}

export async function startEmbeddingIpcServer(repoRoot: string): Promise<EmbeddingIpcServerHandle> {
  const resolved = resolveEmbeddingIpcEndpoint(repoRoot);
  const manifestDir = path.dirname(resolved.manifestPath);

  await mkdir(manifestDir, { recursive: true });
  await recoverStaleManifest(resolved.manifestPath);
  await recoverStaleEndpoint(resolved.transport, resolved.endpoint);

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    handleConnection(socket).catch(() => {
      socket.destroy();
    });
  });

  try {
    await listenOnEndpoint(server, resolved.endpoint);
  } catch (error) {
    if (await isLiveEndpoint(resolved.transport, resolved.endpoint)) {
      throw new Error(`Embedding IPC server already running for repo: ${repoRoot}`);
    }

    if (resolved.transport === EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET) {
      await removeFileIfPresent(resolved.endpoint);
    }
    throw error;
  }

  try {
    await writeManifestAtomically(resolved.manifestPath, {
      version: EMBEDDING_IPC_PROTOCOL_VERSION,
      transport: resolved.transport,
      endpoint: resolved.endpoint,
    });
  } catch (error) {
    await closeServerWithTimeout(server, EMBEDDING_IPC_SHUTDOWN_TIMEOUT_MS).catch(() => undefined);
    if (resolved.transport === EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET) {
      await removeFileIfPresent(resolved.endpoint);
    }
    throw error;
  }

  return new EmbeddingIpcServer(
    repoRoot,
    resolved.transport,
    resolved.endpoint,
    resolved.manifestPath,
    server,
  );
}

async function handleConnection(socket: net.Socket): Promise<void> {
  const raw = await readOneRequest(socket);
  const response = await createResponse(raw);

  await new Promise<void>((resolve, reject) => {
    socket.on("error", reject);
    socket.end(JSON.stringify(response), (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function readOneRequest(socket: net.Socket): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };

    const settle = (value: string) => {
      cleanup();
      resolve(value);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const tryResolveRequest = (): boolean => {
      const request = extractCompleteRequest(buffer);
      if (request === null) {
        return false;
      }

      settle(request);
      return true;
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      tryResolveRequest();
    };

    const onEnd = () => {
      if (tryResolveRequest()) {
        return;
      }

      settle(buffer.trim());
    };

    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  });
}

function extractCompleteRequest(buffer: string): string | null {
  const trimmed = buffer.trim();
  if (!trimmed) {
    return null;
  }

  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    if (!line) {
      return null;
    }

    try {
      JSON.parse(line);
      return line;
    } catch {
      return line;
    }
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

async function createResponse(raw: string): Promise<JsonRpcResponse<EmbedResponseResult | EmbedBatchResponseResult>> {
  if (!raw) {
    return createErrorResponse(null, JSON_RPC_INVALID_REQUEST, "Missing JSON-RPC request body");
  }

  let requestValue: unknown;
  try {
    requestValue = JSON.parse(raw);
  } catch {
    return createErrorResponse(null, JSON_RPC_PARSE_ERROR, "Parse error");
  }

  if (!isEmbeddingIpcRequest(requestValue)) {
    const id = getRequestId(requestValue);
    return createErrorResponse(id, JSON_RPC_INVALID_REQUEST, "Invalid request");
  }

  try {
    if (requestValue.method === EMBEDDING_IPC_METHOD_EMBED) {
      const params = requestValue.params as EmbedRequestParams;
      const embedding = await embed(params.text);
      return createSuccessResponse(requestValue.id, { embedding });
    }

    const params = requestValue.params as EmbedBatchRequestParams;
    const embeddings = await embedBatch(params.texts);
    return createSuccessResponse(requestValue.id, { embeddings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return createErrorResponse(requestValue.id, JSON_RPC_INTERNAL_ERROR, message);
  }
}

function createSuccessResponse<TResult>(id: JsonRpcId, result: TResult): JsonRpcSuccessResponse<TResult> {
  return {
    jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
    id,
    result,
  };
}

function createErrorResponse(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return {
    jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
    id,
    error: { code, message },
  };
}

function isEmbeddingIpcRequest(value: unknown): value is EmbeddingIpcRequest {
  if (!isRecord(value)) return false;
  if (value.jsonrpc !== EMBEDDING_IPC_JSONRPC_VERSION) return false;
  if (!("id" in value) || !isJsonRpcId(value.id)) return false;
  if (value.method === EMBEDDING_IPC_METHOD_EMBED) {
    return isEmbedRequestParams(value.params);
  }
  if (value.method === EMBEDDING_IPC_METHOD_EMBED_BATCH) {
    return isEmbedBatchRequestParams(value.params);
  }
  return false;
}

function isEmbedRequestParams(value: unknown): value is EmbedRequestParams {
  return isRecord(value) && isString(value.text);
}

function isEmbedBatchRequestParams(value: unknown): value is EmbedBatchRequestParams {
  return isRecord(value) && Array.isArray(value.texts) && value.texts.every(isString);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || isNumber(value) || isString(value);
}

function getRequestId(value: unknown): JsonRpcId {
  if (!isRecord(value) || !("id" in value) || !isJsonRpcId(value.id)) {
    return null;
  }
  return value.id;
}

async function listenOnEndpoint(server: net.Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

async function recoverStaleManifest(manifestPath: string): Promise<void> {
  const manifest = await readManifest(manifestPath);
  if (!manifest) return;

  if (await isLiveEndpoint(manifest.transport, manifest.endpoint)) {
    return;
  }

  await removeFileIfPresent(manifestPath);
  if (manifest.transport === EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET) {
    await removeFileIfPresent(manifest.endpoint);
  }
}

async function recoverStaleEndpoint(
  transport: EmbeddingIpcManifest["transport"],
  endpoint: string
): Promise<void> {
  if (await isLiveEndpoint(transport, endpoint)) {
    throw new Error(`Embedding IPC endpoint already active: ${endpoint}`);
  }

  if (transport !== EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET) {
    return;
  }

  if (!(await pathExists(endpoint))) {
    return;
  }

  await removeFileIfPresent(endpoint);
}

async function readManifest(manifestPath: string): Promise<EmbeddingIpcManifest | null> {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestRaw);
  } catch {
    await removeFileIfPresent(manifestPath);
    return null;
  }

  if (!isEmbeddingIpcManifest(manifestValue)) {
    await removeFileIfPresent(manifestPath);
    return null;
  }

  return manifestValue;
}

function isEmbeddingIpcManifest(value: unknown): value is EmbeddingIpcManifest {
  return (
    isRecord(value) &&
    value.version === EMBEDDING_IPC_PROTOCOL_VERSION &&
    isString(value.endpoint) &&
    (value.transport === "named-pipe" || value.transport === EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET)
  );
}

async function writeManifestAtomically(manifestPath: string, manifest: EmbeddingIpcManifest): Promise<void> {
  const tempPath = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tempPath, manifestPath);
}

async function isLiveEndpoint(
  transport: EmbeddingIpcManifest["transport"],
  endpoint: string
): Promise<boolean> {
  if (transport === EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET && !(await pathExists(endpoint))) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint);

    const finish = (live: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(live);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function closeServerWithTimeout(server: net.Server, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out closing embedding IPC server after ${timeoutMs}ms`));
    }, timeoutMs);

    server.close((error?: Error | null) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return;
    if (isDirectoryError(error)) {
      await rm(filePath, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EISDIR";
}

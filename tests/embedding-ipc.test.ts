import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  EMBEDDING_IPC_JSONRPC_VERSION,
  EMBEDDING_IPC_METHOD_EMBED,
  EMBEDDING_IPC_METHOD_EMBED_BATCH,
  EMBEDDING_IPC_PROTOCOL_VERSION,
  EMBEDDING_IPC_TRANSPORT_NAMED_PIPE,
  EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET,
  createEmbeddingIpcManifest,
  resolveEmbeddingIpcEndpoint,
} from "../src/index/embedding-ipc-protocol.js";
import { isNumber } from "../src/runtime/utils.js";

function makeVector(seed: number): number[] {
  return Array.from({ length: 384 }, (_value, index) => seed + index / 1000);
}

function makeExtractorOutput(values: number[][]): { data: Float32Array } {
  return { data: Float32Array.from(values.flat()) };
}

function createMockExtractor() {
  const extractor = vi.fn(async (input: string | string[]) => {
    if (Array.isArray(input)) {
      return makeExtractorOutput(input.map((_text, index) => makeVector(index + 1)));
    }
    return makeExtractorOutput([makeVector(1)]);
  });

  return Object.assign(extractor, {
    dispose: vi.fn(async () => undefined),
  });
}

function expectVectorClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index] ?? 0, 5);
  }
}

function expectBatchClose(actual: number[][], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expectVectorClose(actual[index] ?? [], expected[index] ?? []);
  }
}

async function createRepoRoot(prefix: string): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(repoRoot, ".hf"), { recursive: true });
  return repoRoot;
}

async function sendJsonRpcRequest(endpoint: string, request: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let buffer = "";

    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
    });
    socket.once("end", () => {
      try {
        resolve(JSON.parse(buffer.trim()));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("connect", () => {
      socket.end(`${JSON.stringify(request)}\n`);
    });
  });
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await stat(filePath);
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for file: ${filePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function startMcpServer(repoRoot: string): Promise<{
  child: ReturnType<typeof spawn>;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}> {
  const mcpBin = path.join(process.cwd(), "dist", "src", "bin", "hf-mcp-server.js");
  await stat(mcpBin);

  const child = spawn(process.execPath, [mcpBin], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  type PendingMap = Map<number, { resolve(value: unknown): void; reject(error: Error): void }>;

  function dispatchMcpLine(
    line: string,
    pending: PendingMap
  ): void {
    const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
    const id = isNumber(message.id) ? message.id : null;
    if (id === null) return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (message.error) {
      entry.reject(new Error(message.error.message));
    } else {
      entry.resolve(message.result);
    }
  }

  let nextId = 1;
  let stdoutBuffer = "";
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      dispatchMcpLine(line, pending);
    }
  });

  child.once("exit", (code, signal) => {
    for (const entry of pending.values()) {
      entry.reject(new Error(`hf-mcp-server exited before responding (code=${code}, signal=${signal})`));
    }
    pending.clear();
  });

  return {
    child,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    },
  };
}

async function runFreshHookEmbed(
  repoRoot: string,
  text: string,
  mode: "ipc" | "cold-local" = "ipc",
): Promise<{ durationMs: number; length: number }> {
  const embedModulePath = path.join(process.cwd(), "dist", "src", "index", "vault-embeddings.js");
  const embedModuleUrl = pathToFileURL(embedModulePath).href;
  await stat(embedModulePath);

  const start = Date.now();
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        'const [embedModuleUrl, repoRoot, text, mode] = process.argv.slice(-4);',
        'const { embed, setEmbeddingIpcRoot } = await import(embedModuleUrl);',
        'setEmbeddingIpcRoot(mode === "ipc" ? repoRoot : null);',
        'const vec = await embed(text);',
        'process.stdout.write(JSON.stringify({ length: vec.length }));',
      ].join(" "),
      embedModuleUrl,
      repoRoot,
      text,
      mode,
    ],
    { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    const errorDetail = stderr || `exit ${exitCode}`;
    throw new Error(`Fresh hook embed failed: ${errorDetail}`);
  }

  return {
    durationMs: Date.now() - start,
    length: (JSON.parse(stdout) as { length: number }).length,
  };
}

async function closeChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.stdin?.end();
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@huggingface/transformers");
  vi.doUnmock("../src/index/embedding-ipc-client.js");
  vi.doUnmock("../src/index/vault-embeddings.js");
});

describe("embedding IPC protocol", () => {
  test("resolves deterministic platform-specific endpoints and manifest metadata", async () => {
    const repoRoot = await createRepoRoot("hf-embedding-ipc-protocol-");

    const win32 = resolveEmbeddingIpcEndpoint(repoRoot, "win32");
    expect(win32.transport).toBe(EMBEDDING_IPC_TRANSPORT_NAMED_PIPE);
    expect(win32.endpoint).toContain("\\\\.\\pipe\\hf-embed-");
    expect(win32.manifestPath).toBe(path.join(repoRoot, ".hf", "embed-ipc.json"));

    const longRepoRoot = path.join(repoRoot, "nested".repeat(30));
    const posix = resolveEmbeddingIpcEndpoint(longRepoRoot, "linux", os.tmpdir());
    expect(posix.transport).toBe(EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET);
    expect(posix.endpoint.endsWith(".sock")).toBe(true);
    expect(posix.usesTmpdirFallback).toBe(true);

    expect(createEmbeddingIpcManifest(repoRoot, "win32")).toEqual({
      version: EMBEDDING_IPC_PROTOCOL_VERSION,
      transport: EMBEDDING_IPC_TRANSPORT_NAMED_PIPE,
      endpoint: win32.endpoint,
    });

    await rm(repoRoot, { recursive: true, force: true });
  });
});

describe("embedding IPC behavior", () => {
  test("serves embed/embedBatch over JSON-RPC and client round-trips the shared protocol", async () => {
    const repoRoot = await createRepoRoot("hf-embedding-ipc-server-");

    const embed = vi.fn(async (text: string) => [text.length, 1, 2]);
    const embedBatch = vi.fn(async (texts: string[]) => texts.map((text, index) => [text.length, index]));
    vi.doMock("../src/index/vault-embeddings.js", () => ({ embed, embedBatch }));

    const { startEmbeddingIpcServer } = await import("../src/index/embedding-ipc-server.js");
    const { tryIpcEmbed, tryIpcEmbedBatch } = await import("../src/index/embedding-ipc-client.js");

    const server = await startEmbeddingIpcServer(repoRoot);
    try {
      const manifest = JSON.parse(await readFile(server.manifestPath, "utf8")) as {
        version: number;
        transport: string;
        endpoint: string;
      };
      expect(manifest).toEqual({
        version: EMBEDDING_IPC_PROTOCOL_VERSION,
        transport: server.transport,
        endpoint: server.endpoint,
      });

      await expect(
        sendJsonRpcRequest(server.endpoint, {
          jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
          id: "embed-1",
          method: EMBEDDING_IPC_METHOD_EMBED,
          params: { text: "hello" },
        }),
      ).resolves.toEqual({
        jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
        id: "embed-1",
        result: { embedding: [5, 1, 2] },
      });

      await expect(
        sendJsonRpcRequest(server.endpoint, {
          jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
          id: 2,
          method: EMBEDDING_IPC_METHOD_EMBED_BATCH,
          params: { texts: ["a", "bb"] },
        }),
      ).resolves.toEqual({
        jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
        id: 2,
        result: { embeddings: [[1, 0], [2, 1]] },
      });

      await expect(
        sendJsonRpcRequest(server.endpoint, {
          jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
          id: 3,
          method: "unknownMethod",
          params: {},
        }),
      ).resolves.toEqual({
        jsonrpc: EMBEDDING_IPC_JSONRPC_VERSION,
        id: 3,
        error: { code: -32600, message: "Invalid request" },
      });

      await expect(tryIpcEmbed(repoRoot, "hook text")).resolves.toEqual([9, 1, 2]);
      await expect(tryIpcEmbedBatch(repoRoot, ["x", "yz"])).resolves.toEqual([[1, 0], [2, 1]]);
      expect(embed).toHaveBeenCalledWith("hello");
      expect(embedBatch).toHaveBeenCalledWith(["a", "bb"]);
    } finally {
      await server.close();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("falls back to the local model path when IPC is unavailable", async () => {
    const repoRoot = await createRepoRoot("hf-embedding-ipc-fallback-");

    const tryIpcEmbed = vi.fn(async () => null);
    const tryIpcEmbedBatch = vi.fn(async () => null);
    const extractor = createMockExtractor();
    const pipeline = vi.fn(async () => extractor);

    vi.doMock("@huggingface/transformers", () => ({ pipeline }));
    vi.doMock("../src/index/embedding-ipc-client.js", () => ({ tryIpcEmbed, tryIpcEmbedBatch }));
    vi.doUnmock("../src/index/vault-embeddings.js");

    const { embed, setEmbeddingIpcRoot } = await import("../src/index/vault-embeddings.js");

    setEmbeddingIpcRoot(repoRoot);

    expectVectorClose(await embed("fallback text"), makeVector(1));
    expect(tryIpcEmbed).toHaveBeenCalledWith(repoRoot, "fallback text");
    expect(pipeline).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const tryIpcEmbedSecond = vi.fn(async () => null);
    const tryIpcEmbedBatchSecond = vi.fn(async () => null);
    const extractorSecond = createMockExtractor();
    const pipelineSecond = vi.fn(async () => extractorSecond);

    vi.doMock("@huggingface/transformers", () => ({ pipeline: pipelineSecond }));
    vi.doMock("../src/index/embedding-ipc-client.js", () => ({
      tryIpcEmbed: tryIpcEmbedSecond,
      tryIpcEmbedBatch: tryIpcEmbedBatchSecond,
    }));
    vi.doUnmock("../src/index/vault-embeddings.js");

    const batchModule = await import("../src/index/vault-embeddings.js");
    batchModule.setEmbeddingIpcRoot(repoRoot);
    expectBatchClose(await batchModule.embedBatch(["one", "two"]), [makeVector(1), makeVector(2)]);
    expect(tryIpcEmbedBatchSecond).toHaveBeenCalledWith(repoRoot, ["one", "two"]);
    expect(pipelineSecond).toHaveBeenCalledTimes(1);

    await rm(repoRoot, { recursive: true, force: true });
  });

  test("uses the warm in-process fast path without attempting IPC", async () => {
    const repoRoot = await createRepoRoot("hf-embedding-ipc-fast-path-");

    const tryIpcEmbed = vi.fn(async () => {
      throw new Error("IPC should not be attempted once extractor is warm");
    });
    const tryIpcEmbedBatch = vi.fn(async () => {
      throw new Error("IPC should not be attempted once extractor is warm");
    });
    const extractor = createMockExtractor();
    const pipeline = vi.fn(async () => extractor);

    vi.doMock("@huggingface/transformers", () => ({ pipeline }));
    vi.doMock("../src/index/embedding-ipc-client.js", () => ({ tryIpcEmbed, tryIpcEmbedBatch }));
    vi.doUnmock("../src/index/vault-embeddings.js");

    const { embed, embedBatch, setEmbeddingIpcRoot } = await import("../src/index/vault-embeddings.js");

    expectVectorClose(await embed("warmup"), makeVector(1));
    setEmbeddingIpcRoot(repoRoot);
    expectBatchClose(await embedBatch(["still", "warm"]), [makeVector(1), makeVector(2)]);

    expect(tryIpcEmbed).not.toHaveBeenCalled();
    expect(tryIpcEmbedBatch).not.toHaveBeenCalled();
    expect(pipeline).toHaveBeenCalledTimes(1);

    await rm(repoRoot, { recursive: true, force: true });
  });
});

describe.skipIf(!process.env.HF_RUN_SLOW)("embedding IPC slow integration", () => {
  test("keeps fresh Claude-style hook embeds on the warm MCP IPC path and still fail-opens after shutdown", async () => {
    const repoRoot = await createRepoRoot("hf-embedding-ipc-slow-");
    const manifestPath = path.join(repoRoot, ".hf", "embed-ipc.json");

    const mcp = await startMcpServer(repoRoot);
    try {
      await mcp.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" },
      });
      await mcp.request("tools/call", {
        name: "hf_search",
        arguments: { query: "warm embedding IPC", top_k: 1 },
      });

      await waitForFile(manifestPath, 10_000);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { transport: string; endpoint: string };
      expect([EMBEDDING_IPC_TRANSPORT_NAMED_PIPE, EMBEDDING_IPC_TRANSPORT_UNIX_SOCKET]).toContain(manifest.transport);
      expect(manifest.endpoint).toBeTypeOf("string");

      const first = await runFreshHookEmbed(repoRoot, "Claude hook request one");
      const second = await runFreshHookEmbed(repoRoot, "Claude hook request two");
      const coldLocal = await runFreshHookEmbed(repoRoot, "Claude hook forced cold load", "cold-local");

      expect(first.length).toBe(384);
      expect(second.length).toBe(384);
      expect(coldLocal.length).toBe(384);
      expect(first.durationMs).toBeLessThan(4_000);
      expect(second.durationMs).toBeLessThan(4_000);
      expect(Math.max(first.durationMs, second.durationMs)).toBeLessThan(coldLocal.durationMs);
    } finally {
      await closeChild(mcp.child);
    }

    await expect(runFreshHookEmbed(repoRoot, "fallback after IPC shutdown")).resolves.toMatchObject({ length: 384 });
    await rm(repoRoot, { recursive: true, force: true });
  }, 180_000);
});

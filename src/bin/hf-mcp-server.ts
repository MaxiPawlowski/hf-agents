#!/usr/bin/env node
import readline from "node:readline";

import { HybridLoopRuntime } from "../runtime/runtime.js";
import { formatToolSearchResults } from "../prompt/prompt.js";
import { resolveLastActivePlanPath } from "../runtime/persistence.js";
import { isNumber, isString } from "../runtime/utils.js";

// ---------------------------------------------------------------------------
// Minimal JSON-RPC 2.0 / MCP stdio server — no external SDK dependency
// ---------------------------------------------------------------------------

const HF_SEARCH_TOOL = {
  name: "hf_search",
  description:
    "Search the hybrid framework's unified semantic index (vault docs, code, and external files). Optionally filter by source: 'vault' for documentation, 'code' for source code, 'all' (default) for everything.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language search query"
      },
      top_k: {
        type: "number",
        description: "Number of results to return (default: 5)"
      },
      source: {
        type: "string",
        enum: ["vault", "code", "all"],
        description:
          "Source filter: 'vault' for documentation only, 'code' for source code only, 'all' for everything (default: 'all')"
      }
    },
    required: ["query"]
  }
};

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

function respond(id: JsonRpcId, result: unknown): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  process.stdout.write(`${JSON.stringify(response)  }\n`);
}

function respondError(id: JsonRpcId, code: number, message: string): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  process.stdout.write(`${JSON.stringify(response)  }\n`);
}

// ---------------------------------------------------------------------------
// JSON-RPC error codes
// ---------------------------------------------------------------------------

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;

// ---------------------------------------------------------------------------
// Runtime factory
// ---------------------------------------------------------------------------

function buildRuntimeFactory(cwd: string): () => Promise<HybridLoopRuntime> {
  let runtime: HybridLoopRuntime | null = null;

  return async (): Promise<HybridLoopRuntime> => {
    if (runtime) return runtime;

    const rt = new HybridLoopRuntime();
    const planPath = await resolveLastActivePlanPath(cwd);
    if (planPath) {
      try {
        await rt.hydrate(planPath);
        runtime = rt;
        return runtime;
      // eslint-disable-next-line no-inline-comments -- empty catch intentionally falls through to planless hydration
      } catch { /* fall through to planless */ }
    }
    await rt.hydratePlanless(cwd);
    runtime = rt;
    return runtime;
  };
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

const DEFAULT_TOP_K = 5;

function handleToolCall(
  id: number | string | null,
  args: Record<string, unknown>,
  getRuntime: () => Promise<HybridLoopRuntime>
): void {
  const query = isString(args["query"]) ? args["query"] : "";
  if (!query) {
    respondError(id, JSONRPC_INVALID_PARAMS, "Missing required parameter: query");
    return;
  }

  const topK =
    isNumber(args["top_k"])
      ? args["top_k"]
      : DEFAULT_TOP_K;

  const sourceArg = args["source"];
  let sourceFilter: "vault" | "code" | undefined;
  if (sourceArg === "vault") sourceFilter = "vault";
  else if (sourceArg === "code") sourceFilter = "code";

  getRuntime()
    .then(async (rt) => {
      const results = await rt.queryIndex(query, topK, sourceFilter);
      let text: string;
      if (results === null) {
        text = "No index available — the on-demand index build returned no results. Try again or check the runtime logs.";
      } else if (results.length === 0) {
        text = "No results found.";
      } else {
        text = formatToolSearchResults(results);
      }
      respond(id, { content: [{ type: "text", text }] });
    })
    .catch((err: unknown) => {
      const reason = String(err instanceof Error ? err.message : err);
      respond(id, { content: [{ type: "text", text: `Index build failed: ${reason}. Try again or check the runtime logs.` }] });
    });
}

function handleLine(line: string, getRuntime: () => Promise<HybridLoopRuntime>): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    respondError(null, JSONRPC_PARSE_ERROR, "Parse error");
    return;
  }

  const id = req.id ?? null;
  const {method} = req;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "hf-mcp-server", version: "1.0.0" },
      capabilities: { tools: {} }
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    respond(id, { tools: [HF_SEARCH_TOOL] });
    return;
  }

  if (method === "tools/call") {
    const params = req.params ?? {};
    const name = params["name"] as string | undefined;

    if (name !== "hf_search") {
      respondError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${name ?? "(none)"}`);
      return;
    }

    const args = (params["arguments"] ?? {}) as Record<string, unknown>;
    handleToolCall(id, args, getRuntime);
    return;
  }

  respondError(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const getRuntime = buildRuntimeFactory(process.cwd());
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (line: string) => {
    handleLine(line, getRuntime);
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`hf-mcp-server fatal: ${(error as Error).message}\n`);
  process.exit(1);
});

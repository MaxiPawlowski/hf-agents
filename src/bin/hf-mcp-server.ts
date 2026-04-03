#!/usr/bin/env node
import readline from "node:readline";

import { HybridLoopRuntime } from "../runtime/runtime.js";
import { formatToolSearchResults } from "../runtime/prompt.js";
import { resolveLastActivePlanPath } from "../runtime/persistence.js";

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

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function respond(id: number | string | null, result: unknown): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(response) + "\n");
}

function respondError(id: number | string | null, code: number, message: string): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  process.stdout.write(JSON.stringify(response) + "\n");
}

// oxlint-disable max-lines-per-function -- MCP server main and its rl.on("line") dispatcher are minimal request-routing logic that cannot be meaningfully split
async function main(): Promise<void> {
  let runtime: HybridLoopRuntime | null = null;

  async function getRuntime(): Promise<HybridLoopRuntime> {
    if (runtime) return runtime;

    const rt = new HybridLoopRuntime();
    const planPath = await resolveLastActivePlanPath(process.cwd());
    if (planPath) {
      try {
        await rt.hydrate(planPath);
        runtime = rt;
        return runtime;
      } catch { /* fall through to planless */ }
    }
    await rt.hydratePlanless(process.cwd());
    runtime = rt;
    return runtime;
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      respondError(null, -32700, "Parse error");
      return;
    }

    const id = req.id ?? null;
    const method = req.method;

    if (method === "initialize") {
      respond(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "hf-mcp-server", version: "1.0.0" },
        capabilities: { tools: {} }
      });
      return;
    }

    if (method === "notifications/initialized") {
      // No response for notifications
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
        respondError(id, -32601, `Unknown tool: ${name ?? "(none)"}`);
        return;
      }

      const args = (params["arguments"] ?? {}) as Record<string, unknown>;
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (!query) {
        respondError(id, -32602, "Missing required parameter: query");
        return;
      }

      const topK =
        typeof args["top_k"] === "number" && !Number.isNaN(args["top_k"])
          ? (args["top_k"] as number)
          : 5;

      const sourceArg = args["source"];
      let sourceFilter: "vault" | "code" | undefined;
      if (sourceArg === "vault") sourceFilter = "vault";
      else if (sourceArg === "code") sourceFilter = "code";

      getRuntime()
        .then(async (rt) => {
          const results = await rt.queryIndex(query, topK, sourceFilter);
          let text: string;
          if (results === null) {
            text = "No index available — the unified index has not been built yet for this session.";
          } else if (results.length === 0) {
            text = "No results found.";
          } else {
            text = formatToolSearchResults(results);
          }
          respond(id, { content: [{ type: "text", text }] });
        })
        .catch((err: unknown) => {
          respondError(id, -32603, `Internal error: ${(err as Error).message}`);
        });

      return;
    }

    respondError(id, -32601, `Method not found: ${method}`);
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`hf-mcp-server fatal: ${(error as Error).message}\n`);
  process.exit(1);
});

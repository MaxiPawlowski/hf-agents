import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

import { hydrateRuntimeWithTimeout } from "../adapters/lifecycle.js";
import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { parsePlan } from "../runtime/plan-doc.js";
import { hfLog } from "../runtime/logger.js";
import { formatToolSearchResults } from "../runtime/prompt.js";
import {
  type ToolContext,
  type OpenCodePluginContext
} from "./plugin-utils.js";
import type { SessionManager } from "./plugin-session.js";

/**
 * Lazily load `z` from the bundled zod that ships with @opencode-ai/plugin.
 *
 * The plugin package lives in .opencode/node_modules/ which is NOT on the
 * normal Node resolution path, so we cannot add it as a compile-time dep.
 * We use createRequire + the zod CJS entry to get a synchronous handle on z.
 *
 * The .opencode/node_modules/zod package ships both ESM (index.js) and CJS
 * (index.cjs); we target the CJS file so that createRequire works regardless
 * of the host module format.  The exported object shape is { z, core, ... }
 * so we pull `.z` off it.
 */
const _req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports
const _zodMod = _req(
  path.resolve(process.cwd(), ".opencode", "node_modules", "zod", "index.cjs")
) as {
  z: {
    string(): { describe(s: string): { optional(): unknown } };
    number(): { describe(s: string): { optional(): unknown } };
  }
};
// pluginZ is the `z` export — used only to build the hf_plan_start args schema.
const pluginZ = _zodMod.z;

const SEARCH_TIMEOUT_MS = 15_000;

type SearchArgs = { query: string; top_k?: number; source?: string };

async function listAvailablePlans(baseDir: string): Promise<string[]> {
  const plansDir = path.join(baseDir, "plans");
  try {
    const entries = await fs.readdir(plansDir);
    return entries
      .filter((name) => name.endsWith("-plan.md"))
      .map((name) => `plans/${name}`);
  } catch {
    return [];
  }
}

async function resolvePlanPath(planArg: string, baseDir: string): Promise<string> {
  if (planArg.includes("/") || planArg.includes("\\") || planArg.endsWith(".md")) {
    const resolved = path.resolve(baseDir, planArg);
    try {
      await fs.access(resolved);
    } catch {
      const available = await listAvailablePlans(baseDir);
      const listStr = available.length > 0
        ? available.map((p) => `  - ${p}`).join("\n")
        : "  (no plans found)";
      throw new Error(`Plan file not found: ${planArg}\n\nAvailable plans:\n${listStr}`);
    }
    return resolved;
  }

  const plansDir = path.join(baseDir, "plans");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(plansDir);
  } catch {
    throw new Error(`Could not read plans/ directory at ${plansDir}. Make sure you are running from the project root.`);
  }

  const candidates = entries.filter((name) => {
    const lower = name.toLowerCase();
    return lower.includes(planArg.toLowerCase()) && lower.endsWith("-plan.md");
  });

  if (candidates.length === 0) {
    const allPlans = entries.filter((name) => name.endsWith("-plan.md"));
    const listStr = allPlans.length > 0
      ? allPlans.map((p) => `  - plans/${p}`).join("\n")
      : "  (no plan files found in plans/)";
    throw new Error(`No plan found matching "${planArg}".\n\nAvailable plans:\n${listStr}`);
  }

  if (candidates.length > 1) {
    const listStr = candidates.map((p) => `  - plans/${p}`).join("\n");
    throw new Error(`Ambiguous plan slug "${planArg}" — matches ${candidates.length} files. Be more specific:\n${listStr}`);
  }

  return path.join(plansDir, candidates[0]!);
}

async function buildPlanSummary(resolvedPath: string, manager: SessionManager, sessionId: string): Promise<string> {
  const runtime = await manager.getRuntime(sessionId);
  if (!runtime || runtime.isPlanless()) {
    return `Plan bound: ${resolvedPath}\n(Runtime hydration returned planless or null — check plan doc format.)`;
  }

  const status = runtime.getStatus();
  try {
    const parsed = await parsePlan(resolvedPath);
    const planTitle =
      parsed.milestones.length > 0 && parsed.userIntent
        ? (parsed.userIntent.split("\n")[0]?.trim() ?? path.basename(resolvedPath))
        : path.basename(resolvedPath);
    const totalMilestones = parsed.milestones.length;
    const currentIdx = parsed.currentMilestone?.index ?? null;
    const currentTitle = parsed.currentMilestone?.title ?? "(all complete)";
    return [
      `Plan bound: ${resolvedPath}`,
      `Title: ${planTitle}`,
      `Status: ${parsed.status}`,
      `Loop state: ${status.loopState}`,
      `Current milestone: ${currentIdx !== null ? `M${currentIdx} — ${currentTitle}` : "(all complete)"}`,
      `Total milestones: ${totalMilestones} (${parsed.milestones.filter((m) => m.checked).length} complete)`
    ].join("\n");
  } catch {
    return [
      `Plan bound: ${resolvedPath}`,
      `Loop state: ${status.loopState}`
    ].join("\n");
  }
}

type SearchParams = { cwd: string; sessionId: string; getRuntime: (id: string) => Promise<HybridLoopRuntime | null> };

async function executeSearchQuery(
  args: SearchArgs,
  params: SearchParams
): Promise<string> {
  const query = args.query ?? "";
  const topK = args.top_k !== undefined ? args.top_k : undefined;
  const sourceArg = args.source;
  let sourceFilter: "vault" | "code" | undefined;
  if (sourceArg === "vault") sourceFilter = "vault";
  else if (sourceArg === "code") sourceFilter = "code";

  let runtime = await params.getRuntime(params.sessionId);

  if (!runtime) {
    try {
      runtime = await hydrateRuntimeWithTimeout({
        cwd: params.cwd,
        timeoutMs: SEARCH_TIMEOUT_MS,
        timeoutMessage: "Runtime hydration timed out",
        tag: "plugin/hf_search",
      });
    } catch {
      return "No index available — the unified index has not been built yet for this session.";
    }
  }

  const results = await runtime.queryIndex(query, topK, sourceFilter);
  if (results === null) {
    return "No index available — the unified index has not been built yet for this session.";
  }
  return formatToolSearchResults(results);
}

export function createPluginTools(context: OpenCodePluginContext, manager: SessionManager): Record<string, unknown> {
  const { sessionRuntimes, planBindings, sessionAccessOrder } = manager;

  const hfPlanStartTool = {
    description: "Bind this OpenCode session to a specific hybrid-framework plan doc. Call this at the start of every builder or planner session before running any plan milestones. Pass a plan slug (e.g. 'my-feature') or a relative path (e.g. 'plans/2026-03-27-my-feature-plan.md').",
    args: {
      plan: pluginZ.string().describe("Plan slug or relative path (e.g. 'my-feature' or 'plans/2026-03-27-my-feature-plan.md')")
    },
    execute: async (args: { plan: string }, toolContext: ToolContext): Promise<string> => {
      const planArg = args.plan ?? "";
      let resolvedPath: string;
      try {
        resolvedPath = await resolvePlanPath(planArg, toolContext.directory);
      } catch (err) {
        return `Error: ${String(err instanceof Error ? err.message : err)}`;
      }
      const sessionId = toolContext.sessionID;
      planBindings.set(sessionId, resolvedPath);
      sessionRuntimes.delete(sessionId);
      const orderIdx = sessionAccessOrder.indexOf(sessionId);
      if (orderIdx !== -1) sessionAccessOrder.splice(orderIdx, 1);
      hfLog({ tag: "plugin", msg: "hf_plan_start: plan bound", data: { sessionId, resolvedPath } });
      try {
        return await buildPlanSummary(resolvedPath, manager, sessionId);
      } catch (err) {
        return `Plan bound: ${resolvedPath}\n(Warning: runtime hydration failed: ${String(err)})`;
      }
    }
  };

  const hfSearchTool = {
    description: "Search the hybrid framework's unified semantic index (vault docs, code, and external files). Optionally filter by source: 'vault' for documentation, 'code' for source code, 'all' (default) for everything.",
    args: {
      query: pluginZ.string().describe("Natural language search query"),
      top_k: pluginZ.number().describe("Number of results to return (default: 5)").optional(),
      source: pluginZ.string().describe("Source filter: 'vault' for documentation only, 'code' for source code only, 'all' for everything (default: 'all')").optional()
    },
    execute: async (args: SearchArgs, toolContext: ToolContext): Promise<string> => {
      try {
        return await executeSearchQuery(args, {
          cwd: context.cwd ?? toolContext.directory,
          sessionId: toolContext.sessionID,
          getRuntime: manager.getRuntime
        });
      } catch (err) {
        return `Error querying index: ${String(err)}`;
      }
    }
  };

  return { hf_plan_start: hfPlanStartTool, hf_search: hfSearchTool };
}

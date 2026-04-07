import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

import { hydrateRuntimeWithTimeout } from "../adapters/lifecycle.js";
import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { parsePlan } from "../runtime/plan-doc.js";
import { hfLog } from "../runtime/logger.js";
import { formatToolSearchResults } from "../prompt/prompt.js";
import {
  type ToolContext,
  type OpenCodePluginContext
} from "./plugin-utils.js";
import type { SessionManager } from "./plugin-session.js";

const ALL_COMPLETE_LABEL = "(all complete)";

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

async function resolveByPath(planArg: string, baseDir: string): Promise<string> {
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

async function resolveBySlug(planArg: string, baseDir: string): Promise<string> {
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

  return path.join(plansDir, candidates[0] ?? "");
}

async function resolvePlanPath(planArg: string, baseDir: string): Promise<string> {
  if (planArg.includes("/") || planArg.includes("\\") || planArg.endsWith(".md")) {
    return resolveByPath(planArg, baseDir);
  }
  return resolveBySlug(planArg, baseDir);
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
    const currentTitle = parsed.currentMilestone?.title ?? ALL_COMPLETE_LABEL;
    const currentMilestoneLabel = currentIdx === null ? ALL_COMPLETE_LABEL : `M${currentIdx} — ${currentTitle}`;
    return [
      `Plan bound: ${resolvedPath}`,
      `Title: ${planTitle}`,
      `Status: ${parsed.status}`,
      `Loop state: ${status.loopState}`,
      `Current milestone: ${currentMilestoneLabel}`,
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
  const { query, top_k: topK, source: sourceArg } = args;
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
    } catch (err) {
      return `Index build failed: ${String(err instanceof Error ? err.message : err)}. Try again or check the runtime logs.`;
    }
  }

  const results = await runtime.queryIndex(query, topK, sourceFilter);
  if (results === null) {
    return "No index available — the on-demand index build returned no results. Try again or check the runtime logs.";
  }
  return formatToolSearchResults(results);
}

type PlanCompleteArgs = { plan?: string; summary?: string };
type BindingRequest = { planArg: string; sessionId: string; directory: string };

async function resolvePlanCompleteBinding(
  req: BindingRequest,
  manager: SessionManager
): Promise<{ resolvedPath: string } | { error: string }> {
  const { planArg, sessionId, directory } = req;
  if (planArg) {
    let resolvedPath: string;
    try {
      resolvedPath = await resolvePlanPath(planArg, directory);
    } catch (err) {
      return { error: String(err instanceof Error ? err.message : err) };
    }
    manager.planBindings.set(sessionId, resolvedPath);
    manager.sessionRuntimes.delete(sessionId);
    const orderIdx = manager.sessionAccessOrder.indexOf(sessionId);
    if (orderIdx !== -1) manager.sessionAccessOrder.splice(orderIdx, 1);
    return { resolvedPath };
  }
  const bound = manager.planBindings.get(sessionId);
  if (!bound) {
    return { error: "No plan is bound to this session. Call hf_plan_start first, or pass an explicit plan slug." };
  }
  return { resolvedPath: bound };
}

type OutcomeParams = { resolvedPath: string; summary: string; sessionId: string };

async function evaluatePlanCompleteOutcome(params: OutcomeParams, runtime: HybridLoopRuntime): Promise<string> {
  const { resolvedPath, summary, sessionId } = params;
  let parsed: Awaited<ReturnType<typeof parsePlan>>;
  try {
    parsed = await parsePlan(resolvedPath);
  } catch (err) {
    return `Error: Could not parse plan doc: ${String(err)}`;
  }
  if (!parsed.completed) {
    const unchecked = parsed.milestones.filter((m) => !m.checked);
    const list = unchecked.map((m) => `  - M${m.index}: ${m.title}`).join("\n");
    return [`Error: Plan is not complete — ${unchecked.length} milestone(s) are still unchecked.`, list, "", "Check all milestones and update the frontmatter to `status: complete` before calling hf_plan_complete."].join("\n");
  }
  const outcome = { state: "plan_complete" as const, summary: summary || `All milestones complete for plan: ${parsed.slug}`, files_changed: [] as string[], tests_run: [] as never[], next_action: "Plan loop closed." };
  let status: Awaited<ReturnType<typeof runtime.evaluateTurn>>;
  try {
    status = await runtime.evaluateTurn(outcome);
  } catch (err) {
    return `Error: evaluateTurn failed: ${String(err)}`;
  }
  hfLog({ tag: "plugin", msg: "hf_plan_complete: loop closed", data: { sessionId, resolvedPath, loopState: status.loopState } });
  return [`Plan loop closed: ${resolvedPath}`, `Loop state: ${status.loopState}`, `Plan slug: ${status.planSlug}`, `Total milestones: ${parsed.milestones.length} ${ALL_COMPLETE_LABEL}`].join("\n");
}

async function executePlanComplete(args: PlanCompleteArgs, toolContext: ToolContext, manager: SessionManager): Promise<string> {
  const sessionId = toolContext.sessionID;
  const planArg = (args.plan ?? "").trim();
  const bindResult = await resolvePlanCompleteBinding({ planArg, sessionId, directory: toolContext.directory }, manager);
  if ("error" in bindResult) return `Error: ${bindResult.error}`;
  const { resolvedPath } = bindResult;

  let runtime: HybridLoopRuntime | null;
  try {
    runtime = await manager.getRuntime(sessionId);
  } catch (err) {
    return `Error: Runtime hydration failed: ${String(err)}`;
  }
  if (!runtime || runtime.isPlanless()) {
    return `Error: Runtime is not bound to a plan (got planless or null). Make sure the plan doc has a ## Milestones section.`;
  }
  return evaluatePlanCompleteOutcome({ resolvedPath, summary: (args.summary ?? "").trim(), sessionId }, runtime);
}

function buildPlanStartTool(manager: SessionManager) {
  const { planBindings, sessionRuntimes, sessionAccessOrder } = manager;
  return {
    description: "Bind this OpenCode session to a specific hybrid-framework plan doc. Call this at the start of every builder or planner session before running any plan milestones. Pass a plan slug (e.g. 'my-feature') or a relative path (e.g. 'plans/2026-03-27-my-feature-plan.md').",
    args: { plan: pluginZ.string().describe("Plan slug or relative path (e.g. 'my-feature' or 'plans/2026-03-27-my-feature-plan.md')") },
    execute: async (args: { plan: string }, toolContext: ToolContext): Promise<string> => {
      const planArg = args.plan;
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
}

function buildSearchTool(context: OpenCodePluginContext, manager: SessionManager) {
  return {
    description: "Search the hybrid framework's unified semantic index (vault docs, code, and external files). Optionally filter by source: 'vault' for documentation, 'code' for source code, 'all' (default) for everything.",
    args: {
      query: pluginZ.string().describe("Natural language search query"),
      top_k: pluginZ.number().describe("Number of results to return (default: 5)").optional(),
      source: pluginZ.string().describe("Source filter: 'vault' for documentation only, 'code' for source code only, 'all' for everything (default: 'all')").optional()
    },
    execute: async (args: SearchArgs, toolContext: ToolContext): Promise<string> => {
      try {
        return await executeSearchQuery(args, { cwd: context.cwd ?? toolContext.directory, sessionId: toolContext.sessionID, getRuntime: manager.getRuntime });
      } catch (err) {
        return `Error querying index: ${String(err)}`;
      }
    }
  };
}

function buildPlanCompleteTool(manager: SessionManager) {
  return {
    description: "Close the hybrid-framework plan loop after all milestones are checked and status is set to complete. Call this as the final step of every builder session once the plan doc frontmatter has been updated to `status: complete`. Accepts an optional plan slug or path; defaults to the currently bound plan.",
    args: {
      plan: pluginZ.string().describe("Plan slug or relative path (e.g. 'my-feature' or 'plans/2026-03-27-my-feature-plan.md'). Omit to use the currently bound plan.").optional(),
      summary: pluginZ.string().describe("One-sentence summary of what was accomplished across all milestones.").optional(),
    },
    execute: (args: PlanCompleteArgs, toolContext: ToolContext) =>
      executePlanComplete(args, toolContext, manager)
  };
}

function buildPlanStatusTool(manager: SessionManager) {
  return {
    description: "Show the active plan binding and current plan state for this session. Call this at the start of any session to confirm you are working on the correct plan before executing milestones.",
    args: {},
    execute: async (_args: Record<string, never>, toolContext: ToolContext): Promise<string> => {
      const sessionId = toolContext.sessionID;
      const resolvedPath = manager.planBindings.get(sessionId);
      if (!resolvedPath) {
        return "No plan is bound to this session. Call hf_plan_start to bind one.";
      }
      return buildPlanSummary(resolvedPath, manager, sessionId);
    }
  };
}

const PLAN_LIST_TIMEOUT_MS = 200;

function buildPlanListTool(manager: SessionManager) {
  return {
    description: "List all active plan bindings across all sessions in this process. Use this to diagnose cross-session plan confusion when multiple sessions are running simultaneously.",
    args: {},
    execute: async (_args: Record<string, never>): Promise<string> => {
      const { planBindings, sessionRuntimes } = manager;
      if (planBindings.size === 0) {
        return "No active plan bindings in this process.";
      }
      const lines: string[] = [`Active plan bindings (${planBindings.size} sessions):`];
      for (const [sessionId, resolvedPath] of planBindings) {
        const filename = path.basename(resolvedPath);
        const loopState = await resolveLoopState(sessionRuntimes, sessionId);
        lines.push(`  session ${sessionId} → plans/${filename} (loopState: ${loopState})`);
      }
      return lines.join("\n");
    }
  };
}

async function resolveLoopState(
  sessionRuntimes: Map<string, Promise<HybridLoopRuntime | null>>,
  sessionId: string
): Promise<string> {
  const runtimePromise = sessionRuntimes.get(sessionId);
  if (!runtimePromise) return "not hydrated";
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PLAN_LIST_TIMEOUT_MS));
  const result = await Promise.race([runtimePromise, timeout]);
  if (!result) return "not hydrated";
  if (result.isPlanless()) return "planless";
  return result.getStatus().loopState;
}

function buildPlanUnbindTool(manager: SessionManager) {
  return {
    description: "Remove the active plan binding from this session without completing the plan loop. Use when pivoting to a different task or when the session should become planless. The plan doc is not modified.",
    args: {},
    execute: (_args: Record<string, never>, toolContext: ToolContext): string => {
      const sessionId = toolContext.sessionID;
      const resolvedPath = manager.planBindings.get(sessionId);
      if (!resolvedPath) {
        return "No plan is bound to this session — nothing to unbind.";
      }
      manager.planBindings.delete(sessionId);
      manager.sessionRuntimes.delete(sessionId);
      const orderIdx = manager.sessionAccessOrder.indexOf(sessionId);
      if (orderIdx !== -1) manager.sessionAccessOrder.splice(orderIdx, 1);
      hfLog({ tag: "plugin", msg: "hf_plan_unbind: binding removed", data: { sessionId, resolvedPath } });
      return `Plan unbound: ${resolvedPath}\nThis session is now planless. Call hf_plan_start to bind a new plan.`;
    }
  };
}

function formatMilestoneLabel(milestone: { index: number; title: string } | null): string {
  if (milestone === null) return ALL_COMPLETE_LABEL;
  return `M${milestone.index} — ${milestone.title}`;
}

function formatLastVerification(
  lastVerification: { status: "pass" | "fail" | "unknown"; summary?: string; at: string } | undefined
): string {
  if (!lastVerification) return "none";
  return `${lastVerification.status} — ${lastVerification.summary ?? ""}`;
}

function buildRuntimeStatusTool(manager: SessionManager) {
  return {
    description: "Show live loop counters, phase, and recommended next action for the plan bound to this session. Use this to inspect runtime state before thresholds are crossed and escalation is triggered.",
    args: {},
    execute: async (_args: Record<string, never>, toolContext: ToolContext): Promise<string> => {
      const sessionId = toolContext.sessionID;
      if (!manager.planBindings.get(sessionId)) {
        return "No plan is bound to this session. Call hf_plan_start to bind one before checking runtime status.";
      }
      const runtime = await manager.getRuntime(sessionId);
      if (!runtime || runtime.isPlanless()) {
        return "Runtime not yet initialized for this session.";
      }
      const status = runtime.getStatus();
      const { counters } = status;
      const planLabel = `plans/${path.basename(status.planPath)}`;
      const milestoneLabel = formatMilestoneLabel(status.currentMilestone);
      const nextAction = status.recommendedNextAction ?? "none";
      const lastBlocker = status.lastBlocker?.message ?? "none";
      const lastVerification = formatLastVerification(status.lastVerification);
      return [
        `Runtime status for: ${planLabel}`,
        `Loop state:    ${status.loopState}`,
        `Phase:         ${status.phase}`,
        `Milestone:     ${milestoneLabel}`,
        "",
        "Counters:",
        `  Total attempts:           ${counters.totalAttempts}`,
        `  Total turns:              ${counters.totalTurns} / ${counters.maxTotalTurns}`,
        `  Turns since last outcome: ${counters.turnsSinceLastOutcome}`,
        `  No-progress count:        ${counters.noProgress}`,
        `  Repeated blocker count:   ${counters.repeatedBlocker}`,
        `  Verification failures:    ${counters.verificationFailures}`,
        "",
        `Recommended action: ${nextAction}`,
        `Last blocker:       ${lastBlocker}`,
        `Last verification:  ${lastVerification}`,
      ].join("\n");
    }
  };
}

const VAULT_PREFIX = "vault/";
const ISO_DATE_LENGTH = 10;

function buildVaultWriteTool() {
  return {
    description: "Append a dated section to a vault file. Path must be under vault/. Creates the file if it does not exist. Existing content is never overwritten — each call adds a new dated block at the end.",
    args: {
      path: pluginZ.string().describe("Relative path under vault/ (e.g. vault/plans/my-plan/context.md)"),
      content: pluginZ.string().describe("Content to append as a new dated section"),
    },
    execute: async (args: { path: string; content: string }): Promise<string> => {
      const { path: vaultPath, content } = args;
      if (!vaultPath.startsWith(VAULT_PREFIX)) {
        return `Invalid path: vault writes must target paths under vault/. Received: ${vaultPath}`;
      }
      const fullPath = path.resolve(process.cwd(), vaultPath);
      const vaultRoot = path.resolve(process.cwd(), VAULT_PREFIX);
      if (!fullPath.startsWith(vaultRoot + path.sep)) {
        return `Invalid path: resolved path escapes vault/ root. Received: ${vaultPath}`;
      }
      const today = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
      const datedBlock = `_Dated: ${today}_\n\n${content}`;
      let existing = "";
      try {
        existing = await fs.readFile(fullPath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          return `Write failed: ${(err as Error).message}`;
        }
      }
      const combined = existing.length > 0 ? `${existing}\n\n${datedBlock}` : datedBlock;
      try {
        await fs.writeFile(fullPath, combined, "utf-8");
      } catch (err) {
        return `Write failed: ${(err as Error).message}`;
      }
      return `Written to ${vaultPath} (${datedBlock.length} bytes appended).`;
    }
  };
}

function buildPlanApproveTool(manager: SessionManager) {
  return {
    description: "Atomically transition the bound plan from status: planning to status: in-progress. Validates that the plan doc contains a ## Milestones section before approving. Use this as the final planner act after all milestones are defined and reviewed.",
    args: {},
    execute: async (_args: Record<string, never>, toolContext: ToolContext): Promise<string> => {
      const sessionId = toolContext.sessionID;
      const resolvedPath = manager.planBindings.get(sessionId);
      if (!resolvedPath) {
        return "No plan is bound to this session. Call hf_plan_start to bind one before approving.";
      }
      let raw: string;
      try {
        raw = await fs.readFile(resolvedPath, "utf-8");
      } catch (err) {
        return `Read failed: ${(err as Error).message}`;
      }
      if (!raw.includes("## Milestones")) {
        return "Plan doc is missing a ## Milestones section. Cannot approve a malformed plan.";
      }
      const statusPattern = /^status:\s*(planning|in-progress|complete)\s*$/m;
      const statusMatch = statusPattern.exec(raw);
      const currentStatus = statusMatch ? statusMatch[1] : null;
      if (currentStatus !== "planning") {
        return `Plan is already in status '${currentStatus ?? "unknown"}' — nothing to approve. Only plans with status: planning can be approved.`;
      }
      const updated = raw.replace(/^(status:\s*)planning(\s*)$/m, "$1in-progress$2");
      try {
        await fs.writeFile(resolvedPath, updated, "utf-8");
      } catch (err) {
        return `Write failed: ${(err as Error).message}`;
      }
      hfLog({ tag: "plugin", msg: "hf_plan_approve: plan approved", data: { sessionId, resolvedPath } });

      // Notify the runtime so awaitingBuilderApproval is set immediately,
      // preventing the auto-continue loop from firing a builder handoff
      // before the user explicitly starts the builder.
      try {
        const runtime = await manager.getRuntime(sessionId);
        if (runtime) {
          const status = runtime.getStatus();
          status.awaitingBuilderApproval = true;
          status.phase = "execution";
          await runtime.writeState();
          hfLog({ tag: "plugin", msg: "hf_plan_approve: awaitingBuilderApproval set on runtime", data: { sessionId } });
        } else {
          hfLog({ tag: "plugin", msg: "hf_plan_approve: runtime not available — awaitingBuilderApproval will be set by noteStopWithoutOutcome fallback", data: { sessionId } });
        }
      } catch (runtimeErr) {
        hfLog({ tag: "plugin", msg: "hf_plan_approve: failed to set awaitingBuilderApproval on runtime", data: { sessionId, error: (runtimeErr as Error).message } });
      }

      return `Plan approved: ${resolvedPath}\nStatus updated from planning → in-progress. The plan is now ready for builder execution.`;
    }
  };
}

export function createPluginTools(context: OpenCodePluginContext, manager: SessionManager): Record<string, unknown> {
  return {
    hf_plan_start: buildPlanStartTool(manager),
    hf_search: buildSearchTool(context, manager),
    hf_plan_complete: buildPlanCompleteTool(manager),
    hf_plan_status: buildPlanStatusTool(manager),
    hf_plan_list: buildPlanListTool(manager),
    hf_plan_unbind: buildPlanUnbindTool(manager),
    hf_runtime_status: buildRuntimeStatusTool(manager),
    hf_vault_write: buildVaultWriteTool(),
    hf_plan_approve: buildPlanApproveTool(manager),
  };
}

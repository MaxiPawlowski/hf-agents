// oxlint-disable max-lines -- plugin integrates hooks, tools, session management and LRU eviction in a single cohesive unit
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

import {
  hydrateRuntimeWithTimeout,
  ingestTurnOutcome,
  isDestructiveCommand,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { parsePlan } from "../runtime/plan-doc.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import { hfLog, hfLogTimed } from "../runtime/logger.js";
import type { ContinueDecision, RuntimeEvent } from "../runtime/types.js";
import { formatToolSearchResults } from "../runtime/prompt.js";

/**
 * Inline ToolContext shape matching @opencode-ai/plugin ToolContext.
 * Defined here to avoid adding a compile-time dependency on the plugin package.
 */
type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  /** Current project directory for this session. */
  directory: string;
  /** Project worktree root for this session. */
  worktree: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
  ask(input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }): Promise<void>;
};

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

export interface OpenCodePluginContext {
  cwd?: string;
  session?: {
    id?: string;
  };
  client?: {
    prompt?: (message: string, sessionId?: string) => Promise<unknown>;
    session?: {
      prompt?: (input: { sessionID: string; parts: Array<{ type: "text"; text: string }> }) => Promise<unknown>;
    };
  };
}

type HookInput = Record<string, unknown> | undefined;
type OpenCodeHook = (input?: HookInput, output?: HookInput) => Promise<unknown>;

function extractSessionId(input?: HookInput, output?: HookInput, context?: OpenCodePluginContext): string | undefined {
  const fromInput = input?.sessionID ?? input?.sessionId ?? input?.id;
  const fromOutput = output?.sessionID ?? output?.sessionId ?? output?.id;
  const fromNested = (input?.session as { id?: string } | undefined)?.id;
  return [fromInput, fromOutput, fromNested, context?.session?.id]
    .map((value) => (typeof value === "string" && value.length > 0 ? value : undefined))
    .find(Boolean);
}

function extractCommand(input?: HookInput, output?: HookInput): string {
  const outputArgs = output?.args as { command?: string } | undefined;
  const inputTool = input?.tool_input as { command?: string } | undefined;

  if (typeof outputArgs?.command === "string") {
    return outputArgs.command;
  }

  if (typeof inputTool?.command === "string") {
    return inputTool.command;
  }

  if (typeof input?.command === "string") {
    return input.command;
  }

  return "";
}

function toPayload(input?: HookInput, output?: HookInput): Record<string, unknown> {
  return {
    ...(input),
    ...(output ? { output } : {})
  };
}

const HYDRATION_TIMEOUT_MS = 4_000;
const HOOK_DEADLINE_MS = 3_000;
const SESSION_MAP_MAX = 20;

function withHookDeadline<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), HOOK_DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer!));
}

async function hydrateRuntime(context: OpenCodePluginContext, explicitPlanPath?: string): Promise<HybridLoopRuntime> {
  const done = hfLogTimed({ tag: "plugin", msg: "hydrateRuntime" });
  const cwd = context.cwd ?? process.cwd();

  const runtime = await hydrateRuntimeWithTimeout({
    cwd,
    ...(explicitPlanPath ? { explicitPlanPath } : {}),
    timeoutMs: HYDRATION_TIMEOUT_MS,
    timeoutMessage: "Runtime hydration timed out",
    tag: "plugin"
  });

  done({ planless: runtime.isPlanless() });
  return runtime;
}

// oxlint-disable max-params -- runtime, eventType, input, output, context are all distinct event-recording params
async function recordOpenCodeEvent(
  runtime: HybridLoopRuntime,
  eventType: string,
  input: HookInput,
  output: HookInput,
  context: OpenCodePluginContext
// oxlint-enable max-params
): Promise<HybridLoopRuntime> {
  const sessionId = extractSessionId(input, output, context);
  const event: RuntimeEvent = {
    vendor: "opencode",
    type: `opencode.${eventType}`,
    timestamp: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    payload: toPayload(input, output)
  };
  await runtime.recordEvent(event);
  return runtime;
}

// oxlint-disable max-params -- runtime, input, output, sessionId are distinct outcome-ingestion params
async function ingestOpenCodeOutcome(runtime: HybridLoopRuntime, input: HookInput, output: HookInput, sessionId?: string): Promise<{
// oxlint-enable max-params
  ingested: boolean;
  observed: boolean;
}> {
  const detection = detectTurnOutcomeInPayload({ input, output }, "opencode hook payload");
  return ingestTurnOutcome(runtime, {
    vendor: "opencode",
    source: detection.source,
    result: detection.result,
    ...(sessionId ? { sessionId } : {}),
    countMissingAsAttempt: true
  });
}

async function promptContinuation(
  decision: ContinueDecision,
  context: OpenCodePluginContext,
  sessionId?: string
): Promise<void> {
  if (decision.action !== "continue" || !decision.resume_prompt) {
    return;
  }

  if (context.client?.prompt) {
    await context.client.prompt(decision.resume_prompt, sessionId);
    return;
  }

  if (context.client?.session?.prompt && sessionId) {
    await context.client.session.prompt({
      sessionID: sessionId,
      parts: [{ type: "text", text: decision.resume_prompt }]
    });
  }
}

async function applyOpenCodeDecision(
  decision: ContinueDecision,
  params: {
    autoContinue: boolean;
    deliverPrompt?: (prompt: string) => Promise<void>;
  }
): Promise<ContinueDecision> {
  if (decision.action === "continue" && params.autoContinue && decision.resume_prompt && params.deliverPrompt) {
    await params.deliverPrompt(decision.resume_prompt);
  }

  return decision;
}

export interface HybridRuntimeHooksResult {
  hooks: Record<string, OpenCodeHook>;
  tools: Record<string, unknown>;
  planBindings: Map<string, string>;
  sessionRuntimes: Map<string, Promise<HybridLoopRuntime | null>>;
  getRuntime: (sessionId: string) => Promise<HybridLoopRuntime | null>;
}

// oxlint-disable max-lines-per-function -- factory function that sets up per-session runtime map, LRU eviction, hooks, and tool definitions; cannot be split without breaking closure state
export function createHybridRuntimeHooks(context: OpenCodePluginContext): HybridRuntimeHooksResult {
// oxlint-enable max-lines-per-function
  // Per-session runtime map: sessionId → Promise<HybridLoopRuntime | null>
  const sessionRuntimes = new Map<string, Promise<HybridLoopRuntime | null>>();

  // Per-session plan bindings: sessionId → explicit plan path.
  // Written by hf_plan_start tool (M2); read by getRuntime().
  const planBindings = new Map<string, string>();

  // Per-session ESC-interrupt and agent-gate flags.
  // Set by "message.updated" and consumed by session.idle / gated hooks.
  //
  // Expected event shape (from @opencode-ai/sdk EventMessageUpdated):
  //   event.type === "message.updated"
  //   event.properties.info: Message (UserMessage | AssistantMessage)
  //
  // AssistantMessage shape (relevant fields):
  //   { role: "assistant", agent: string, error?: { name: "MessageAbortedError", ... } | ... }
  //
  // UserMessage shape (relevant fields):
  //   { role: "user", agent: string }
  //
  // Interrupt signal: role === "assistant" && error?.name === "MessageAbortedError"
  // Agent-gate signal: agent.startsWith("hf-")
  const sessionFlags = new Map<string, { interrupted: boolean; activeAgentIsHf: boolean }>();

  // LRU access order for eviction (oldest first).
  const sessionAccessOrder: string[] = [];

  /**
   * Touch a sessionId for LRU tracking and evict the oldest entry if the map
   * is at capacity. `sessionFlags` and `planBindings` are evicted alongside.
   */
  function touchSession(sessionId: string): void {
    const existingIdx = sessionAccessOrder.indexOf(sessionId);
    if (existingIdx !== -1) {
      sessionAccessOrder.splice(existingIdx, 1);
    }
    sessionAccessOrder.push(sessionId);

    // Evict oldest entries when over capacity.
    while (sessionRuntimes.size >= SESSION_MAP_MAX && sessionAccessOrder.length > 0) {
      const oldest = sessionAccessOrder.shift()!;
      if (oldest !== sessionId) {
        sessionRuntimes.delete(oldest);
        sessionFlags.delete(oldest);
        planBindings.delete(oldest);
      }
    }
  }

  /**
   * Returns (or lazily creates) the per-session flags object.
   */
  function getFlags(sessionId: string): { interrupted: boolean; activeAgentIsHf: boolean } {
    let flags = sessionFlags.get(sessionId);
    if (!flags) {
      flags = { interrupted: false, activeAgentIsHf: false };
      sessionFlags.set(sessionId, flags);
    }
    return flags;
  }

  /**
   * Returns the HybridLoopRuntime for the given session, or null if no plan
   * binding has been registered for this session.
   *
   * Unlike the legacy single-runtime design, this function does NOT fall back
   * to auto-discovery. The session must first be bound via planBindings (set by
   * the hf_plan_start tool in M2). Sessions with no plan binding are planless
   * and will receive no-op hook behaviour.
   */
  const getRuntime = (sessionId: string): Promise<HybridLoopRuntime | null> => {
    const existing = sessionRuntimes.get(sessionId);
    if (existing) {
      touchSession(sessionId);
      return existing;
    }

    const explicitPlanPath = planBindings.get(sessionId);
    if (!explicitPlanPath) {
      hfLog({ tag: "plugin", msg: "getRuntime: no plan binding — session is planless", data: { sessionId } });
      return Promise.resolve(null);
    }

    hfLog({ tag: "plugin", msg: "getRuntime: starting hydration", data: { sessionId, explicitPlanPath } });
    touchSession(sessionId);
    const promise: Promise<HybridLoopRuntime | null> = hydrateRuntime(context, explicitPlanPath).catch((error) => {
      if (error instanceof Error && error.message === "Runtime hydration timed out") {
        hfLog({ tag: "plugin", msg: "getRuntime: hydration timed out", data: { sessionId } });
        return null;
      }
      sessionRuntimes.delete(sessionId);
      const orderIdx = sessionAccessOrder.indexOf(sessionId);
      if (orderIdx !== -1) sessionAccessOrder.splice(orderIdx, 1);
      throw error;
    });
    sessionRuntimes.set(sessionId, promise);
    return promise;
  };

  const hooks: Record<string, OpenCodeHook> = {
    "message.updated": async (input?: HookInput) => {
      hfLog({ tag: "plugin", msg: "hook: message.updated" });
      const info = (input as { info?: Record<string, unknown> } | undefined)?.info;
      if (!info) {
        hfLog({ tag: "plugin", msg: "message.updated: missing info field — skipping flag update" });
        return null;
      }

      // Resolve sessionId: prefer info.sessionID (SDK Message field), fall back to context.
      const infoSessionId = typeof info.sessionID === "string" && info.sessionID.length > 0
        ? info.sessionID
        : undefined;
      const sessionId = infoSessionId ?? context.session?.id;

      if (!sessionId) {
        hfLog({ tag: "plugin", msg: "message.updated: no sessionId — skipping flag update" });
        return null;
      }

      const flags = getFlags(sessionId);
      const agent = typeof info.agent === "string" ? info.agent : "";
      flags.activeAgentIsHf = agent.startsWith("hf-");
      if (info.role === "assistant") {
        const error = info.error as { name?: string } | undefined;
        if (error?.name === "MessageAbortedError") {
          flags.interrupted = true;
          hfLog({ tag: "plugin", msg: "message.updated: MessageAbortedError detected — interrupt flagged", data: { sessionId } });
        }
      }
      hfLog({ tag: "plugin", msg: "message.updated: flags updated", data: { sessionId, activeAgentIsHf: flags.activeAgentIsHf, interrupted: flags.interrupted } });
      return null;
    },
    "tool.execute.before": async (input?: HookInput, output?: HookInput) => {
      hfLog({ tag: "plugin", msg: "hook: tool.execute.before" });
      const command = extractCommand(input, output);
      if (isDestructiveCommand(command)) {
        throw new Error("Hybrid runtime guardrail blocked a destructive command.");
      }
      // Fire-and-forget: event recording must not block tool execution
      const sessionId = extractSessionId(input, output, context);
      if (sessionId) {
        getRuntime(sessionId).then((runtime) => {
          if (runtime) {
            recordOpenCodeEvent(runtime, "tool.execute.before", input, output, context).catch(() => { });
          }
        }).catch(() => { });
      }
      return null;
    },
    "session.created": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.created" });
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) {
          hfLog({ tag: "plugin", msg: "session.created: no sessionId — skipping" });
          return {};
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.created: no runtime (no plan binding)", data: { sessionId } });
          done({ skipped: "no-binding" });
          return {};
        }
        await recordOpenCodeEvent(runtime, "session.created", input, output, context);
        const decision = await runtime.decideNext();
        done({ action: decision.action });
        return { additionalContext: decision.resume_prompt };
      })(), {});
    },
    "session.status": async () => {
      // session.status is not per-session in the original design — it was a single runtime.
      // After M1, this hook cannot return meaningful per-session data without a sessionId.
      // Return a disabled status to indicate no active plan.
      return { enabled: false, reason: "no_active_session" };
    },
    "session.compacted": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.compacted" });
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) {
          hfLog({ tag: "plugin", msg: "session.compacted: no sessionId — skipping" });
          done({ skipped: true });
          return {};
        }
        const flags = getFlags(sessionId);
        if (!flags.activeAgentIsHf) {
          hfLog({ tag: "plugin", msg: "session.compacted: non-hf agent — skipping", data: { sessionId } });
          done({ skipped: true });
          return {};
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.compacted: no runtime (no plan binding)", data: { sessionId } });
          return {};
        }
        await recordOpenCodeEvent(runtime, "session.compacted", input, output, context);
        await recordCompactionArchive(runtime, "opencode", "opencode.pre_compact_archive");
        const decision = await runtime.decideNext();
        done({ action: decision.action });
        return { additionalContext: decision.resume_prompt };
      })(), {});
    },
    "session.idle": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const done = hfLogTimed({ tag: "plugin", msg: "hook: session.idle" });
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) {
          hfLog({ tag: "plugin", msg: "session.idle: no sessionId — skipping" });
          done({ skipped: "no-session" });
          return null;
        }

        const flags = getFlags(sessionId);

        // Guard 1: ESC interrupt — user aborted generation, never auto-continue.
        if (flags.interrupted) {
          flags.interrupted = false;
          hfLog({ tag: "plugin", msg: "session.idle: interrupted — skipping auto-continue", data: { sessionId } });
          done({ skipped: "interrupted" });
          return { action: "allow_stop", reason: "User interrupted generation (ESC). Skipping auto-continue." };
        }

        // Guard 2: agent gate — only run runtime logic for hf-* agents.
        if (!flags.activeAgentIsHf) {
          hfLog({ tag: "plugin", msg: "session.idle: non-hf agent — skipping", data: { sessionId } });
          done({ skipped: "non-hf" });
          return null;
        }

        const runtime = await getRuntime(sessionId);
        if (!runtime) {
          hfLog({ tag: "plugin", msg: "session.idle: no runtime (no plan binding)", data: { sessionId } });
          return null;
        }

        if (runtime.isPlanless()) {
          await recordOpenCodeEvent(runtime, "session.idle", input, output, context);
          const decision = await runtime.decideNext();
          done({ action: decision.action, planless: true });
          return decision;
        }

        await ingestOpenCodeOutcome(runtime, input, output, sessionId);
        const decision = await runtime.decideNext();
        const status = runtime.getStatus();

        done({ action: decision.action, loopState: status.loopState });
        return applyOpenCodeDecision(decision, {
          autoContinue: status.autoContinue,
          deliverPrompt: async (prompt) => promptContinuation({ ...decision, resume_prompt: prompt }, context, sessionId)
        });
      })(), null);
    },
    "subagent.started": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) {
          return null;
        }
        const flags = getFlags(sessionId);
        if (!flags.activeAgentIsHf) {
          hfLog({ tag: "plugin", msg: "subagent.started: non-hf agent — skipping", data: { sessionId } });
          return null;
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) {
          return null;
        }
        await recordOpenCodeEvent(runtime, "subagent.started", input, output, context);
        const subagentId = String(input?.subagent_id ?? input?.id ?? "unknown");
        const subagentName = String(input?.subagent_name ?? input?.name ?? "unnamed");
        await recordSubagentLifecycle(runtime, {
          id: subagentId,
          name: subagentName,
          status: "running"
        });
        return null;
      })(), null);
    },
    "subagent.completed": async (input?: HookInput, output?: HookInput) => {
      return withHookDeadline((async () => {
        const sessionId = extractSessionId(input, output, context);
        if (!sessionId) {
          return null;
        }
        const flags = getFlags(sessionId);
        if (!flags.activeAgentIsHf) {
          hfLog({ tag: "plugin", msg: "subagent.completed: non-hf agent — skipping", data: { sessionId } });
          return null;
        }
        const runtime = await getRuntime(sessionId);
        if (!runtime) {
          return null;
        }
        await recordOpenCodeEvent(runtime, "subagent.completed", input, output, context);
        const subagentId = String(input?.subagent_id ?? input?.id ?? "unknown");
        const subagentName = String(input?.subagent_name ?? input?.name ?? "unnamed");
        const failed = input?.error !== undefined;
        await recordSubagentLifecycle(runtime, {
          id: subagentId,
          name: subagentName,
          status: failed ? "failed" : "completed"
        });
        return null;
      })(), null);
    }
  };

  /**
   * `hf_plan_start` tool: binds the current session to a plan doc.
   *
   * Agents call this at the start of a session (or mid-session to re-bind).
   * The tool resolves the plan slug/path, stores the binding, evicts any
   * existing runtime, eagerly hydrates a fresh runtime, and returns a
   * status summary so the agent can proceed immediately.
   */
  const hfPlanStartTool = {
    description: "Bind this OpenCode session to a specific hybrid-framework plan doc. Call this at the start of every builder or planner session before running any plan milestones. Pass a plan slug (e.g. 'my-feature') or a relative path (e.g. 'plans/2026-03-27-my-feature-plan.md').",
    args: {
      plan: pluginZ.string().describe("Plan slug or relative path (e.g. 'my-feature' or 'plans/2026-03-27-my-feature-plan.md')")
    },
    // oxlint-disable max-lines-per-function -- plan resolution, slug scanning, runtime hydration, and summary building are tightly coupled steps for a single atomic tool operation
    execute: async (args: { plan: string }, toolContext: ToolContext): Promise<string> => {
    // oxlint-enable max-lines-per-function
      const planArg = args.plan ?? "";
      const baseDir = toolContext.directory;

      // Resolve the plan path.
      let resolvedPath: string;

      if (planArg.includes("/") || planArg.includes("\\") || planArg.endsWith(".md")) {
        // Looks like an explicit relative path — resolve directly.
        resolvedPath = path.resolve(baseDir, planArg);
        try {
          await fs.access(resolvedPath);
        } catch {
          // Scan for available plans to include in error.
          const available = await listAvailablePlans(baseDir);
          const listStr = available.length > 0
            ? available.map((p) => `  - ${p}`).join("\n")
            : "  (no plans found)";
          return `Error: Plan file not found: ${planArg}\n\nAvailable plans:\n${listStr}`;
        }
      } else {
        // Bare slug — scan plans/ directory for matching files.
        const plansDir = path.join(baseDir, "plans");
        let entries: string[] = [];
        try {
          const raw = await fs.readdir(plansDir);
          entries = raw;
        } catch {
          return `Error: Could not read plans/ directory at ${plansDir}. Make sure you are running from the project root.`;
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
          return `Error: No plan found matching "${planArg}".\n\nAvailable plans:\n${listStr}`;
        }

        if (candidates.length > 1) {
          const listStr = candidates.map((p) => `  - plans/${p}`).join("\n");
          return `Error: Ambiguous plan slug "${planArg}" — matches ${candidates.length} files. Be more specific:\n${listStr}`;
        }

        resolvedPath = path.join(plansDir, candidates[0]!);
      }

      const sessionId = toolContext.sessionID;

      // Store the binding — getRuntime() will use this on next call.
      planBindings.set(sessionId, resolvedPath);

      // Evict any existing runtime for this session (forces re-hydration).
      sessionRuntimes.delete(sessionId);
      const orderIdx = sessionAccessOrder.indexOf(sessionId);
      if (orderIdx !== -1) sessionAccessOrder.splice(orderIdx, 1);

      hfLog({ tag: "plugin", msg: "hf_plan_start: plan bound", data: { sessionId, resolvedPath } });

      // Eagerly hydrate so the first hook call doesn't pay the cost.
      let summary: string;
      try {
        const runtime = await getRuntime(sessionId);
        if (runtime && !runtime.isPlanless()) {
          const status = runtime.getStatus();
          // Parse plan doc for richer info (title, milestone count).
          try {
              const parsed = await parsePlan(resolvedPath);
              const planTitle =
                parsed.milestones.length > 0 && parsed.userIntent
                  ? (parsed.userIntent.split("\n")[0]?.trim() ?? path.basename(resolvedPath))
                  : path.basename(resolvedPath);
            const totalMilestones = parsed.milestones.length;
            const currentIdx = parsed.currentMilestone?.index ?? null;
            const currentTitle = parsed.currentMilestone?.title ?? "(all complete)";
            summary = [
              `Plan bound: ${resolvedPath}`,
              `Title: ${planTitle}`,
              `Status: ${parsed.status}`,
              `Loop state: ${status.loopState}`,
              `Current milestone: ${currentIdx !== null ? `M${currentIdx} — ${currentTitle}` : "(all complete)"}`,
              `Total milestones: ${totalMilestones} (${parsed.milestones.filter((m) => m.checked).length} complete)`
            ].join("\n");
          } catch {
            summary = [
              `Plan bound: ${resolvedPath}`,
              `Loop state: ${status.loopState}`
            ].join("\n");
          }
        } else {
          summary = `Plan bound: ${resolvedPath}\n(Runtime hydration returned planless or null — check plan doc format.)`;
        }
      } catch (err) {
        summary = `Plan bound: ${resolvedPath}\n(Warning: runtime hydration failed: ${String(err)})`;
      }

      return summary;
    }
  };

  /**
   * `hf_search` tool: performs an ad-hoc semantic search against the
   * project's unified vector index (vault markdown + TypeScript source code).
   *
   * Agents call this when the context dispatched to them is insufficient or
   * when they need to explore conventions, patterns, or related implementations
   * in the codebase. Optionally filter by source type.
   */
  const hfSearchTool = {
    description: "Search the hybrid framework's unified semantic index (vault docs, code, and external files). Optionally filter by source: 'vault' for documentation, 'code' for source code, 'all' (default) for everything.",
    args: {
      query: pluginZ.string().describe("Natural language search query"),
      top_k: pluginZ.number().describe("Number of results to return (default: 5)").optional(),
      source: pluginZ.string().describe("Source filter: 'vault' for documentation only, 'code' for source code only, 'all' for everything (default: 'all')").optional()
    },
    execute: async (args: { query: string; top_k?: number; source?: string }, toolContext: ToolContext): Promise<string> => {
      try {
        const query = args.query ?? "";
        const topK = args.top_k !== undefined ? args.top_k : undefined;
        const sourceArg = args.source;
        let sourceFilter: "vault" | "code" | undefined;
        if (sourceArg === "vault") sourceFilter = "vault";
        else if (sourceArg === "code") sourceFilter = "code";

        let runtime = await getRuntime(toolContext.sessionID);

        // No plan binding for this session — spin up a disposable planless runtime
        // so the tool can still search the code index even without an active plan.
        if (!runtime) {
          try {
            const planlessRuntime = await hydrateRuntimeWithTimeout({
              cwd: context.cwd ?? toolContext.directory,
              timeoutMs: 15_000,
              timeoutMessage: "Runtime hydration timed out",
              tag: "plugin/hf_search",
            });
            runtime = planlessRuntime;
          } catch {
            return "No index available — the unified index has not been built yet for this session.";
          }
        }

        const results = await runtime.queryIndex(query, topK, sourceFilter);
        if (results === null) {
          return "No index available — the unified index has not been built yet for this session.";
        }

        return formatToolSearchResults(results);
      } catch (err) {
        return `Error querying index: ${String(err)}`;
      }
    }
  };

  const tools: Record<string, unknown> = {
    hf_plan_start: hfPlanStartTool,
    hf_search: hfSearchTool
  };

  return { hooks, tools, planBindings, sessionRuntimes, getRuntime };
}

/**
 * Scan the plans/ directory relative to baseDir and return available plan file
 * paths (relative to baseDir) for error messages.
 */
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

/**
 * Wrap internal hooks into the OpenCode-compatible Hooks shape.
 *
 * OpenCode recognises a fixed set of hook keys:
 *   - "tool.execute.before"  (filter – can block / modify)
 *   - "experimental.session.compacting"  (filter – inject compaction context)
 *   - "event"  (observer – receives all lifecycle events, void return)
 *
 * Session events such as session.created, session.idle, session.compacted etc.
 * are EVENT TYPES that arrive through the "event" hook – they are NOT valid
 * top-level hook names.  Registering them as top-level keys caused OpenCode to
 * silently ignore them.
 */
// oxlint-disable max-lines-per-function -- maps internal hooks to OpenCode-compatible shape; all branches are necessary routing and cannot be further reduced
function toOpenCodeHooks(
  internalHooks: Record<string, OpenCodeHook>,
  tools: Record<string, unknown>,
  _context: OpenCodePluginContext
// oxlint-enable max-lines-per-function
): Record<string, unknown> {
  return {
    /* ── filter hook – unchanged ─────────────────────────────────── */
    "tool.execute.before": internalHooks["tool.execute.before"],

    /* ── plugin-registered tools ────────────────────────────────── */
    tool: tools,

    /* ── compaction hook – inject runtime context before compaction  */
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string }
    ) => {
      const done = hfLogTimed({ tag: "plugin", msg: "hook: experimental.session.compacting" });
      try {
        const result = await withHookDeadline(
          (async () => {
            return internalHooks["session.compacted"]?.({ sessionID: input.sessionID });
          })(),
          undefined
        );
        const additionalContext = (result as { additionalContext?: string } | undefined)?.additionalContext;
        if (additionalContext) {
          output.context.push(additionalContext);
        }
        done({ injected: !!additionalContext });
      } catch {
        done({ error: true });
      }
    },

    /* ── event observer – dispatches lifecycle events to internal hooks  */
    event: async (eventInput: { event: { type: string; properties?: Record<string, unknown> } }) => {
      const { event } = eventInput;
      hfLog({ tag: "plugin", msg: `event: ${event.type}`, ...(event.properties ? { data: event.properties } : {}) });

      try {
        const props = (event.properties ?? {}) as HookInput;

        switch (event.type) {
          case "message.updated": {
            // props.info is the Message object (UserMessage | AssistantMessage).
            // The internal handler reads agent + error fields to update per-session flags.
            const info = event.properties?.info;
            await internalHooks["message.updated"]?.({ info });
            break;
          }

          case "session.created":
            await internalHooks["session.created"]?.(props);
            break;

          case "session.idle":
            await internalHooks["session.idle"]?.(props);
            break;

          case "session.compacted":
            // Post-compaction notification – context injection already
            // handled by experimental.session.compacting above.
            break;

          case "session.status":
            // Informational only – can't return data from event hook.
            break;

          default:
            // Catch subagent and other events.
            if (event.type.startsWith("subagent.")) {
              const hookName = event.type as string;
              await internalHooks[hookName]?.(props);
            }
            break;
        }
      } catch (err) {
        hfLog({ tag: "plugin", msg: `event handler error: ${event.type}`, data: { error: String(err) } });
      }
    }
  };
}

export async function HybridRuntimePlugin(input: {
  directory?: string;
  worktree?: string;
  client?: unknown;
  [key: string]: unknown;
}): Promise<Record<string, unknown>> {
  hfLog({ tag: "plugin", msg: "HybridRuntimePlugin: initializing", data: { directory: input.directory } });

  const context: OpenCodePluginContext = {};
  if (input.directory) context.cwd = input.directory;

  // Wrap the OpenCode SDK client to match the internal prompt interface.
  const sdkClient = input.client as {
    session?: {
      prompt?: (opts: Record<string, unknown>) => Promise<unknown>;
      promptAsync?: (opts: Record<string, unknown>) => Promise<unknown>;
    };
  } | undefined;

  if (sdkClient?.session) {
    const sessionApi = sdkClient.session;
    context.client = {
      session: {
        prompt: async (opts: { sessionID: string; parts: Array<{ type: "text"; text: string }> }) => {
          const promptFn = sessionApi.promptAsync ?? sessionApi.prompt;
          if (!promptFn) return;
          return promptFn.call(sessionApi, {
            path: { id: opts.sessionID },
            body: { parts: opts.parts }
          });
        }
      }
    };
  }

  const { hooks: internalHooks, tools } = createHybridRuntimeHooks(context);
  return toOpenCodeHooks(internalHooks, tools, context);
}

export default HybridRuntimePlugin;

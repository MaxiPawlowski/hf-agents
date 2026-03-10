import {
  applyOpenCodeDecision,
  ingestTurnOutcome,
  isDestructiveCommand,
  recordCompactionArchive,
  recordSubagentLifecycle
} from "../adapters/lifecycle.js";
import { HybridLoopRuntime, resolveManagedPlanPath } from "../runtime/runtime.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import type { ContinueDecision, RuntimeEvent } from "../runtime/types.js";

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
    ...(input ?? {}),
    ...(output ? { output } : {})
  };
}

async function hydrateRuntime(context: OpenCodePluginContext): Promise<HybridLoopRuntime> {
  const runtime = new HybridLoopRuntime();
  const cwd = context.cwd ?? process.cwd();
  const planPath = await resolveManagedPlanPath(cwd);
  await runtime.hydrate(planPath);
  return runtime;
}

async function recordOpenCodeEvent(
  runtime: HybridLoopRuntime,
  eventType: string,
  input: HookInput,
  output: HookInput,
  context: OpenCodePluginContext
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

async function ingestOpenCodeOutcome(runtime: HybridLoopRuntime, input: HookInput, output: HookInput, sessionId?: string): Promise<{
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

export function createHybridRuntimeHooks(context: OpenCodePluginContext): Record<string, OpenCodeHook> {
  let runtimePromise: Promise<HybridLoopRuntime> | null = null;

  const getRuntime = async (): Promise<HybridLoopRuntime> => {
    if (!runtimePromise) {
      runtimePromise = hydrateRuntime(context).catch((error) => {
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise;
  };

  return {
    "tool.execute.before": async (input?: HookInput, output?: HookInput) => {
      const command = extractCommand(input, output);
      if (isDestructiveCommand(command)) {
        throw new Error("Hybrid runtime guardrail blocked a destructive command.");
      }
      const runtime = await getRuntime();
      await recordOpenCodeEvent(runtime, "tool.execute.before", input, output, context);
      return null;
    },
    "session.created": async (input?: HookInput, output?: HookInput) => {
      const runtime = await getRuntime();
      await recordOpenCodeEvent(runtime, "session.created", input, output, context);
      return { additionalContext: runtime.decideNext().resume_prompt };
    },
    "session.status": async () => {
      const runtime = await getRuntime();
      return runtime.getStatus();
    },
    "session.compacted": async (input?: HookInput, output?: HookInput) => {
      const runtime = await getRuntime();
      await recordOpenCodeEvent(runtime, "session.compacted", input, output, context);
      await recordCompactionArchive(runtime, "opencode", "opencode.pre_compact_archive");
      return { additionalContext: runtime.decideNext().resume_prompt };
    },
    "session.idle": async (input?: HookInput, output?: HookInput) => {
      const runtime = await getRuntime();
      const sessionId = extractSessionId(input, output, context);
      await ingestOpenCodeOutcome(runtime, input, output, sessionId);
      const decision = runtime.decideNext();
      const status = runtime.getStatus();

      return applyOpenCodeDecision(decision, {
        autoContinue: status.autoContinue,
        deliverPrompt: async (prompt) => promptContinuation({ ...decision, resume_prompt: prompt }, context, sessionId)
      });
    },
    "subagent.started": async (input?: HookInput, output?: HookInput) => {
      const runtime = await getRuntime();
      await recordOpenCodeEvent(runtime, "subagent.started", input, output, context);
      const subagentId = String(input?.subagent_id ?? input?.id ?? "unknown");
      const subagentName = String(input?.subagent_name ?? input?.name ?? "unnamed");
      await recordSubagentLifecycle(runtime, {
        id: subagentId,
        name: subagentName,
        status: "running"
      });
      return null;
    },
    "subagent.completed": async (input?: HookInput, output?: HookInput) => {
      const runtime = await getRuntime();
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
    }
  };
}

export async function HybridRuntimePlugin(input: {
  directory?: string;
  client?: OpenCodePluginContext["client"];
}): Promise<Record<string, OpenCodeHook>> {
  const context: OpenCodePluginContext = {};
  if (input.directory) {
    context.cwd = input.directory;
  }
  if (input.client) {
    context.client = input.client;
  }
  return createHybridRuntimeHooks(context);
}

export default HybridRuntimePlugin;

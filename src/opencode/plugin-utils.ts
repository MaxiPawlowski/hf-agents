import { hydrateRuntimeWithTimeout, ingestTurnOutcome } from "../adapters/lifecycle.js";
import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { detectTurnOutcomeInPayload } from "../runtime/turn-outcome-ingestion.js";
import { hfLogTimed } from "../runtime/logger.js";
import type { ContinueDecision, RuntimeEvent } from "../runtime/types.js";
import { isString } from "../runtime/utils.js";

export type ToolContext = {
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

export type HookInput = Record<string, unknown> | undefined;
export type OpenCodeHook = (input?: HookInput, output?: HookInput) => Promise<unknown>;

export const HYDRATION_TIMEOUT_MS = 4_000;
export const HOOK_DEADLINE_MS = 3_000;
export const SESSION_MAP_MAX = 20;

export function extractSessionId(input?: HookInput, output?: HookInput, context?: OpenCodePluginContext): string | undefined {
  const fromInput = input?.sessionID ?? input?.sessionId ?? input?.id;
  const fromOutput = output?.sessionID ?? output?.sessionId ?? output?.id;
  const fromNested = (input?.session as { id?: string } | undefined)?.id;
  return [fromInput, fromOutput, fromNested, context?.session?.id]
    .map((value) => (isString(value) && value.length > 0 ? value : undefined))
    .find(Boolean);
}

export function extractCommand(input?: HookInput, output?: HookInput): string {
  const outputArgs = output?.args as { command?: string } | undefined;
  const inputTool = input?.tool_input as { command?: string } | undefined;

  if (isString(outputArgs?.command)) {
    return outputArgs.command;
  }

  if (isString(inputTool?.command)) {
    return inputTool.command;
  }

  if (isString(input?.command)) {
    return input.command;
  }

  return "";
}

export function extractFilePath(input?: HookInput, output?: HookInput): string {
  const outputArgs = output?.args as { file_path?: string; filePath?: string } | undefined;
  const inputTool = input?.tool_input as { file_path?: string; filePath?: string } | undefined;

  if (isString(outputArgs?.file_path)) { return outputArgs.file_path; }
  if (isString(outputArgs?.filePath)) { return outputArgs.filePath; }
  if (isString(inputTool?.file_path)) { return inputTool.file_path; }
  if (isString(inputTool?.filePath)) { return inputTool.filePath; }
  if (isString(input?.file_path)) { return input.file_path; }
  if (isString(input?.filePath)) { return input.filePath; }
  return "";
}

export function toPayload(input?: HookInput, output?: HookInput): Record<string, unknown> {
  return {
    ...(input),
    ...(output ? { output } : {})
  };
}

export function withHookDeadline<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), HOOK_DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer!));
}

export async function hydrateRuntime(context: OpenCodePluginContext, explicitPlanPath?: string): Promise<HybridLoopRuntime> {
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

export type RecordEventParams = {
  eventType: string;
  input: HookInput;
  output: HookInput;
  context: OpenCodePluginContext;
};

export async function recordOpenCodeEvent(
  runtime: HybridLoopRuntime,
  params: RecordEventParams
): Promise<HybridLoopRuntime> {
  const sessionId = extractSessionId(params.input, params.output, params.context);
  const event: RuntimeEvent = {
    vendor: "opencode",
    type: `opencode.${params.eventType}`,
    timestamp: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    payload: toPayload(params.input, params.output)
  };
  await runtime.recordEvent(event);
  return runtime;
}

export type IngestOutcomeParams = {
  input: HookInput;
  output: HookInput;
  sessionId?: string;
};

export async function ingestOpenCodeOutcome(runtime: HybridLoopRuntime, params: IngestOutcomeParams): Promise<{
  ingested: boolean;
  observed: boolean;
}> {
  const detection = detectTurnOutcomeInPayload({ input: params.input, output: params.output }, "opencode hook payload");
  return ingestTurnOutcome(runtime, {
    vendor: "opencode",
    source: detection.source,
    result: detection.result,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    countMissingAsAttempt: true
  });
}

export async function promptContinuation(
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

export async function applyOpenCodeDecision(
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

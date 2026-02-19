import {
  hookRuntimeContextSchema,
  hookRuntimeResultSchema,
  type HookId,
  type HookRuntimeContext,
  type HookRuntimeConfig
} from "../contracts/index.js";

type HookHandler = (context: HookRuntimeContext) => HookRuntimeContext;

const contextInjectionNoteHook: HookHandler = (context) => {
  const note = context.hookConfig?.hooks["context-injection-note"]?.note ?? "Using markdown-first context and contracts.";
  if (!context.notes.some((entry) => entry.includes("markdown-first context")) && !context.notes.includes(note)) {
    return {
      ...context,
      notes: [...context.notes, note]
    };
  }
  return context;
};

const outputTruncationGuardHook: HookHandler = (context) => {
  const maxOutputChars = context.hookConfig?.hooks["output-truncation-guard"]?.maxOutputChars ?? context.maxOutputChars;
  if (!context.output || context.output.length <= maxOutputChars) {
    return context;
  }

  const truncatedOutput = `${context.output.slice(0, maxOutputChars)}\n... [truncated]`;
  return {
    ...context,
    output: truncatedOutput,
    notes: [...context.notes, `Output truncated to ${maxOutputChars} characters.`]
  };
};

const completionContinuationReminderHook: HookHandler = (context) => {
  if (context.stage !== "resume") {
    return context;
  }
  if (context.lifecycleStatus === "completed") {
    return context;
  }
  const note =
    context.hookConfig?.hooks["completion-continuation-reminder"]?.note ??
    "Continue from the next ready subtask and preserve dependency order.";
  return {
    ...context,
    notes: [...context.notes, note]
  };
};

const HOOK_HANDLERS: Record<HookId, HookHandler> = {
  "context-injection-note": contextInjectionNoteHook,
  "output-truncation-guard": outputTruncationGuardHook,
  "completion-continuation-reminder": completionContinuationReminderHook
};

const DEFAULT_HOOK_ORDER: HookId[] = [
  "context-injection-note",
  "output-truncation-guard",
  "completion-continuation-reminder"
];

function resolveHookConfig(context: HookRuntimeContext): HookRuntimeConfig {
  return context.hookConfig ?? { enabled: true, hooks: {} };
}

export function listHookRegistry(): HookId[] {
  return [...DEFAULT_HOOK_ORDER];
}

export function runHookRuntime(input: unknown) {
  let context = hookRuntimeContextSchema.parse(input);
  const config = resolveHookConfig(context);
  if (!config.enabled) {
    return hookRuntimeResultSchema.parse({
      output: context.output,
      notes: context.notes,
      truncated: false
    });
  }

  context = { ...context, hookConfig: config };
  for (const hookId of DEFAULT_HOOK_ORDER) {
    const settings = config.hooks[hookId];
    if (settings && settings.enabled === false) {
      continue;
    }
    context = HOOK_HANDLERS[hookId](context);
  }

  const result = {
    output: context.output,
    notes: context.notes,
    truncated: Boolean(context.output && context.output.endsWith("[truncated]"))
  };

  return hookRuntimeResultSchema.parse(result);
}

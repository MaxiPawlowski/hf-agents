import type { HybridLoopRuntime } from "../runtime/runtime.js";
import { hfLog } from "../runtime/logger.js";
import {
  SESSION_MAP_MAX,
  hydrateRuntime,
  type OpenCodePluginContext
} from "./plugin-utils.js";

export interface SessionManager {
  sessionRuntimes: Map<string, Promise<HybridLoopRuntime | null>>;
  planBindings: Map<string, string>;
  sessionFlags: Map<string, { interrupted: boolean; activeAgentIsHf: boolean }>;
  sessionAccessOrder: string[];
  touchSession(sessionId: string): void;
  getFlags(sessionId: string): { interrupted: boolean; activeAgentIsHf: boolean };
  getRuntime(sessionId: string): Promise<HybridLoopRuntime | null>;
}

export interface HybridRuntimeHooksResult {
  hooks: Record<string, (input?: Record<string, unknown>, output?: Record<string, unknown>) => Promise<unknown>>;
  tools: Record<string, unknown>;
  planBindings: Map<string, string>;
  sessionRuntimes: Map<string, Promise<HybridLoopRuntime | null>>;
  getRuntime: (sessionId: string) => Promise<HybridLoopRuntime | null>;
}

type SessionMaps = {
  sessionRuntimes: Map<string, Promise<HybridLoopRuntime | null>>;
  planBindings: Map<string, string>;
  sessionFlags: Map<string, { interrupted: boolean; activeAgentIsHf: boolean }>;
  sessionAccessOrder: string[];
};

function touchSession(maps: SessionMaps, sessionId: string): void {
  const { sessionRuntimes, sessionFlags, planBindings, sessionAccessOrder } = maps;
  const existingIdx = sessionAccessOrder.indexOf(sessionId);
  if (existingIdx !== -1) sessionAccessOrder.splice(existingIdx, 1);
  sessionAccessOrder.push(sessionId);

  while (sessionRuntimes.size >= SESSION_MAP_MAX && sessionAccessOrder.length > 0) {
    const oldest = sessionAccessOrder.shift()!;
    if (oldest !== sessionId) {
      sessionRuntimes.delete(oldest);
      sessionFlags.delete(oldest);
      planBindings.delete(oldest);
    }
  }
}

function getFlags(maps: SessionMaps, sessionId: string): { interrupted: boolean; activeAgentIsHf: boolean } {
  let flags = maps.sessionFlags.get(sessionId);
  if (!flags) {
    flags = { interrupted: false, activeAgentIsHf: false };
    maps.sessionFlags.set(sessionId, flags);
  }
  return flags;
}

function buildRuntimePromise(
  maps: SessionMaps,
  context: OpenCodePluginContext,
  params: { sessionId: string; explicitPlanPath: string }
): Promise<HybridLoopRuntime | null> {
  const { sessionId, explicitPlanPath } = params;
  const { sessionRuntimes, sessionAccessOrder } = maps;
  return hydrateRuntime(context, explicitPlanPath).catch((error) => {
    if (error instanceof Error && error.message === "Runtime hydration timed out") {
      hfLog({ tag: "plugin", msg: "getRuntime: hydration timed out", data: { sessionId } });
      return null;
    }
    sessionRuntimes.delete(sessionId);
    const orderIdx = sessionAccessOrder.indexOf(sessionId);
    if (orderIdx !== -1) sessionAccessOrder.splice(orderIdx, 1);
    throw error;
  });
}

export function createSessionManager(context: OpenCodePluginContext): SessionManager {
  const maps: SessionMaps = {
    sessionRuntimes: new Map(),
    planBindings: new Map(),
    sessionFlags: new Map(),
    sessionAccessOrder: []
  };

  const getRuntime = (sessionId: string): Promise<HybridLoopRuntime | null> => {
    const existing = maps.sessionRuntimes.get(sessionId);
    if (existing) {
      touchSession(maps, sessionId);
      return existing;
    }
    const explicitPlanPath = maps.planBindings.get(sessionId);
    if (!explicitPlanPath) {
      hfLog({ tag: "plugin", msg: "getRuntime: no plan binding — session is planless", data: { sessionId } });
      return Promise.resolve(null);
    }
    hfLog({ tag: "plugin", msg: "getRuntime: starting hydration", data: { sessionId, explicitPlanPath } });
    touchSession(maps, sessionId);
    const promise = buildRuntimePromise(maps, context, { sessionId, explicitPlanPath });
    maps.sessionRuntimes.set(sessionId, promise);
    return promise;
  };

  return {
    sessionRuntimes: maps.sessionRuntimes,
    planBindings: maps.planBindings,
    sessionFlags: maps.sessionFlags,
    sessionAccessOrder: maps.sessionAccessOrder,
    touchSession: (id) => touchSession(maps, id),
    getFlags: (id) => getFlags(maps, id),
    getRuntime
  };
}

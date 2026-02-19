import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  backgroundTaskJobSchema,
  backgroundTaskStoreSchema,
  type BackgroundTaskJob,
  type BackgroundTaskPayload,
  type BackgroundTaskStore,
  type Policy
} from "../contracts/index.js";
import { runTask } from "../orchestrator/core-agent.js";
import { addTaskResearchEntry } from "../tasks/task-lifecycle.js";
import { loadMcpIntegrations } from "../policies/policy-loader.js";
import { runMcpSearch } from "../mcp/providers.js";

const DEFAULT_STORE_PATH = path.join(".tmp", "background-tasks.json");

function nowIso(): string {
  return new Date().toISOString();
}

function resolveStorePath(storePath?: string): string {
  return path.resolve(storePath ?? DEFAULT_STORE_PATH);
}

function createEmptyStore(): BackgroundTaskStore {
  return backgroundTaskStoreSchema.parse({ version: 1, jobs: [] });
}

export function readBackgroundTaskStore(storePath?: string): BackgroundTaskStore {
  const filePath = resolveStorePath(storePath);
  if (!existsSync(filePath)) {
    return createEmptyStore();
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return backgroundTaskStoreSchema.parse(parsed);
}

export function writeBackgroundTaskStore(storeInput: unknown, storePath?: string): BackgroundTaskStore {
  const store = backgroundTaskStoreSchema.parse(storeInput);
  const filePath = resolveStorePath(storePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

export function enqueueBackgroundTask(payloadInput: unknown, storePath?: string): BackgroundTaskJob {
  const payload = payloadInput as BackgroundTaskPayload;
  const store = readBackgroundTaskStore(storePath);
  const job = backgroundTaskJobSchema.parse({
    id: `bg-${Date.now()}`,
    status: "queued",
    payload,
    createdAt: nowIso()
  });
  writeBackgroundTaskStore({ ...store, jobs: [...store.jobs, job] }, storePath);
  return job;
}

export function listBackgroundTasks(storePath?: string): BackgroundTaskJob[] {
  return readBackgroundTaskStore(storePath).jobs;
}

export function getBackgroundTask(jobId: string, storePath?: string): BackgroundTaskJob | undefined {
  return readBackgroundTaskStore(storePath).jobs.find((job) => job.id === jobId);
}

function withUpdatedJob(
  jobId: string,
  updater: (job: BackgroundTaskJob) => BackgroundTaskJob,
  storePath?: string
): BackgroundTaskJob | undefined {
  const store = readBackgroundTaskStore(storePath);
  const current = store.jobs.find((entry) => entry.id === jobId);
  if (!current) {
    return undefined;
  }
  const updated = updater(current);
  writeBackgroundTaskStore(
    {
      ...store,
      jobs: store.jobs.map((entry) => (entry.id === jobId ? updated : entry))
    },
    storePath
  );
  return updated;
}

export function startBackgroundTask(jobId: string, storePath?: string): BackgroundTaskJob | undefined {
  return withUpdatedJob(
    jobId,
    (job) => ({
      ...job,
      status: "running",
      startedAt: nowIso()
    }),
    storePath
  );
}

export function completeBackgroundTask(jobId: string, result: unknown, storePath?: string): BackgroundTaskJob | undefined {
  return withUpdatedJob(
    jobId,
    (job) => ({
      ...job,
      status: "completed",
      result,
      finishedAt: nowIso(),
      error: undefined
    }),
    storePath
  );
}

export function failBackgroundTask(jobId: string, error: string, storePath?: string): BackgroundTaskJob | undefined {
  return withUpdatedJob(
    jobId,
    (job) => ({
      ...job,
      status: "failed",
      finishedAt: nowIso(),
      error
    }),
    storePath
  );
}

export function listDispatchableTasks(policy: Policy, storePath?: string): BackgroundTaskJob[] {
  const store = readBackgroundTaskStore(storePath);
  const running = store.jobs.filter((job) => job.status === "running").length;
  const capacity = Math.max(policy.backgroundTask.defaultConcurrency - running, 0);
  if (capacity <= 0) {
    return [];
  }
  return store.jobs.filter((job) => job.status === "queued").slice(0, capacity);
}

export function markStaleTasks(policy: Policy, storePath?: string): number {
  const now = Date.now();
  const staleCutoffMs = policy.backgroundTask.staleTimeoutMs;
  const store = readBackgroundTaskStore(storePath);
  let staleCount = 0;

  const jobs = store.jobs.map((job) => {
    if (job.status !== "running" || !job.startedAt) {
      return job;
    }
    if (now - Date.parse(job.startedAt) <= staleCutoffMs) {
      return job;
    }
    staleCount += 1;
    return {
      ...job,
      status: "failed" as const,
      finishedAt: nowIso(),
      error: "Marked stale by runtime timeout."
    };
  });

  if (staleCount > 0) {
    writeBackgroundTaskStore({ ...store, jobs }, storePath);
  }

  return staleCount;
}

export async function executeBackgroundTask(jobId: string, policy: Policy, storePath?: string): Promise<BackgroundTaskJob> {
  const started = startBackgroundTask(jobId, storePath);
  if (!started) {
    throw new Error(`Background job not found: ${jobId}`);
  }

  try {
    if (started.payload.kind === "run-task") {
      if (!started.payload.task) {
        throw new Error("Missing task payload for run-task job.");
      }
      const result = await runTask(started.payload.task, policy);
      const completed = completeBackgroundTask(jobId, result, storePath);
      if (!completed) {
        throw new Error(`Failed to persist completed state for ${jobId}`);
      }
      return completed;
    }

    if (started.payload.kind === "mcp-search") {
      if (!started.payload.mcpProvider || !started.payload.query) {
        throw new Error("Missing mcp search payload fields.");
      }
      const mcp = loadMcpIntegrations(policy);
      const result = await runMcpSearch(started.payload.mcpProvider, started.payload.query, mcp);
      if (started.payload.featureId) {
        const mutation = addTaskResearchEntry(
          started.payload.featureId,
          {
            provider: result.provider,
            query: result.query,
            summary: result.summary,
            links: result.items.map((item) => item.locator)
          },
          undefined
        );
        if (!mutation.ok) {
          throw new Error(mutation.message);
        }
      }
      const completed = completeBackgroundTask(jobId, result, storePath);
      if (!completed) {
        throw new Error(`Failed to persist completed state for ${jobId}`);
      }
      return completed;
    }

    throw new Error(`Unsupported job kind: ${(started.payload as BackgroundTaskPayload).kind}`);
  } catch (error) {
    const failed = failBackgroundTask(jobId, (error as Error).message, storePath);
    if (!failed) {
      throw error;
    }
    return failed;
  }
}

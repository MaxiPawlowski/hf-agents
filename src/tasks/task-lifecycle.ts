import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  taskResearchEntrySchema,
  taskLifecycleStateSchema,
  taskLifecycleStoreSchema,
  type TaskBundle,
  type TaskLifecycleState,
  type TaskLifecycleStore,
  type TaskLifecycleSubtask,
  type TaskResearchEntry
} from "../contracts/index.js";

const DEFAULT_STORAGE_PATH = path.join(".tmp", "task-lifecycle.json");

type LifecycleSubtaskStatus = TaskLifecycleSubtask["status"];

type LifecycleMutationResult =
  | { ok: true; task: TaskLifecycleState; message: string }
  | { ok: false; message: string };

function nowIso(): string {
  return new Date().toISOString();
}

function resolveStoragePath(storagePath?: string): string {
  return path.resolve(storagePath ?? DEFAULT_STORAGE_PATH);
}

function createEmptyStore(): TaskLifecycleStore {
  return taskLifecycleStoreSchema.parse({ version: 1, tasks: [] });
}

export function readTaskLifecycleStore(storagePath?: string): TaskLifecycleStore {
  const filePath = resolveStoragePath(storagePath);
  if (!existsSync(filePath)) {
    return createEmptyStore();
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return taskLifecycleStoreSchema.parse(parsed);
}

export function writeTaskLifecycleStore(storeInput: unknown, storagePath?: string): TaskLifecycleStore {
  const store = taskLifecycleStoreSchema.parse(storeInput);
  const filePath = resolveStoragePath(storagePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

function computeLifecycleStatus(subtasks: TaskLifecycleState["subtasks"]): TaskLifecycleState["status"] {
  if (subtasks.some((subtask) => subtask.status === "blocked")) {
    return "blocked";
  }
  if (subtasks.every((subtask) => subtask.status === "completed")) {
    return "completed";
  }
  return "active";
}

function isDependencySatisfied(task: TaskLifecycleState, seq: string): boolean {
  const subtask = task.subtasks.find((entry) => entry.seq === seq);
  if (!subtask) {
    return false;
  }
  return subtask.dependsOn.every((depSeq) => task.subtasks.some((dep) => dep.seq === depSeq && dep.status === "completed"));
}

function toLifecycleState(bundle: TaskBundle): TaskLifecycleState {
  const timestamp = nowIso();
  const subtasks = bundle.subtasks.map((subtask) => ({
    id: subtask.id,
    seq: subtask.seq,
    title: subtask.title,
    status: subtask.status,
    blockedReason: undefined,
    dependsOn: subtask.dependsOn,
    parallel: subtask.parallel,
    suggestedAgent: subtask.suggestedAgent,
    updatedAt: timestamp
  }));
  return taskLifecycleStateSchema.parse({
    featureId: bundle.featureId,
    name: bundle.name,
    objective: bundle.objective,
    status: computeLifecycleStatus(subtasks),
    contextFiles: bundle.contextFiles,
    referenceFiles: bundle.referenceFiles,
    exitCriteria: bundle.exitCriteria,
    subtasks,
    researchLog: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function upsertTaskLifecycle(bundle: TaskBundle, storagePath?: string): TaskLifecycleState {
  const store = readTaskLifecycleStore(storagePath);
  const existing = store.tasks.find((entry) => entry.featureId === bundle.featureId);

  if (!existing) {
    const created = toLifecycleState(bundle);
    writeTaskLifecycleStore({ ...store, tasks: [...store.tasks, created] }, storagePath);
    return created;
  }

  const timestamp = nowIso();
  const nextBySeq = new Map(bundle.subtasks.map((subtask) => [subtask.seq, subtask]));
  const mergedSubtasks: TaskLifecycleState["subtasks"] = bundle.subtasks.map((subtask) => {
    const previous = existing.subtasks.find((entry) => entry.seq === subtask.seq);
    const status = previous ? previous.status : subtask.status;
    return {
      id: subtask.id,
      seq: subtask.seq,
      title: subtask.title,
      status,
      blockedReason: previous ? previous.blockedReason : undefined,
      dependsOn: subtask.dependsOn,
      parallel: subtask.parallel,
      suggestedAgent: subtask.suggestedAgent,
      updatedAt: previous ? previous.updatedAt : timestamp
    } as TaskLifecycleSubtask;
  });

  for (const previous of existing.subtasks) {
    if (!nextBySeq.has(previous.seq)) {
      mergedSubtasks.push(previous);
    }
  }

  const updated = taskLifecycleStateSchema.parse({
    ...existing,
    name: bundle.name,
    objective: bundle.objective,
    contextFiles: bundle.contextFiles,
    referenceFiles: bundle.referenceFiles,
    exitCriteria: bundle.exitCriteria,
    subtasks: mergedSubtasks,
    status: computeLifecycleStatus(mergedSubtasks),
    updatedAt: timestamp
  });

  writeTaskLifecycleStore(
    {
      ...store,
      tasks: store.tasks.map((entry) => (entry.featureId === bundle.featureId ? updated : entry))
    },
    storagePath
  );

  return updated;
}

export function listTaskLifecycles(storagePath?: string): TaskLifecycleState[] {
  return readTaskLifecycleStore(storagePath).tasks;
}

export function getTaskLifecycle(featureId: string, storagePath?: string): TaskLifecycleState | undefined {
  return readTaskLifecycleStore(storagePath).tasks.find((entry) => entry.featureId === featureId);
}

export function setTaskSubtaskStatus(
  featureId: string,
  seq: string,
  status: LifecycleSubtaskStatus,
  storagePath?: string
): TaskLifecycleState | undefined {
  const result = setTaskSubtaskStatusValidated(featureId, seq, status, storagePath);
  return result.ok ? result.task : undefined;
}

export function setTaskSubtaskStatusValidated(
  featureId: string,
  seq: string,
  status: LifecycleSubtaskStatus,
  storagePath?: string,
  blockedReason?: string
): LifecycleMutationResult {
  const store = readTaskLifecycleStore(storagePath);
  const task = store.tasks.find((entry) => entry.featureId === featureId);
  if (!task) {
    return { ok: false, message: `Task not found: ${featureId}` };
  }

  const existing = task.subtasks.find((entry) => entry.seq === seq);
  if (!existing) {
    return { ok: false, message: `Subtask not found: ${seq}` };
  }

  if ((status === "in_progress" || status === "completed") && !isDependencySatisfied(task, seq)) {
    return { ok: false, message: `Dependencies are not resolved for subtask ${seq}.` };
  }

  if (status === "blocked" && (!blockedReason || blockedReason.trim().length === 0)) {
    return { ok: false, message: "Blocked status requires a blocked reason." };
  }

  const timestamp = nowIso();
  const subtasks = task.subtasks.map((subtask) => {
    if (subtask.seq !== seq) {
      return subtask;
    }
    return {
      ...subtask,
      status,
      blockedReason: status === "blocked" ? blockedReason : undefined,
      updatedAt: timestamp
    };
  });

  const updated = taskLifecycleStateSchema.parse({
    ...task,
    subtasks,
    status: computeLifecycleStatus(subtasks),
    updatedAt: timestamp
  });

  writeTaskLifecycleStore(
    {
      ...store,
      tasks: store.tasks.map((entry) => (entry.featureId === featureId ? updated : entry))
    },
    storagePath
  );

  return {
    ok: true,
    task: updated,
    message: `Updated subtask ${seq} to ${status}.`
  };
}

export function buildTaskResume(featureId: string, storagePath?: string): {
  featureId: string;
  status: TaskLifecycleState["status"];
  nextSubtask?: TaskLifecycleSubtask;
  blockedSubtasks: TaskLifecycleSubtask[];
  message: string;
} | undefined {
  const task = getTaskLifecycle(featureId, storagePath);
  if (!task) {
    return undefined;
  }

  const blockedSubtasks = task.subtasks.filter((subtask) => subtask.status === "blocked");
  const nextSubtask = task.subtasks.find((subtask) => {
    if (subtask.status === "completed" || subtask.status === "blocked") {
      return false;
    }
    return subtask.dependsOn.every((depSeq) =>
      task.subtasks.some((dep) => dep.seq === depSeq && dep.status === "completed")
    );
  });

  if (task.status === "completed") {
    return {
      featureId,
      status: task.status,
      blockedSubtasks,
      message: "All subtasks are complete."
    };
  }

  if (!nextSubtask) {
    return {
      featureId,
      status: task.status,
      blockedSubtasks,
      message: blockedSubtasks.length > 0 ? "Resolve blocked subtasks before continuing." : "No ready subtask found."
    };
  }

  return {
    featureId,
    status: task.status,
    nextSubtask,
    blockedSubtasks,
    message: `Resume at ${nextSubtask.seq}: ${nextSubtask.title}`
  };
}

export function getNextReadySubtask(featureId: string, storagePath?: string): TaskLifecycleSubtask | undefined {
  return buildTaskResume(featureId, storagePath)?.nextSubtask;
}

export function listBlockedSubtasks(
  featureId: string,
  storagePath?: string
): Array<{ subtask: TaskLifecycleSubtask; reason: string }> {
  const task = getTaskLifecycle(featureId, storagePath);
  if (!task) {
    return [];
  }

  return task.subtasks
    .filter((subtask) => subtask.status === "blocked")
    .map((subtask) => ({
      subtask,
      reason: subtask.blockedReason ?? "No reason recorded."
    }));
}

export function addTaskResearchEntry(
  featureId: string,
  entryInput: Omit<TaskResearchEntry, "createdAt" | "id">,
  storagePath?: string
): LifecycleMutationResult {
  const store = readTaskLifecycleStore(storagePath);
  const task = store.tasks.find((entry) => entry.featureId === featureId);
  if (!task) {
    return { ok: false, message: `Task not found: ${featureId}` };
  }

  const timestamp = nowIso();
  const entry = taskResearchEntrySchema.parse({
    ...entryInput,
    id: `research-${Date.now()}`,
    createdAt: timestamp
  });

  const updated = taskLifecycleStateSchema.parse({
    ...task,
    researchLog: [...task.researchLog, entry],
    updatedAt: timestamp
  });

  writeTaskLifecycleStore(
    {
      ...store,
      tasks: store.tasks.map((entryTask) => (entryTask.featureId === featureId ? updated : entryTask))
    },
    storagePath
  );

  return {
    ok: true,
    task: updated,
    message: `Recorded ${entry.provider} research for ${featureId}.`
  };
}

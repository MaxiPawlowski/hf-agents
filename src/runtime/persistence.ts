import path from "node:path";
import { promises as fs } from "node:fs";

import type { ParsedPlan, RuntimeEvent, RuntimeStatus, VaultContext, VaultDocument, VaultPaths } from "./types.js";
import { validateTurnOutcome } from "./turn-outcome-trailer.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RuntimePaths {
  runtimeDir: string;
  statusPath: string;
  eventsPath: string;
  resumePromptPath: string;
}

const PLAN_VAULT_FILES = [
  { name: "context.md", title: "Plan context" },
  { name: "discoveries.md", title: "Plan discoveries" },
  { name: "decisions.md", title: "Plan decisions" },
  { name: "references.md", title: "Plan references" }
] as const;

const SHARED_VAULT_FILES = [
  { name: "architecture.md", title: "Shared architecture" },
  { name: "patterns.md", title: "Shared patterns" },
  { name: "decisions.md", title: "Shared decisions" }
] as const;

export function getRuntimePaths(plan: ParsedPlan): RuntimePaths {
  const runtimeDir = path.join(path.dirname(plan.path), "runtime", plan.slug);

  return {
    runtimeDir,
    statusPath: path.join(runtimeDir, "status.json"),
    eventsPath: path.join(runtimeDir, "events.jsonl"),
    resumePromptPath: path.join(runtimeDir, "resume-prompt.txt")
  };
}

export function getVaultPaths(plan: ParsedPlan): VaultPaths {
  const plansDir = path.dirname(plan.path);
  const repoRoot = path.dirname(plansDir);
  const vaultRoot = path.join(repoRoot, "vault");
  const planDir = path.join(vaultRoot, "plans", plan.slug);
  const sharedDir = path.join(vaultRoot, "shared");

  return {
    vaultRoot,
    planDir,
    sharedDir,
    planFiles: PLAN_VAULT_FILES.map((file) => path.join(planDir, file.name)),
    sharedFiles: SHARED_VAULT_FILES.map((file) => path.join(sharedDir, file.name))
  };
}

export async function ensureRuntimeDir(plan: ParsedPlan): Promise<RuntimePaths> {
  const runtimePaths = getRuntimePaths(plan);
  await fs.mkdir(runtimePaths.runtimeDir, { recursive: true });
  return runtimePaths;
}

export async function readStatus(runtimePaths: RuntimePaths): Promise<RuntimeStatus | null> {
  try {
    const raw = await fs.readFile(runtimePaths.statusPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid runtime status JSON at ${runtimePaths.statusPath}: ${(error as Error).message}`);
    }
    validateRuntimeStatus(parsed, runtimePaths.statusPath);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeStatus(runtimePaths: RuntimePaths, status: RuntimeStatus): Promise<void> {
  await fs.writeFile(runtimePaths.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function appendEvent(runtimePaths: RuntimePaths, event: RuntimeEvent): Promise<void> {
  await fs.appendFile(runtimePaths.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function writeResumePrompt(runtimePaths: RuntimePaths, prompt: string): Promise<void> {
  await fs.writeFile(runtimePaths.resumePromptPath, `${prompt.trim()}\n`, "utf8");
}

export async function readEventLines(runtimePaths: RuntimePaths): Promise<string[]> {
  try {
    const raw = await fs.readFile(runtimePaths.eventsPath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readVaultContext(vaultPaths: VaultPaths): Promise<VaultContext> {
  const [plan, shared] = await Promise.all([
    readVaultDocuments(vaultPaths.planFiles, PLAN_VAULT_FILES),
    readVaultDocuments(vaultPaths.sharedFiles, SHARED_VAULT_FILES)
  ]);

  return { plan, shared };
}

async function readVaultDocuments(
  filePaths: string[],
  fileDefs: ReadonlyArray<{ name: string; title: string }>
): Promise<VaultDocument[]> {
  const documents = await Promise.all(filePaths.map(async (filePath, index) => {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const trimmed = content.trim();
      if (!trimmed) {
        return null;
      }

      return {
        path: filePath,
        title: fileDefs[index]?.title ?? path.basename(filePath, path.extname(filePath)),
        content: trimmed
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }));

  return documents.filter((document): document is VaultDocument => document !== null);
}

function validateRuntimeStatus(value: unknown, statusPath: string): asserts value is RuntimeStatus {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: expected an object.`);
  }

  expectLiteral(value.version, 1, "version", statusPath);
  expectString(value.planPath, "planPath", statusPath);
  expectString(value.planSlug, "planSlug", statusPath);
  expectNumber(value.planMtimeMs, "planMtimeMs", statusPath);
  expectEnum(value.loopState, ["idle", "running", "paused", "escalated", "complete"], "loopState", statusPath);
  expectEnum(value.phase, ["planning", "execution"], "phase", statusPath);
  expectNullableMilestone(value.currentMilestone, "currentMilestone", statusPath);
  expectCounters(value.counters, statusPath);
  expectSessions(value.sessions, statusPath);
  expectSubagents(value.subagents, statusPath);
  expectBoolean(value.autoContinue, "autoContinue", statusPath);
  expectString(value.updatedAt, "updatedAt", statusPath);

  if (value.lastProgressAt !== undefined) {
    expectString(value.lastProgressAt, "lastProgressAt", statusPath);
  }
  if (value.recommendedNextAction !== undefined) {
    expectString(value.recommendedNextAction, "recommendedNextAction", statusPath);
  }
  if (value.lastTurnEvaluatedAt !== undefined) {
    expectString(value.lastTurnEvaluatedAt, "lastTurnEvaluatedAt", statusPath);
  }
  if (value.lastBlocker !== undefined) {
    expectLastBlocker(value.lastBlocker, statusPath);
  }
  if (value.lastVerification !== undefined) {
    expectLastVerification(value.lastVerification, statusPath);
  }
  if (value.recovery !== undefined) {
    expectRecovery(value.recovery, statusPath);
  }
  if (value.lastOutcome !== undefined && value.lastOutcome !== null) {
    const issues = validateTurnOutcome(value.lastOutcome);
    if (issues.length > 0) {
      throw new Error(`Invalid runtime status at ${statusPath}: lastOutcome ${issues[0]?.path} ${issues[0]?.message}`);
    }
  }
}

function expectString(value: unknown, field: string, statusPath: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be a string.`);
  }
}

function expectNumber(value: unknown, field: string, statusPath: string): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be a number.`);
  }
}

function expectBoolean(value: unknown, field: string, statusPath: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be a boolean.`);
  }
}

function expectLiteral<T extends string | number>(value: unknown, expected: T, field: string, statusPath: string): void {
  if (value !== expected) {
    throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be ${JSON.stringify(expected)}.`);
  }
}

function expectEnum(value: unknown, allowed: string[], field: string, statusPath: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be one of ${allowed.join(", ")}.`);
  }
}

function expectNullableMilestone(value: unknown, field: string, statusPath: string): void {
  if (value === null) {
    return;
  }
  expectMilestone(value, field, statusPath);
}

function expectMilestone(value: unknown, field: string, statusPath: string): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be an object.`);
  }
  expectNumber(value.index, `${field}.index`, statusPath);
  expectBoolean(value.checked, `${field}.checked`, statusPath);
  expectString(value.text, `${field}.text`, statusPath);
  expectString(value.title, `${field}.title`, statusPath);
}

function expectCounters(value: unknown, statusPath: string): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: counters must be an object.`);
  }

  for (const field of [
    "totalAttempts",
    "totalTurns",
    "maxTotalTurns",
    "noProgress",
    "repeatedBlocker",
    "verificationFailures",
    "turnsSinceLastOutcome"
  ]) {
    expectNumber(value[field], `counters.${field}`, statusPath);
  }
}

function expectSessions(value: unknown, statusPath: string): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: sessions must be an object.`);
  }

  for (const [vendor, session] of Object.entries(value)) {
    if (session === undefined) {
      continue;
    }
    if (!isRecord(session)) {
      throw new Error(`Invalid runtime status at ${statusPath}: sessions.${vendor} must be an object.`);
    }
    expectString(session.id, `sessions.${vendor}.id`, statusPath);
    expectString(session.updatedAt, `sessions.${vendor}.updatedAt`, statusPath);
  }
}

function expectSubagents(value: unknown, statusPath: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: subagents must be an array.`);
  }

  value.forEach((subagent, index) => {
    if (!isRecord(subagent)) {
      throw new Error(`Invalid runtime status at ${statusPath}: subagents[${index}] must be an object.`);
    }
    expectString(subagent.id, `subagents[${index}].id`, statusPath);
    expectString(subagent.name, `subagents[${index}].name`, statusPath);
    expectString(subagent.startedAt, `subagents[${index}].startedAt`, statusPath);
    expectEnum(subagent.status, ["running", "completed", "failed"], `subagents[${index}].status`, statusPath);
    if (subagent.completedAt !== undefined) {
      expectString(subagent.completedAt, `subagents[${index}].completedAt`, statusPath);
    }
  });
}

function expectLastBlocker(value: unknown, statusPath: string): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: lastBlocker must be an object.`);
  }
  expectString(value.signature, "lastBlocker.signature", statusPath);
  expectString(value.message, "lastBlocker.message", statusPath);
  expectString(value.at, "lastBlocker.at", statusPath);
}

function expectLastVerification(value: unknown, statusPath: string): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: lastVerification must be an object.`);
  }
  expectEnum(value.status, ["pass", "fail", "unknown"], "lastVerification.status", statusPath);
  if (value.summary !== undefined) {
    expectString(value.summary, "lastVerification.summary", statusPath);
  }
  expectString(value.at, "lastVerification.at", statusPath);
}

function expectRecovery(value: unknown, statusPath: string): void {
  if (!isRecord(value)) {
    throw new Error(`Invalid runtime status at ${statusPath}: recovery must be an object.`);
  }
  expectEnum(value.trigger, ["stop", "idle", "compact", "resume"], "recovery.trigger", statusPath);
  if (value.sourceTrigger !== undefined) {
    expectEnum(value.sourceTrigger, ["stop", "idle", "compact"], "recovery.sourceTrigger", statusPath);
  }
  expectEnum(value.vendor, ["opencode", "claude", "runtime"], "recovery.vendor", statusPath);
  expectString(value.eventType, "recovery.eventType", statusPath);
  if (value.sessionId !== undefined) {
    expectString(value.sessionId, "recovery.sessionId", statusPath);
  }
  expectBoolean(value.pendingOutcome, "recovery.pendingOutcome", statusPath);
  expectString(value.at, "recovery.at", statusPath);
}

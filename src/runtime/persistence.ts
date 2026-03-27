import path from "node:path";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { IndexCodeConfig, IndexConfig, ParsedPlan, RuntimeEvent, RuntimeStatus, VaultContext, VaultDocument, VaultPaths } from "./types.js";
import { validateTurnOutcome } from "./turn-outcome-trailer.js";
import { isRecord } from "./utils.js";

function resolvePackageRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    if (existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve package root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

function loadDefaultIndexConfig(): IndexConfig {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolvePackageRoot(moduleDir);
  const configPath = path.join(packageRoot, "schemas", "index-defaults.json");
  return JSON.parse(readFileSync(configPath, "utf8")) as IndexConfig;
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = loadDefaultIndexConfig();

function mergeCodeConfig(defaults: IndexCodeConfig, raw: unknown): IndexCodeConfig {
  if (!isRecord(raw)) return defaults;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
    roots: Array.isArray(raw.roots) && raw.roots.every((r: unknown) => typeof r === "string") ? raw.roots as string[] : defaults.roots,
    extensions: Array.isArray(raw.extensions) && raw.extensions.every((e: unknown) => typeof e === "string") ? raw.extensions as string[] : defaults.extensions,
    exclude: Array.isArray(raw.exclude) && raw.exclude.every((e: unknown) => typeof e === "string") ? raw.exclude as string[] : defaults.exclude,
  };
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && !Number.isNaN(value) && value > 0 ? value : fallback;
}

export async function loadIndexConfig(repoRoot: string): Promise<IndexConfig> {
  const configPath = path.join(repoRoot, "hybrid-framework.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.index)) {
      return { ...DEFAULT_INDEX_CONFIG };
    }
    const idx = parsed.index;
    return {
      enabled: typeof idx.enabled === "boolean" ? idx.enabled : DEFAULT_INDEX_CONFIG.enabled,
      code: mergeCodeConfig(DEFAULT_INDEX_CONFIG.code, idx.code),
      semanticTopK: safeNumber(idx.semanticTopK, DEFAULT_INDEX_CONFIG.semanticTopK),
      maxChunkChars: safeNumber(idx.maxChunkChars, DEFAULT_INDEX_CONFIG.maxChunkChars),
      embeddingBatchSize: safeNumber(idx.embeddingBatchSize, DEFAULT_INDEX_CONFIG.embeddingBatchSize),
      timeoutMs: safeNumber(idx.timeoutMs, DEFAULT_INDEX_CONFIG.timeoutMs),
      charBudget: safeNumber(idx.charBudget, DEFAULT_INDEX_CONFIG.charBudget),
      planningCharBudget: safeNumber(idx.planningCharBudget, DEFAULT_INDEX_CONFIG.planningCharBudget),
      planningSemanticTopK: safeNumber(idx.planningSemanticTopK, DEFAULT_INDEX_CONFIG.planningSemanticTopK),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_INDEX_CONFIG };
    }
    if (error instanceof SyntaxError) {
      console.error(`[loadIndexConfig] Invalid JSON in ${configPath}, using defaults.`);
      return { ...DEFAULT_INDEX_CONFIG };
    }
    throw error;
  }
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

export function getPlanlessRuntimePaths(cwd: string): RuntimePaths {
  const runtimeDir = path.join(cwd, "plans", "runtime", "_planless");

  return {
    runtimeDir,
    statusPath: path.join(runtimeDir, "status.json"),
    eventsPath: path.join(runtimeDir, "events.jsonl"),
    resumePromptPath: path.join(runtimeDir, "resume-prompt.txt")
  };
}

export async function ensurePlanlessRuntimeDir(cwd: string): Promise<RuntimePaths> {
  const runtimePaths = getPlanlessRuntimePaths(cwd);
  await fs.mkdir(runtimePaths.runtimeDir, { recursive: true });
  return runtimePaths;
}

export function getRepoRoot(plan?: ParsedPlan, planlessCwd?: string): string {
  if (plan) {
    return path.dirname(path.dirname(plan.path));
  }

  if (planlessCwd) {
    return planlessCwd;
  }

  throw new Error("Repo root requires a parsed plan or a planless cwd.");
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

export function getPlanlessVaultPaths(cwd: string): VaultPaths {
  const vaultRoot = path.join(cwd, "vault");
  const sharedDir = path.join(vaultRoot, "shared");

  return {
    vaultRoot,
    planDir: "",
    sharedDir,
    planFiles: [],
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

/**
 * Per-file write queue to prevent concurrent appendFile calls from
 * interleaving partial JSON lines.
 */
const writeQueues = new Map<string, Promise<void>>();

export async function appendEvent(runtimePaths: RuntimePaths, event: RuntimeEvent): Promise<void> {
  const key = runtimePaths.eventsPath;
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.appendFile(key, `${JSON.stringify(event)}\n`, "utf8");
  });
  writeQueues.set(key, next.catch((error) => {
    console.error(`[appendEvent] Failed to append to ${key}: ${(error as Error).message}`);
  }));
  await next;
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

// ── Compact validation helpers ──────────────────────────────────────
// Each helper throws with a consistent message format:
//   "Invalid runtime status at <path>: <field> must be <constraint>."

function fail(statusPath: string, field: string, constraint: string): never {
  throw new Error(`Invalid runtime status at ${statusPath}: ${field} must be ${constraint}.`);
}

function expectString(v: unknown, f: string, p: string): asserts v is string { if (typeof v !== "string") fail(p, f, "a string"); }
function expectNumber(v: unknown, f: string, p: string): asserts v is number { if (typeof v !== "number" || Number.isNaN(v)) fail(p, f, "a number"); }
function expectBoolean(v: unknown, f: string, p: string): asserts v is boolean { if (typeof v !== "boolean") fail(p, f, "a boolean"); }

function expectEnum(v: unknown, allowed: readonly string[], f: string, p: string): void {
  if (typeof v !== "string" || !allowed.includes(v)) fail(p, f, `one of ${allowed.join(", ")}`);
}

function expectObject(v: unknown, f: string, p: string): asserts v is Record<string, unknown> {
  if (!isRecord(v)) fail(p, f, "an object");
}

/** Validate a flat record where every listed key must be a certain type. */
function expectFields(
  obj: Record<string, unknown>,
  fields: Record<string, "string" | "number" | "boolean">,
  prefix: string,
  p: string,
): void {
  for (const [key, type] of Object.entries(fields)) {
    const fq = prefix ? `${prefix}.${key}` : key;
    if (type === "string") expectString(obj[key], fq, p);
    else if (type === "number") expectNumber(obj[key], fq, p);
    else expectBoolean(obj[key], fq, p);
  }
}

/** Validate a field only if it's present (not undefined). */
function optionalString(obj: Record<string, unknown>, key: string, prefix: string, p: string): void {
  if (obj[key] !== undefined) expectString(obj[key], `${prefix}.${key}`, p);
}

function optionalBoolean(obj: Record<string, unknown>, key: string, prefix: string, p: string): void {
  if (obj[key] !== undefined) expectBoolean(obj[key], `${prefix}.${key}`, p);
}

function validateRuntimeStatus(value: unknown, statusPath: string): asserts value is RuntimeStatus {
  const p = statusPath;
  expectObject(value, "root", p);

  if (value.version !== 1) fail(p, "version", "1");
  expectFields(value, { planPath: "string", planSlug: "string", planMtimeMs: "number", autoContinue: "boolean", updatedAt: "string" }, "", p);
  expectEnum(value.loopState, ["idle", "running", "paused", "escalated", "complete"], "loopState", p);
  expectEnum(value.phase, ["planning", "execution"], "phase", p);

  // currentMilestone: null | object
  if (value.currentMilestone !== null) {
    expectObject(value.currentMilestone, "currentMilestone", p);
    expectFields(value.currentMilestone, { index: "number", checked: "boolean", text: "string", title: "string" }, "currentMilestone", p);
  }

  // counters
  expectObject(value.counters, "counters", p);
  for (const f of ["totalAttempts", "totalTurns", "maxTotalTurns", "noProgress", "repeatedBlocker", "verificationFailures", "turnsSinceLastOutcome"]) {
    expectNumber(value.counters[f], `counters.${f}`, p);
  }

  // sessions
  expectObject(value.sessions, "sessions", p);
  for (const [vendor, session] of Object.entries(value.sessions)) {
    if (session === undefined) continue;
    expectObject(session, `sessions.${vendor}`, p);
    expectFields(session, { id: "string", updatedAt: "string" }, `sessions.${vendor}`, p);
  }

  // subagents
  if (!Array.isArray(value.subagents)) fail(p, "subagents", "an array");
  (value.subagents as unknown[]).forEach((sub, i) => {
    expectObject(sub, `subagents[${i}]`, p);
    expectFields(sub, { id: "string", name: "string", startedAt: "string" }, `subagents[${i}]`, p);
    expectEnum(sub.status, ["running", "completed", "failed"], `subagents[${i}].status`, p);
    optionalString(sub, "completedAt", `subagents[${i}]`, p);
  });

  // optional top-level strings
  for (const key of ["lastProgressAt", "recommendedNextAction", "lastTurnEvaluatedAt"] as const) {
    optionalString(value, key, "", p);
  }
  optionalBoolean(value, "awaitingBuilderApproval", "", p);

  // lastBlocker
  if (value.lastBlocker !== undefined) {
    expectObject(value.lastBlocker, "lastBlocker", p);
    expectFields(value.lastBlocker, { signature: "string", message: "string", at: "string" }, "lastBlocker", p);
  }

  // lastVerification
  if (value.lastVerification !== undefined) {
    expectObject(value.lastVerification, "lastVerification", p);
    expectEnum(value.lastVerification.status, ["pass", "fail", "unknown"], "lastVerification.status", p);
    optionalString(value.lastVerification, "summary", "lastVerification", p);
    expectString(value.lastVerification.at, "lastVerification.at", p);
  }

  // recovery
  if (value.recovery !== undefined) {
    expectObject(value.recovery, "recovery", p);
    expectEnum(value.recovery.trigger, ["stop", "idle", "compact", "resume"], "recovery.trigger", p);
    if (value.recovery.sourceTrigger !== undefined) {
      expectEnum(value.recovery.sourceTrigger, ["stop", "idle", "compact"], "recovery.sourceTrigger", p);
    }
    expectEnum(value.recovery.vendor, ["opencode", "claude", "runtime"], "recovery.vendor", p);
    expectFields(value.recovery, { eventType: "string", pendingOutcome: "boolean", at: "string" }, "recovery", p);
    optionalString(value.recovery, "sessionId", "recovery", p);
  }

  // lastOutcome
  if (value.lastOutcome !== undefined && value.lastOutcome !== null) {
    const issues = validateTurnOutcome(value.lastOutcome);
    if (issues.length > 0) {
      throw new Error(`Invalid runtime status at ${p}: lastOutcome ${issues[0]?.path} ${issues[0]?.message}`);
    }
  }
}

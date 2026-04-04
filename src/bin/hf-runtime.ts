#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HybridLoopRuntime, resolveManagedPlanPath } from "../runtime/runtime.js";
import { DEFAULT_INDEX_CONFIG, getRuntimePaths, loadIndexConfig, readEventLines } from "../runtime/persistence.js";
import { parsePlan } from "../runtime/plan-doc.js";
import { runDoctor } from "../runtime/doctor.js";
import { buildTurnOutcomeIngestionEvent, parseTurnOutcomeInput } from "../runtime/turn-outcome-trailer.js";
import { formatToolSearchResults } from "../runtime/prompt.js";
import { buildUnifiedIndex } from "../runtime/unified-index-pipeline.js";
import type { RuntimeVendor } from "../runtime/types.js";
import { isRecord, isString } from "../runtime/utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IndexContext {
  repoRoot: string;
  configPath: string;
}

// ---------------------------------------------------------------------------
// Formatting / parsing helpers
// ---------------------------------------------------------------------------

const DEFAULT_SEARCH_TOP_K = 5;

function formatStatus(planPath: string, status: Awaited<ReturnType<HybridLoopRuntime["hydrate"]>>): string {
  return [
    `plan: ${planPath}`,
    `state: ${status.loopState}`,
    `milestone: ${status.currentMilestone ? `${status.currentMilestone.index}. ${status.currentMilestone.title}` : "none"}`,
    `loop_attempts: ${status.counters.totalAttempts}/${status.counters.maxTotalTurns}`,
    `evaluated_outcomes: ${status.counters.totalTurns}`,
    `no_progress: ${status.counters.noProgress}`,
    `repeated_blocker: ${status.counters.repeatedBlocker}`,
    `verification_failures: ${status.counters.verificationFailures}`,
    `last_progress_at: ${status.lastProgressAt ?? "none"}`,
    `last_blocker: ${status.lastBlocker?.message ?? "none"}`,
    `last_verification: ${status.lastVerification?.status ?? "unknown"}`,
    `recommended_next_action: ${status.recommendedNextAction ?? "none"}`
  ].join(os.EOL);
}

function parseFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parsePlanArg(argv: string[]): string | undefined {
  return argv.find((value, index) => {
    if (value.startsWith("--")) {
      return false;
    }

    const previous = argv[index - 1];
    return previous === undefined || !previous.startsWith("--");
  });
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  hf-runtime status <plan>                                        Show current milestone and loop_attempts/evaluated_outcomes counters");
  console.error("  hf-runtime tail <plan> [--lines N]                              Show recent runtime events");
  console.error("  hf-runtime resume <plan> --via <opencode|claude>                Show the current recovery-aware resume decision/prompt");
  console.error("  hf-runtime doctor <plan>                                        Check runtime sidecars for drift or corruption");
  console.error("  hf-runtime outcome <plan> --json '<TurnOutcome JSON or final turn_outcome trailer>'");
  console.error("  hf-runtime search \"<query>\" [--top-k N] [--source vault|code|all]  Semantic search the vault/code index");
  console.error("  hf-runtime index add <path> [--extensions .ts,.js]              Add an external root to the index and trigger rebuild");
  console.error("  hf-runtime index remove <path>                                  Remove an external root from the index config");
  console.error("  hf-runtime index list                                           List all configured index roots");
  console.error("  hf-runtime index rebuild                                        Force a full index rebuild");
  console.error("  hf-runtime help                                                 Show this help text");
}

// ---------------------------------------------------------------------------
// Index config helpers
// ---------------------------------------------------------------------------

function readHfConfig(ctx: IndexContext): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(ctx.configPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function writeHfConfig(config: Record<string, unknown>, ctx: IndexContext): void {
  fs.writeFileSync(ctx.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getExternalRoots(config: Record<string, unknown>): string[] {
  const idx = config.index;
  if (!isRecord(idx)) return [];
  const ext = idx.external;
  if (!isRecord(ext)) return [];
  const roots = ext.roots;
  if (!Array.isArray(roots)) return [];
  return roots.filter(isString);
}

function ensureExternalConfig(config: Record<string, unknown>): void {
  if (!isRecord(config.index)) {
    config.index = { external: { roots: [] } };
    return;
  }
  const idx = config.index;
  if (!isRecord(idx.external)) {
    idx.external = { roots: [] };
    return;
  }
  const ext = idx.external;
  if (!Array.isArray(ext.roots)) {
    ext.roots = [];
  }
}

// ---------------------------------------------------------------------------
// Index sub-command handlers
// ---------------------------------------------------------------------------

async function runIndexRebuild(ctx: IndexContext, overrideExtensions?: string[]): Promise<void> {
  console.log("Rebuilding index...");
  const indexConfig = await loadIndexConfig(ctx.repoRoot);
  const externalRoots = getExternalRoots(readHfConfig(ctx));
  const rebuildExtensions = overrideExtensions
    ?? indexConfig.external?.extensions
    ?? DEFAULT_INDEX_CONFIG.external?.extensions;
  const rebuildExclude = indexConfig.external?.exclude ?? DEFAULT_INDEX_CONFIG.external?.exclude;

  const result = await buildUnifiedIndex({
    repoRoot: ctx.repoRoot,
    codeConfig: indexConfig.code.enabled !== false
      ? {
        roots: indexConfig.code.roots,
        extensions: indexConfig.code.extensions,
        exclude: indexConfig.code.exclude,
      }
      : undefined,
    externalConfig: externalRoots.length > 0
      ? {
        roots: externalRoots,
        ...(rebuildExtensions ? { extensions: rebuildExtensions } : {}),
        ...(rebuildExclude ? { exclude: rebuildExclude } : {}),
      }
      : undefined,
    embeddingBatchSize: indexConfig.embeddingBatchSize,
    maxChunkChars: indexConfig.maxChunkChars,
  });
  if (result) {
    console.log(`Index rebuilt: ${result.index.items.length} chunks indexed.`);
  } else {
    console.log("Index rebuild complete (no files found).");
  }
}

async function handleIndexAdd(argv: string[], ctx: IndexContext): Promise<void> {
  const rawPath = parsePlanArg(argv);
  if (!rawPath) {
    throw new Error("Missing path argument. Usage: hf-runtime index add <path> [--extensions .ts,.js]");
  }

  const absPath = path.resolve(rawPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: path does not exist: ${absPath}`);
    process.exitCode = 1;
    return;
  }

  const extensionsRaw = parseFlag(argv, "--extensions");
  const extensions = extensionsRaw
    ? extensionsRaw.split(",").map((e) => e.trim()).filter(Boolean)
    : undefined;

  const config = readHfConfig(ctx);
  ensureExternalConfig(config);

  const idx = config.index as Record<string, unknown>;
  const ext = idx.external as Record<string, unknown>;
  const roots = ext.roots as string[];

  if (roots.includes(absPath)) {
    console.log(`Already indexed: ${absPath}`);
    return;
  }

  roots.push(absPath);
  if (extensions) {
    ext.extensions = extensions;
  }

  writeHfConfig(config, ctx);
  console.log(`Added to index: ${absPath}`);
  await runIndexRebuild(ctx, extensions);
}

async function handleIndexRemove(argv: string[], ctx: IndexContext): Promise<void> {
  const rawPath = parsePlanArg(argv);
  if (!rawPath) {
    throw new Error("Missing path argument. Usage: hf-runtime index remove <path>");
  }

  const absPath = path.resolve(rawPath);
  const config = readHfConfig(ctx);
  const roots = getExternalRoots(config);

  if (!roots.includes(absPath)) {
    console.error(`Error: path not found in index roots: ${absPath}`);
    process.exitCode = 1;
    return;
  }

  ensureExternalConfig(config);
  const idx = config.index as Record<string, unknown>;
  const ext = idx.external as Record<string, unknown>;
  ext.roots = (ext.roots as string[]).filter((r) => r !== absPath);

  writeHfConfig(config, ctx);
  console.log(`Removed from index: ${absPath}`);
}

async function handleIndexList(ctx: IndexContext): Promise<void> {
  const indexConfig = await loadIndexConfig(ctx.repoRoot);
  const config = readHfConfig(ctx);
  const externalRoots = getExternalRoots(config);

  console.log("Index roots:");
  console.log(`  vault:    ${path.join(ctx.repoRoot, "vault")}`);

  const codeRoots = indexConfig.code.roots.map((r) => path.resolve(ctx.repoRoot, r));
  if (codeRoots.length > 0) {
    console.log(codeRoots.map((root) => `  code:     ${root}`).join("\n"));
  } else {
    console.log("  code:     (none configured)");
  }

  if (externalRoots.length > 0) {
    console.log(externalRoots.map((root) => `  external: ${root}`).join("\n"));
  } else {
    console.log("  external: (none configured)");
  }
}

async function handleIndex(argv: string[]): Promise<void> {
  const subCmd = argv[0];
  const subArgv = argv.slice(1);

  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, "hybrid-framework.json");
  const ctx: IndexContext = { repoRoot, configPath };

  switch (subCmd) {
    case "add":
      await handleIndexAdd(subArgv, ctx);
      return;
    case "remove":
      await handleIndexRemove(subArgv, ctx);
      return;
    case "list":
      await handleIndexList(ctx);
      return;
    case "rebuild":
      await runIndexRebuild(ctx);
      return;
    default:
      console.error(`Unknown index subcommand: ${subCmd ?? "(none)"}`);
      console.error("Available: add, remove, list, rebuild");
      process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Top-level command handlers
// ---------------------------------------------------------------------------

async function handleStatus(runtime: HybridLoopRuntime, argv: string[]): Promise<void> {
  const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
  const status = await runtime.hydrate(planPath);
  console.log(formatStatus(planPath, status));
}

async function handleTail(argv: string[]): Promise<void> {
  const lines = Number.parseInt(parseFlag(argv, "--lines") ?? "20", 10);
  const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
  const plan = await parsePlan(planPath);
  const runtimePaths = getRuntimePaths(plan);
  const eventLines = await readEventLines(runtimePaths);
  console.log(eventLines.slice(-lines).join(os.EOL));
}

async function handleResume(runtime: HybridLoopRuntime, argv: string[]): Promise<void> {
  const via = parseFlag(argv, "--via") as RuntimeVendor | undefined;
  if (!via || (via !== "opencode" && via !== "claude")) {
    throw new Error("--via must be one of: opencode, claude");
  }

  const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
  await runtime.hydrate(planPath);
  await runtime.recordEvent({
    vendor: via,
    type: "session.resume_requested",
    timestamp: new Date().toISOString()
  });
  const decision = await runtime.decideNext();
  console.log(JSON.stringify(decision, null, 2));
}

async function handleDoctor(argv: string[]): Promise<void> {
  const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
  const result = await runDoctor(planPath);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

async function handleOutcome(runtime: HybridLoopRuntime, argv: string[]): Promise<void> {
  const json = parseFlag(argv, "--json");
  if (!json) {
    throw new Error("Missing --json for outcome command.");
  }

  const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
  await runtime.hydrate(planPath);
  const parsed = parseTurnOutcomeInput(json);
  if (parsed.kind !== "valid") {
    await runtime.recordOutcomeIngestionIssue(buildTurnOutcomeIngestionEvent({
      vendor: "runtime",
      source: "hf-runtime outcome --json",
      result: parsed
    }));
    throw new Error(parsed.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }

  const status = await runtime.evaluateTurn(parsed.outcome);
  const decision = await runtime.decideNext();
  console.log(JSON.stringify({ status, decision }, null, 2));
}

async function handleSearch(runtime: HybridLoopRuntime, argv: string[]): Promise<void> {
  const query = parsePlanArg(argv);
  if (!query) {
    throw new Error("Missing query text. Usage: hf-runtime search \"<query>\" [--top-k N] [--source vault|code|all]");
  }

  const topKRaw = parseFlag(argv, "--top-k");
  const topK = topKRaw !== undefined ? Number.parseInt(topKRaw, 10) : DEFAULT_SEARCH_TOP_K;

  const sourceRaw = parseFlag(argv, "--source");
  let sourceFilter: "vault" | "code" | undefined;
  if (sourceRaw === "vault") sourceFilter = "vault";
  else if (sourceRaw === "code") sourceFilter = "code";

  await runtime.hydratePlanless(process.cwd());
  const results = await runtime.queryIndex(query, topK, sourceFilter);

  if (results === null) {
    console.log("No index available. Run a plan or build the index first.");
    return;
  }

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log(formatToolSearchResults(results));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , command, ...argv] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exitCode = command ? 0 : 1;
    return;
  }

  const runtime = new HybridLoopRuntime();

  switch (command) {
    case "status":
      await handleStatus(runtime, argv);
      return;
    case "tail":
      await handleTail(argv);
      return;
    case "resume":
      await handleResume(runtime, argv);
      return;
    case "doctor":
      await handleDoctor(argv);
      return;
    case "outcome":
      await handleOutcome(runtime, argv);
      return;
    case "search":
      await handleSearch(runtime, argv);
      return;
    case "index":
      await handleIndex(argv);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

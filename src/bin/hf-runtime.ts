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

// oxlint-disable max-lines-per-function -- CLI entry point with exhaustive switch dispatch; cannot be split without losing argv context
async function main(): Promise<void> {
// oxlint-enable max-lines-per-function
  const [, , command, ...argv] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exitCode = command ? 0 : 1;
    return;
  }

  const runtime = new HybridLoopRuntime();

  switch (command) {
    case "status": {
      const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
      const status = await runtime.hydrate(planPath);
      console.log(formatStatus(planPath, status));
      return;
    }

    case "tail": {
      const lines = Number.parseInt(parseFlag(argv, "--lines") ?? "20", 10);
      const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
      const plan = await parsePlan(planPath);
      const runtimePaths = getRuntimePaths(plan);
      const eventLines = await readEventLines(runtimePaths);
      console.log(eventLines.slice(-lines).join(os.EOL));
      return;
    }

    case "resume": {
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
      return;
    }

    case "doctor": {
      const planPath = await resolveManagedPlanPath(process.cwd(), parsePlanArg(argv));
      const result = await runDoctor(planPath);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    case "outcome": {
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
      return;
    }

    case "search": {
      const query = parsePlanArg(argv);
      if (!query) {
        throw new Error("Missing query text. Usage: hf-runtime search \"<query>\" [--top-k N] [--source vault|code|all]");
      }

      const topKRaw = parseFlag(argv, "--top-k");
      const topK = topKRaw !== undefined ? Number.parseInt(topKRaw, 10) : 5;

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
      return;
    }

    case "index": {
      const subCmd = argv[0];
      argv.shift();

      const repoRoot = process.cwd();
      const configPath = path.join(repoRoot, "hybrid-framework.json");

      function readHfConfig(): Record<string, unknown> {
        try {
          return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {};
          }
          throw error;
        }
      }

      function writeHfConfig(config: Record<string, unknown>): void {
        fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      }

      function getExternalRoots(config: Record<string, unknown>): string[] {
        const idx = config.index;
        if (idx === null || typeof idx !== "object" || Array.isArray(idx)) return [];
        const idxRecord = idx as Record<string, unknown>;
        const ext = idxRecord.external;
        if (ext === null || typeof ext !== "object" || Array.isArray(ext)) return [];
        const extRecord = ext as Record<string, unknown>;
        const roots = extRecord.roots;
        if (!Array.isArray(roots)) return [];
        return roots.filter((r): r is string => typeof r === "string");
      }

      function ensureExternalConfig(config: Record<string, unknown>): void {
        if (config.index === null || typeof config.index !== "object" || Array.isArray(config.index)) {
          config.index = { external: { roots: [] } };
          return;
        }
        const idx = config.index as Record<string, unknown>;
        if (idx.external === null || typeof idx.external !== "object" || Array.isArray(idx.external)) {
          idx.external = { roots: [] };
          return;
        }
        const ext = idx.external as Record<string, unknown>;
        if (!Array.isArray(ext.roots)) {
          ext.roots = [];
        }
      }

      switch (subCmd) {
        case "add": {
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

          const config = readHfConfig();
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

          writeHfConfig(config);
          console.log(`Added to index: ${absPath}`);

          // Trigger rebuild
          console.log("Rebuilding index...");
          const indexConfig = await loadIndexConfig(repoRoot);
          const externalRoots = getExternalRoots(readHfConfig());
          const addExtensions = extensions ?? DEFAULT_INDEX_CONFIG.external?.extensions;
          const addExclude = DEFAULT_INDEX_CONFIG.external?.exclude;
          const result = await buildUnifiedIndex({
            repoRoot,
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
                ...(addExtensions ? { extensions: addExtensions } : {}),
                ...(addExclude ? { exclude: addExclude } : {}),
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
          return;
        }

        case "remove": {
          const rawPath = parsePlanArg(argv);
          if (!rawPath) {
            throw new Error("Missing path argument. Usage: hf-runtime index remove <path>");
          }

          const absPath = path.resolve(rawPath);
          const config = readHfConfig();
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

          writeHfConfig(config);
          console.log(`Removed from index: ${absPath}`);
          return;
        }

        case "list": {
          const indexConfig = await loadIndexConfig(repoRoot);
          const config = readHfConfig();
          const externalRoots = getExternalRoots(config);

          console.log("Index roots:");
          console.log(`  vault:    ${path.join(repoRoot, "vault")}`);

          const codeRoots = indexConfig.code.roots.map((r) => path.resolve(repoRoot, r));
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
          return;
        }

        case "rebuild": {
          console.log("Rebuilding index...");
          const indexConfig = await loadIndexConfig(repoRoot);
          const config = readHfConfig();
          const externalRoots = getExternalRoots(config);
          const rebuildExtensions = indexConfig.external?.extensions ?? DEFAULT_INDEX_CONFIG.external?.extensions;
          const rebuildExclude = indexConfig.external?.exclude ?? DEFAULT_INDEX_CONFIG.external?.exclude;

          const result = await buildUnifiedIndex({
            repoRoot,
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
          return;
        }

        default:
          console.error(`Unknown index subcommand: ${subCmd ?? "(none)"}`);
          console.error("Available: add, remove, list, rebuild");
          process.exitCode = 1;
          return;
      }
    }

    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

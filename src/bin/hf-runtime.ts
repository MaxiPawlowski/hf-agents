#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

import { HybridLoopRuntime, resolveManagedPlanPath } from "../runtime/runtime.js";
import { getRuntimePaths, readEventLines } from "../runtime/persistence.js";
import { parsePlan } from "../runtime/plan-doc.js";
import { runDoctor } from "../runtime/doctor.js";
import { buildTurnOutcomeIngestionEvent, parseTurnOutcomeInput } from "../runtime/turn-outcome-trailer.js";
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
  console.error("  hf-runtime status <plan>                            Show current milestone and loop_attempts/evaluated_outcomes counters");
  console.error("  hf-runtime tail <plan> [--lines N]                  Show recent runtime events");
  console.error("  hf-runtime resume <plan> --via <opencode|claude>    Show the current recovery-aware resume decision/prompt");
  console.error("  hf-runtime doctor <plan>                            Check runtime sidecars for drift or corruption");
  console.error("  hf-runtime outcome <plan> --json '<TurnOutcome JSON or final turn_outcome trailer>'");
  console.error("  hf-runtime help                                     Show this help text");
}

async function main(): Promise<void> {
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

    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

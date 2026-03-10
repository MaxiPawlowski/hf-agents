#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { handleClaudeHook, type ClaudeHookInput } from "../claude/hook-handler.js";

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseHookInput(): ClaudeHookInput {
  const raw = readStdin().trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as ClaudeHookInput;
  } catch {
    return { message: raw };
  }
}

function parseArgs(argv: string[]): { eventName: string; planPath?: string } {
  const eventName = argv[0];
  const planFlagIndex = argv.indexOf("--plan");
  const planPath = planFlagIndex >= 0 ? argv[planFlagIndex + 1] : undefined;

  if (!eventName) {
    throw new Error("Missing Claude hook event name.");
  }

  return planPath ? { eventName, planPath } : { eventName };
}

async function main(): Promise<void> {
  const { eventName, planPath } = parseArgs(process.argv.slice(2));
  const input = parseHookInput();
  const response = await handleClaudeHook(eventName, input, process.cwd(), planPath);
  process.stdout.write(JSON.stringify(response));
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

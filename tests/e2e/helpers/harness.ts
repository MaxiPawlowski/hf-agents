import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  FIXTURE_PLAN_CONTENT,
  FIXTURE_PLAN_PATH,
  PLAN_VAULT_FILES,
  SHARED_VAULT_FILES
} from "./fixtures.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const distPluginPath = path.join(repoRoot, "dist", "src", "opencode", "plugin.js");

const SUBPROCESS_ENV_BLOCKLIST = [
  "NODE_OPTIONS",
  "VITEST",
  "VITEST_MODE",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "TSX_TSCONFIG_PATH"
] as const;

export interface OpenCodeRunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface OpenCodeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  events: Record<string, unknown>[];
}

export interface OpenCodeDebugResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface OpenCodeAuthProbeResult {
  available: boolean;
  reason?: string;
  result?: OpenCodeResult;
}

export async function createFixtureProject(): Promise<string> {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-framework-e2e-"));

  await writeFixtureFile(fixtureDir, FIXTURE_PLAN_PATH, FIXTURE_PLAN_CONTENT);

  for (const [relativePath, content] of Object.entries(PLAN_VAULT_FILES)) {
    await writeFixtureFile(fixtureDir, relativePath, content);
  }

  for (const [relativePath, content] of Object.entries(SHARED_VAULT_FILES)) {
    await writeFixtureFile(fixtureDir, relativePath, content);
  }

  await writeFixtureFile(
    fixtureDir,
    path.join(".opencode", "plugins", "hybrid-runtime.js"),
    buildPluginLoaderSource()
  );

  return fixtureDir;
}

export async function runOpenCode(
  fixtureDir: string,
  message: string,
  options: OpenCodeRunOptions = {}
): Promise<OpenCodeResult> {
  const result = await runCommand(
    ["run", message, "--format", "json", "--model", process.env.HF_TEST_MODEL ?? "github-copilot/gpt-5-mini", "--dir", fixtureDir],
    options,
    fixtureDir
  );

  return {
    ...result,
    events: parseNdjson(result.stdout)
  };
}

export async function runOpenCodeWithLogs(
  fixtureDir: string,
  message: string,
  options: OpenCodeRunOptions = {}
): Promise<OpenCodeResult> {
  const model = process.env.HF_TEST_MODEL ?? "github-copilot/gpt-5-mini";
  const result = await runCommand(
    ["run", message, "--format", "json", "--model", model, "--dir", fixtureDir, "--print-logs", "--log-level", "DEBUG"],
    options,
    fixtureDir
  );

  return {
    ...result,
    events: parseNdjson(result.stdout)
  };
}

export async function runOpenCodeDebug(fixtureDir: string, subcommand: string): Promise<OpenCodeDebugResult> {
  return runCommand(["debug", ...splitSubcommand(subcommand)], {}, fixtureDir);
}

export async function probeOpenCodeAuth(
  message = "Reply with a short greeting.",
  options: OpenCodeRunOptions = { timeoutMs: 30_000 }
): Promise<OpenCodeAuthProbeResult> {
  const fixtureDir = await createFixtureProject();

  try {
    const result = await runOpenCode(fixtureDir, message, options);

    if (result.exitCode === 0) {
      return { available: true, result };
    }

    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (looksLikeAuthFailure(details)) {
      return {
        available: false,
        reason: "Skipping e2e tests: OpenCode is not authenticated for `opencode run` in this environment.",
        result
      };
    }

    throw new Error(`OpenCode probe failed with exit code ${result.exitCode}\n${details}`.trim());
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);

    if (looksLikeAuthFailure(messageText)) {
      return {
        available: false,
        reason: "Skipping e2e tests: OpenCode is not authenticated for `opencode run` in this environment."
      };
    }

    throw error;
  } finally {
    await cleanupFixture(fixtureDir);
  }
}

export async function cleanupFixture(fixtureDir: string): Promise<void> {
  await fs.rm(path.join(fixtureDir, ".vault-index.json"), { force: true });
  await fs.rm(path.join(fixtureDir, ".hf"), { recursive: true, force: true });
  await fs.rm(fixtureDir, { recursive: true, force: true });
}

export async function cleanupFixtureWithRetry(fixtureDir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await cleanupFixture(fixtureDir);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") {
        throw error;
      }
      if (attempt === 4) {
        console.warn(`Cleanup warning: leaving busy fixture directory ${fixtureDir}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for file: ${filePath}`);
}

export function assertSuccessfulExit(exitCode: number, label: string, stdout: string, stderr: string): void {
  if (exitCode === 0) {
    return;
  }

  throw new Error(
    [
      `${label} failed with exit code ${exitCode}.`,
      "stdout:",
      stdout,
      "stderr:",
      stderr
    ].join("\n")
  );
}

export function collectEventText(value: unknown): string {
  const parts: string[] = [];
  appendStrings(parts, value);
  return parts.join("\n");
}

function appendStrings(parts: string[], value: unknown): void {
  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendStrings(parts, item);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const nestedValue of Object.values(value)) {
    appendStrings(parts, nestedValue);
  }
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^.*?\/(vault|src)\//, "$1/");
}

export async function seedUnifiedIndexFixture(fixtureDir: string): Promise<void> {
  const files = [
    {
      relativePath: path.join("plans", "2026-01-01-test-plan.md"),
      content: `---
plan: test
status: in-progress
---

# Plan: Test

## User Intent

Verify that unified indexing works end-to-end through the OpenCode plugin.

## Milestones

- [ ] 1. Unified index verification milestone
`
    },
    {
      relativePath: path.join("vault", "plans", "test", "context.md"),
      content: `# Plan context

## Authentication guidance

Rotate refresh tokens after each privileged session renewal so replayed credentials lose value quickly.

## Session recovery

Persist revoked session identifiers so compromised access can be shut down immediately.
`
    },
    {
      relativePath: path.join("vault", "shared", "architecture.md"),
      content: `# Shared architecture

## Billing pipeline

Invoice totals are computed from line item subtotals and tax before the final receipt is written.
`
    },
    {
      relativePath: path.join("src", "lib", "billing.ts"),
      content: `export function calculateInvoiceTotal(subtotal: number, taxRate: number): number {
  const taxAmount = subtotal * taxRate;
  return subtotal + taxAmount;
}

export function formatInvoiceSummary(customerName: string, total: number): string {
  return customerName + " owes $" + total.toFixed(2);
}
`
    },
    {
      relativePath: path.join("src", "lib", "session.ts"),
      content: `export function rotateRefreshToken(sessionId: string): string {
  return sessionId + "-rotated";
}

export class SessionCache {
  private revoked = new Set<string>();

  revoke(sessionId: string): void {
    this.revoked.add(sessionId);
  }
}
`
    },
    { relativePath: path.join("vault", "plans", "test", "discoveries.md"), content: "\n" },
    { relativePath: path.join("vault", "plans", "test", "decisions.md"), content: "\n" },
    { relativePath: path.join("vault", "plans", "test", "references.md"), content: "\n" },
    { relativePath: path.join("vault", "shared", "patterns.md"), content: "\n" },
    { relativePath: path.join("vault", "shared", "decisions.md"), content: "\n" }
  ];

  await Promise.all(files.map(async ({ relativePath, content }) => {
    const filePath = path.join(fixtureDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }));
}

function buildPluginLoaderSource(): string {
  const pluginUrl = pathToFileURL(distPluginPath).href;
  return `export { HybridRuntimePlugin } from "${pluginUrl}";\nexport { default } from "${pluginUrl}";\n`;
}

async function writeFixtureFile(fixtureDir: string, relativePath: string, content: string): Promise<void> {
  const targetPath = path.join(fixtureDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

async function runCommand(
  args: string[],
  options: OpenCodeRunOptions,
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const command = process.platform === "win32" ? "cmd.exe" : "opencode";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "opencode", ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: cleanSubprocessEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      if (!settled) {
        settled = true;
        reject(new Error(`OpenCode command timed out after ${timeoutMs}ms: ${commandArgs.join(" ")}`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.once("close", (code) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });
  });
}

function cleanSubprocessEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };

  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST_") || SUBPROCESS_ENV_BLOCKLIST.includes(key as typeof SUBPROCESS_ENV_BLOCKLIST[number])) {
      delete env[key];
    }
  }

  return env;
}

function parseNdjson(stdout: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Failed to parse OpenCode NDJSON event: ${(error as Error).message}\nLine: ${trimmed}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Expected OpenCode event to be a JSON object. Received: ${trimmed}`);
    }

    events.push(parsed as Record<string, unknown>);
  }

  return events;
}

function splitSubcommand(subcommand: string): string[] {
  return subcommand.split(/\s+/).filter(Boolean);
}

function looksLikeAuthFailure(output: string): boolean {
  const normalized = output.toLowerCase();

  return [
    "api key",
    "authentication",
    "authenticate",
    "unauthorized",
    "login",
    "not logged in",
    "no provider",
    "provider",
    "not configured",
    "openai_api_key",
    "anthropic_api_key",
    "openrouter_api_key",
    "oauth"
  ].some((needle) => normalized.includes(needle));
}

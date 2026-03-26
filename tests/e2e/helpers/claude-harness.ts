import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupFixture, cleanupFixtureWithRetry, seedUnifiedIndexFixture } from "./harness.js";

export { cleanupFixtureWithRetry };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const distHookPath = path.join(repoRoot, "dist", "src", "bin", "hf-claude-hook.js");

const DEFAULT_TIMEOUT_MS = 120_000;

const SUBPROCESS_ENV_BLOCKLIST = [
  "NODE_OPTIONS",
  "VITEST",
  "VITEST_MODE",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "TSX_TSCONFIG_PATH",
  "CLAUDECODE"
] as const;

export interface ClaudeRunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ClaudeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: ClaudeJsonOutput;
}

export interface ClaudeJsonOutput {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  num_turns?: number;
  total_cost_usd?: number;
}

export interface ClaudeAuthProbeResult {
  available: boolean;
  reason?: string;
  result?: ClaudeResult;
}

/**
 * Creates a minimal fixture project with only .claude/settings.json (hooks).
 * For tests that don't need plan/vault files (planless mode).
 */
export async function createMinimalClaudeFixture(): Promise<string> {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-framework-claude-e2e-"));
  await writeClaudeSettings(fixtureDir);
  return fixtureDir;
}

/**
 * Creates a full fixture project with plan + vault files + .claude/settings.json.
 * For tests that need plan-aware runtime (vault context injection).
 */
export async function createClaudeCodeFixtureProject(): Promise<string> {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-framework-claude-e2e-"));
  await seedUnifiedIndexFixture(fixtureDir);
  await writeClaudeSettings(fixtureDir);
  return fixtureDir;
}

async function writeClaudeSettings(fixtureDir: string): Promise<void> {
  // Use absolute path to the hook binary so it works from any fixture dir
  const hookCmd = process.platform === "win32"
    ? `node "${distHookPath.replace(/\\/g, "/")}"`
    : `node "${distHookPath}"`;

  const settings = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            { type: "command", command: `${hookCmd} UserPromptSubmit` }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            { type: "command", command: `${hookCmd} Stop` }
          ]
        }
      ]
    }
  };

  const settingsPath = path.join(fixtureDir, ".claude", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

export async function runClaudeCode(
  fixtureDir: string,
  message: string,
  options: ClaudeRunOptions = {}
): Promise<ClaudeResult> {
  const model = process.env.HF_TEST_MODEL_CLAUDE ?? "claude-haiku-4-5-20251001";
  const raw = await runCommand(
    ["-p", message, "--output-format", "json", "--model", model, "--dangerously-skip-permissions"],
    options,
    fixtureDir
  );

  let parsed: ClaudeJsonOutput | undefined;
  try {
    const trimmed = raw.stdout.trim();
    if (trimmed) {
      parsed = JSON.parse(trimmed) as ClaudeJsonOutput;
    }
  } catch {
    // Non-fatal — caller inspects raw stdout on parse failure
  }

  return parsed !== undefined ? { ...raw, parsed } : raw;
}

export async function probeClaudeCodeAuth(
  message = "Reply with the single word ready.",
  options: ClaudeRunOptions = { timeoutMs: 30_000 }
): Promise<ClaudeAuthProbeResult> {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-framework-claude-probe-"));

  try {
    const result = await runClaudeCode(fixtureDir, message, options);

    if (result.exitCode === 0) {
      return { available: true, result };
    }

    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (looksLikeClaudeAuthFailure(details)) {
      return {
        available: false,
        reason: "Skipping claude e2e tests: claude CLI is not logged in (run `claude login` first).",
        result
      };
    }

    throw new Error(`Claude probe failed with exit code ${result.exitCode}\n${details}`.trim());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (looksLikeClaudeAuthFailure(msg) || isClaudeNotFound(msg)) {
      return {
        available: false,
        reason: "Skipping claude e2e tests: claude CLI is not installed or not logged in."
      };
    }

    throw error;
  } finally {
    await cleanupFixture(fixtureDir);
  }
}

export async function readEventsJsonl(eventsPath: string): Promise<Record<string, unknown>[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath, "utf8");
  } catch {
    return [];
  }

  const events: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

// Candidate locations for the claude binary on Windows, searched in order.
const WIN_CLAUDE_CANDIDATES = [
  path.join(os.homedir(), ".local", "bin", "claude.exe"),
  path.join(os.homedir(), "AppData", "Roaming", "npm", "claude.cmd"),
  path.join(os.homedir(), "AppData", "Local", "Programs", "Claude", "claude.exe"),
];

let resolvedClaudeExe: string | null | undefined = undefined;

async function resolveClaudeExe(): Promise<string | null> {
  if (resolvedClaudeExe !== undefined) return resolvedClaudeExe;
  for (const candidate of WIN_CLAUDE_CANDIDATES) {
    try {
      await fs.access(candidate);
      resolvedClaudeExe = candidate;
      return candidate;
    } catch { /* not found */ }
  }
  resolvedClaudeExe = null;
  return null;
}

async function runCommand(
  args: string[],
  options: ClaudeRunOptions,
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let command: string;
  let commandArgs: string[];

  if (process.platform === "win32") {
    const exePath = await resolveClaudeExe();
    if (exePath) {
      command = exePath.endsWith(".cmd") ? "cmd.exe" : exePath;
      commandArgs = exePath.endsWith(".cmd") ? ["/d", "/s", "/c", exePath, ...args] : args;
    } else {
      command = "cmd.exe";
      commandArgs = ["/d", "/s", "/c", "claude", ...args];
    }
  } else {
    command = "claude";
    commandArgs = args;
  }

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
        reject(new Error(`Claude command timed out after ${timeoutMs}ms: ${commandArgs.join(" ")}`));
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

function looksLikeClaudeAuthFailure(output: string): boolean {
  const normalized = output.toLowerCase();
  return [
    "not logged in",
    "please log in",
    "session expired",
    "unauthorized",
    "authentication required",
    "login required"
  ].some((needle) => normalized.includes(needle));
}

function isClaudeNotFound(output: string): boolean {
  const normalized = output.toLowerCase();
  return ["enoent", "not found", "command not found", "cannot find"].some(
    (needle) => normalized.includes(needle)
  );
}

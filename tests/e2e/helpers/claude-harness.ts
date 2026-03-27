import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupFixture, cleanupFixtureWithRetry, seedUnifiedIndexFixture } from "./harness.js";

export { cleanupFixtureWithRetry };

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find repo root (no package.json found in ancestors).");
}

const repoRoot = findRepoRoot();
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
  clearRuntimeArtifacts?: boolean;
}

export type ClaudeOutputFormat = "json" | "text";

export interface ClaudeRuntimeSidecar {
  planSlug: string;
  runtimeDir: string;
  eventsPath: string;
  resumePromptPath: string;
  statusPath: string;
  events: Record<string, unknown>[];
  eventTypes: string[];
  resumePrompt: string | null;
  status: Record<string, unknown> | null;
}

export interface ClaudeRuntimeArtifacts {
  runtimeRoot: string;
  sidecars: ClaudeRuntimeSidecar[];
  planless: ClaudeRuntimeSidecar | null;
}

export interface ClaudeResult {
  args: string[];
  outputFormat: ClaudeOutputFormat;
  stdout: string;
  stderr: string;
  exitCode: number;
  producedResponse: boolean;
  responseText: string | null;
  parsed?: ClaudeJsonOutput;
  runtime: ClaudeRuntimeArtifacts;
}

export interface ClaudeInvocationResult {
  label: string;
  args: string[];
  outputFormat: ClaudeOutputFormat;
  stdout: string;
  stderr: string;
  exitCode: number;
  producedResponse: boolean;
  responseText: string | null;
  parsed?: ClaudeJsonOutput;
  runtime: ClaudeRuntimeArtifacts;
  events: Record<string, unknown>[];
  eventTypes: string[];
  resumePrompt: string | null;
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

export interface ClaudeHookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: Record<string, unknown>;
}

/**
 * Creates a minimal fixture project with Claude hook settings.
 * For tests that don't need plan/vault files (planless mode).
 */
export async function createMinimalClaudeFixture(): Promise<string> {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-framework-claude-e2e-"));
  await writeClaudeSettings(fixtureDir);
  return fixtureDir;
}

/**
 * Creates a full fixture project with plan + vault files + Claude hook settings.
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

  const claudeDir = path.join(fixtureDir, ".claude");
  const serialized = JSON.stringify(settings, null, 2);

  await fs.mkdir(claudeDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(claudeDir, "settings.json"), serialized, "utf8"),
    fs.writeFile(path.join(claudeDir, "settings.local.json"), serialized, "utf8")
  ]);
}

export async function runClaudeCode(
  fixtureDir: string,
  message: string,
  options: ClaudeRunOptions = {}
): Promise<ClaudeResult> {
  // Primary Claude e2e execution path: use this for parity tests that must prove a
  // real Claude generation run produced both final-response output and runtime sidecar
  // evidence. This is broader than direct hook-binary invocation.
  const model = process.env.HF_TEST_MODEL_CLAUDE ?? "claude-haiku-4-5-20251001";
  const args = [
    "-p",
    message,
    "--output-format",
    "json",
    "--model",
    model,
    "--dangerously-skip-permissions"
  ];

  const result = await runClaudeExecution(
    fixtureDir,
    args,
    "json",
    options,
    { clearRuntimeArtifacts: options.clearRuntimeArtifacts ?? true }
  );

  return {
    args,
    outputFormat: "json",
    ...result
  };
}

export async function runClaudeCli(
  fixtureDir: string,
  args: string[],
  options: ClaudeRunOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCommand(args, options, fixtureDir);
}

export async function runClaudeInvocationDiagnostic(
  fixtureDir: string,
  label: string,
  args: string[],
  options: ClaudeRunOptions = {}
): Promise<ClaudeInvocationResult> {
  // Narrower than runClaudeCode(): use for diagnosing which Claude CLI invocation shapes
  // preserve project hook settings and side effects. This is hook-path evidence, not the
  // main final-response parity helper.
  const outputFormat = extractOutputFormat(args);
  const result = await runClaudeExecution(
    fixtureDir,
    args,
    outputFormat,
    options,
    { clearRuntimeArtifacts: true }
  );
  const planless = result.runtime.planless;

  return {
    label,
    args,
    outputFormat,
    ...result,
    events: planless?.events ?? [],
    eventTypes: planless?.eventTypes ?? [],
    resumePrompt: planless?.resumePrompt ?? null
  };
}

export async function runClaudeHook(
  fixtureDir: string,
  eventName: string,
  input: Record<string, unknown> = {},
  options: ClaudeRunOptions = {}
): Promise<ClaudeHookResult> {
  // Lowest-level diagnostic helper: directly invokes the hook binary without a real Claude
  // model generation run. Useful for isolated hook correctness checks, but insufficient on
  // its own to claim Claude end-to-end parity.
  const raw = await runNodeCommand(
    [distHookPath, eventName],
    options,
    fixtureDir,
    JSON.stringify(input)
  );

  let parsed: Record<string, unknown> | undefined;
  try {
    const trimmed = raw.stdout.trim();
    if (trimmed) {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
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

async function clearClaudeRuntimeArtifacts(fixtureDir: string): Promise<void> {
  const runtimeRoot = path.join(fixtureDir, "plans", "runtime");

  try {
    const entries = await fs.readdir(runtimeRoot, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const runtimeDir = path.join(runtimeRoot, entry.name);
        return [
          fs.rm(path.join(runtimeDir, "events.jsonl"), { force: true }),
          fs.rm(path.join(runtimeDir, "resume-prompt.txt"), { force: true }),
          fs.rm(path.join(runtimeDir, "status.json"), { force: true })
        ];
      }));
  } catch {
    await Promise.all([
      fs.rm(planlessEventsPath(fixtureDir), { force: true }),
      fs.rm(planlessResumePromptPath(fixtureDir), { force: true }),
      fs.rm(planlessStatusPath(fixtureDir), { force: true })
    ]);
  }
}

function planlessEventsPath(fixtureDir: string): string {
  return path.join(fixtureDir, "plans", "runtime", "_planless", "events.jsonl");
}

function planlessResumePromptPath(fixtureDir: string): string {
  return path.join(fixtureDir, "plans", "runtime", "_planless", "resume-prompt.txt");
}

function planlessStatusPath(fixtureDir: string): string {
  return path.join(fixtureDir, "plans", "runtime", "_planless", "status.json");
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readOptionalJson(filePath: string): Promise<Record<string, unknown> | null> {
  const raw = await readOptionalText(filePath);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface ClaudeExecutionOptions {
  clearRuntimeArtifacts?: boolean;
}

async function runClaudeExecution(
  fixtureDir: string,
  args: string[],
  outputFormat: ClaudeOutputFormat,
  options: ClaudeRunOptions,
  executionOptions: ClaudeExecutionOptions = {}
): Promise<Omit<ClaudeResult, "args" | "outputFormat">> {
  if (executionOptions.clearRuntimeArtifacts) {
    await clearClaudeRuntimeArtifacts(fixtureDir);
  }

  const raw = await runClaudeCli(fixtureDir, args, options);
  const parsed = parseClaudeJsonOutput(raw.stdout);
  const responseText = getClaudeResponseText(raw.stdout, outputFormat, parsed);

  return {
    ...raw,
    producedResponse: typeof responseText === "string" && responseText.trim().length > 0,
    responseText,
    ...(parsed !== undefined ? { parsed } : {}),
    runtime: await readClaudeRuntimeArtifacts(fixtureDir)
  };
}

function parseClaudeJsonOutput(stdout: string): ClaudeJsonOutput | undefined {
  try {
    const trimmed = stdout.trim();
    if (trimmed) {
      return JSON.parse(trimmed) as ClaudeJsonOutput;
    }
  } catch {
    // Non-fatal — caller inspects raw stdout on parse failure
  }

  return undefined;
}

function getClaudeResponseText(
  stdout: string,
  outputFormat: ClaudeOutputFormat,
  parsed?: ClaudeJsonOutput
): string | null {
  if (outputFormat === "json") {
    return typeof parsed?.result === "string" && parsed.result.trim().length > 0 ? parsed.result : null;
  }

  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readClaudeRuntimeArtifacts(fixtureDir: string): Promise<ClaudeRuntimeArtifacts> {
  const runtimeRoot = path.join(fixtureDir, "plans", "runtime");
  let entries: string[] = [];

  try {
    entries = (await fs.readdir(runtimeRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // Runtime root absent is valid before hooks write sidecars.
  }

  const sidecars = await Promise.all(entries.map(async (planSlug) => {
    const runtimeDir = path.join(runtimeRoot, planSlug);
    const eventsPath = path.join(runtimeDir, "events.jsonl");
    const resumePromptPath = path.join(runtimeDir, "resume-prompt.txt");
    const statusPath = path.join(runtimeDir, "status.json");
    const events = await readEventsJsonl(eventsPath);

    return {
      planSlug,
      runtimeDir,
      eventsPath,
      resumePromptPath,
      statusPath,
      events,
      eventTypes: events
        .map((event) => event.type)
        .filter((type): type is string => typeof type === "string"),
      resumePrompt: await readOptionalText(resumePromptPath),
      status: await readOptionalJson(statusPath)
    } satisfies ClaudeRuntimeSidecar;
  }));

  return {
    runtimeRoot,
    sidecars,
    planless: sidecars.find((sidecar) => sidecar.planSlug === "_planless") ?? null
  };
}

function extractOutputFormat(args: string[]): ClaudeOutputFormat {
  const index = args.indexOf("--output-format");
  if (index >= 0) {
    const value = args[index + 1];
    if (value === "text") {
      return "text";
    }
  }

  return "json";
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

async function runNodeCommand(
  args: string[],
  options: ClaudeRunOptions,
  cwd: string,
  stdin = ""
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: cleanSubprocessEnv(options.env),
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      if (!settled) {
        settled = true;
        reject(new Error(`Node command timed out after ${timeoutMs}ms: ${args.join(" ")}`));
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

    child.stdin.end(stdin);
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

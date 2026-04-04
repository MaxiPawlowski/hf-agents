import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, test } from "vitest";

import { assertSuccessfulExit, cleanupFixtureWithRetry, createFixtureProject } from "./helpers/harness.js";
import { FIXTURE_PLAN_PATH, PROVIDER_SKIP_MESSAGE, hasProviderApiKey } from "./helpers/fixtures.js";
import { isNumber } from "../../src/runtime/utils.js";

const RUN_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 480_000;
const HYDRATION_TIMEOUT_MS = 4_000;
const VAULT_INDEX_TIMEOUT_MS = 5_000;
const UNIFIED_INDEX_TIMEOUT_MS = 15_000;
const WARNING_RATIO = 0.8;
const _LOG_WAIT_TIMEOUT_MS = 15_000;
const _INDEX_WAIT_TIMEOUT_MS = 15_000;

interface DebugLogEntry {
  t: string;
  tag: string;
  msg: string;
  data?: {
    elapsed_ms?: unknown;
    [key: string]: unknown;
  };
  pid: number;
}

interface RunDiagnostics {
  label: string;
  fixtureKind: "unified" | "vault";
  fixtureDir: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  logEntries: DebugLogEntry[];
  hydrationMs: number | null;
  modelLoadMs: number | null;
  averageEmbeddingPerChunkMs: number | null;
  unifiedIndexMs: number | null;
  vaultIndexMs: number | null;
  chunkCount: number | null;
  notes: string[];
}

interface SummaryRow {
  phase: string;
  run: string;
  durationMs: number | null;
  timeoutLabel: string;
  timeoutMs: number | null;
  notes?: string;
}

describe.skipIf(!process.env.HF_RUN_BENCHMARKS)("opencode timeout diagnostics", () => {
  test("measures cold and warm vault timing without failing on slow phases", async (context) => {
    const authAvailable = await hasWorkingProvider();
    if (!authAvailable) {
      context.skip(PROVIDER_SKIP_MESSAGE);
    }

    const unifiedFixtureDir = await createFixtureProject();
    const vaultFixtureDir = await createFixtureProject();

    try {
      await seedTimeoutFixture(unifiedFixtureDir, { blockUnifiedIndex: false });
      await seedTimeoutFixture(vaultFixtureDir, { blockUnifiedIndex: true });
      await installFixturePluginLoader(unifiedFixtureDir);
      await installFixturePluginLoader(vaultFixtureDir);

      const runs = [
        await executeDiagnosticsRun(unifiedFixtureDir, "unified cold", "unified"),
        await executeDiagnosticsRun(unifiedFixtureDir, "unified warm", "unified"),
        await executeDiagnosticsRun(vaultFixtureDir, "vault cold", "vault"),
        await executeDiagnosticsRun(vaultFixtureDir, "vault warm", "vault")
      ];

      deriveApproximatePhaseTimings(runs);

      const rows = buildSummaryRows(runs);
      console.log(formatSummaryTable(rows));

      for (const run of runs) {
        for (const note of run.notes) {
          console.warn(`[${run.label}] ${note}`);
        }
      }

      for (const row of rows) {
        if (row.durationMs === null || row.timeoutMs === null) {
          continue;
        }

        if (row.durationMs >= row.timeoutMs * WARNING_RATIO) {
          console.warn(
            `Timing warning: ${row.run} ${row.phase} used ${row.durationMs}ms of ${row.timeoutMs}ms (${Math.round((row.durationMs / row.timeoutMs) * 100)}%).`
          );
        }
      }
    } finally {
      await cleanupFixtureWithRetry(unifiedFixtureDir);
      await cleanupFixtureWithRetry(vaultFixtureDir);
    }
  }, TEST_TIMEOUT_MS);
});

async function executeDiagnosticsRun(
  fixtureDir: string,
  label: string,
  fixtureKind: "unified" | "vault"
): Promise<RunDiagnostics> {
  const result = await runOpenCodeWithDebugLogs(
    fixtureDir,
    "Reply with the single word measured.",
    RUN_TIMEOUT_MS
  );

  assertSuccessfulExit(result.exitCode, label, result.stdout, result.stderr);

  const logEntries = parseDebugLogEntries(result.logRaw);
  const chunkCount = fixtureKind === "unified" ? result.unifiedChunkCount : result.vaultChunkCount;
  const hydrationMs = readElapsedMs(logEntries, "plugin", "hydrateRuntime [done");
  const lazyVaultLoadMs = readElapsedMs(logEntries, "runtime", "lazy vault load [done");
  const modelLoadMs = readElapsedMs(logEntries, "embedding-model", "loadExtractor [done");
  const averageEmbeddingPerChunkMs = readAverageEmbeddingPerChunkMs(logEntries);
  const notes: string[] = [];

  if (logEntries.length === 0) {
    notes.push("hf-debug.log was empty or unavailable after opencode exited; stderr remains the secondary diagnostic source.");
  }
  if (hydrationMs === null) {
    notes.push("No timed hydrateRuntime entry was found in hf-debug.log.");
  }
  if (lazyVaultLoadMs === null) {
    notes.push("No timed lazy vault load entry was found; index total timing is unavailable from current logs.");
  }
  if (modelLoadMs === null) {
    notes.push("No dedicated embedding-model loadExtractor timer was found in hf-debug.log.");
  }
  if (averageEmbeddingPerChunkMs === null) {
    notes.push("No dedicated embedding-model embedBatch timer with text_count metadata was found in hf-debug.log.");
  }
  if (chunkCount === null) {
    notes.push("Index chunk count was unavailable, so per-chunk embedding timing remains unavailable.");
  }

  return {
    label,
    fixtureKind,
    fixtureDir,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    logEntries,
    hydrationMs,
    modelLoadMs,
    averageEmbeddingPerChunkMs,
    unifiedIndexMs: fixtureKind === "unified" ? lazyVaultLoadMs : null,
    vaultIndexMs: fixtureKind === "vault" ? lazyVaultLoadMs : null,
    chunkCount,
    notes
  };
}

async function hasWorkingProvider(): Promise<boolean> {
  if (hasProviderApiKey()) {
    return true;
  }

  const fixtureDir = await createFixtureProject();

  try {
    const result = await runOpenCodeWithDebugLogs(
      fixtureDir,
      "Reply with the single word ready.",
      30_000
    );

    if (result.exitCode === 0) {
      return true;
    }

    const details = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return !looksLikeProviderFailure(details);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return !looksLikeProviderFailure(message);
  } finally {
    await cleanupFixtureWithRetry(fixtureDir);
  }
}

async function seedTimeoutFixture(
  fixtureDir: string,
  options: { blockUnifiedIndex: boolean }
): Promise<void> {
  const files = [
    {
      relativePath: FIXTURE_PLAN_PATH,
      content: `---
plan: test
status: in-progress
---

# Plan: Test

## User Intent

Measure real vault timing under an opencode subprocess.

## Milestones

- [ ] 1. Timeout diagnostics milestone
`
    },
    {
      relativePath: path.join("vault", "plans", "test", "context.md"),
      content: `# Plan context

## Authentication rotation

Rotate refresh tokens after every privileged renewal so replayed credentials expire quickly.

## Revocation ledger

Persist revoked session identifiers so compromised access can be terminated immediately.

## Incident drill

Practice a token revocation drill before each release to confirm emergency playbooks still work.
`
    },
    {
      relativePath: path.join("vault", "shared", "architecture.md"),
      content: `# Shared architecture

## Billing pipeline

Invoice totals are calculated from subtotal plus tax before the receipt is stored.

## Search infrastructure

The project keeps vault knowledge and code chunks searchable from the same runtime entrypoint.
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

export class SessionRegistry {
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

  if (options.blockUnifiedIndex) {
    files.push({ relativePath: ".hf", content: "block unified index directory creation\n" });
  }

  await Promise.all(files.map(async ({ relativePath, content }) => {
    const filePath = path.join(fixtureDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }));
}

async function installFixturePluginLoader(fixtureDir: string): Promise<void> {
  const pluginPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "src", "opencode", "plugin.js");
  const pluginUrl = pathToFileURL(pluginPath).href;
  const loaderPath = path.join(fixtureDir, ".opencode", "plugins", "hybrid-runtime.js");

  await fs.writeFile(
    loaderPath,
    `export { HybridRuntimePlugin } from "${pluginUrl}";\nexport { default } from "${pluginUrl}";\n`,
    "utf8"
  );
}

async function runOpenCodeWithDebugLogs(
  fixtureDir: string,
  message: string,
  timeoutMs: number
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  logRaw: string;
  unifiedChunkCount: number | null;
  vaultChunkCount: number | null;
}> {
  const driverSource = [
    'import { promises as fs } from "node:fs";',
    'import path from "node:path";',
    'import { spawn } from "node:child_process";',
    `const fixtureDir = ${JSON.stringify(fixtureDir)};`,
    `const message = ${JSON.stringify(message)};`,
    `const timeoutMs = ${JSON.stringify(timeoutMs)};`,
    `const logPath = ${JSON.stringify(path.join(fixtureDir, "plans", "runtime", "hf-debug.log"))};`,
    `const model = ${JSON.stringify(process.env.HF_TEST_MODEL ?? "github-copilot/gpt-5-mini")};`,
    'const args = ["run", message, "--format", "json", "--model", model, "--dir", fixtureDir, "--print-logs", "--log-level", "DEBUG"];',
    'const command = process.platform === "win32" ? "cmd.exe" : "opencode";',
    'const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "opencode", ...args] : args;',
    'const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST_") && key !== "VITEST" && key !== "NODE_OPTIONS" && key !== "TSX_TSCONFIG_PATH"));',
    'const child = spawn(command, commandArgs, { cwd: fixtureDir, env: { ...cleanEnv, HF_DEBUG_LOG: logPath }, stdio: ["ignore", "pipe", "pipe"] });',
    'let stdout = "";',
    'let stderr = "";',
    'let settled = false;',
    'const readChunkCount = async (indexPath) => { try { const raw = await fs.readFile(indexPath, "utf8"); const parsed = JSON.parse(raw); if (Array.isArray(parsed.items)) return parsed.items.length; if (Array.isArray(parsed.entries)) return parsed.entries.length; return null; } catch { return null; } };',
    'const snapshotArtifacts = async () => { let logRaw = ""; const startedAt = Date.now(); while (Date.now() - startedAt < 15000) { try { logRaw = await fs.readFile(logPath, "utf8"); if (logRaw.trim()) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } return { logRaw, unifiedChunkCount: await readChunkCount(path.join(fixtureDir, ".hf", "index.json")), vaultChunkCount: await readChunkCount(path.join(fixtureDir, "vault", ".vault-index.json")) }; };',
    'const finish = async (payload, exitCode = 0) => { if (settled) return; settled = true; const artifacts = await snapshotArtifacts(); process.stdout.write(JSON.stringify({ ...payload, ...artifacts })); process.exit(exitCode); };',
    'const timeout = setTimeout(() => { child.kill(); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); finish({ stdout, stderr, exitCode: 1, timedOut: true, commandArgs }, 1); }, timeoutMs);',
    'child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });',
    'child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });',
    'child.once("error", (error) => { clearTimeout(timeout); finish({ stdout, stderr: stderr + String(error), exitCode: 1, commandArgs }, 1); });',
    'child.once("close", (code) => { clearTimeout(timeout); finish({ stdout, stderr, exitCode: code ?? 1, commandArgs }); });'
  ].join("\n");

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    logRaw: string;
    unifiedChunkCount: number | null;
    vaultChunkCount: number | null;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", driverSource], {
      cwd: fixtureDir,
      env: buildSubprocessEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`OpenCode driver failed with exit code ${code ?? 1}.\n${stderr}`.trim()));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          stdout: string;
          stderr: string;
          exitCode: number;
          logRaw: string;
          unifiedChunkCount: number | null;
          vaultChunkCount: number | null;
        };
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Failed to parse OpenCode driver output: ${(error as Error).message}\n${stdout}\n${stderr}`.trim()));
      }
    });
  });

  return result;
}

async function readDebugLogEntries(logPath: string): Promise<DebugLogEntry[]> {
  let rawLog = "";

  try {
    rawLog = await fs.readFile(logPath, "utf8");
  } catch {
    return [];
  }

  const entries: DebugLogEntry[] = [];

  for (const line of rawLog.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = JSON.parse(trimmed) as DebugLogEntry;
    entries.push(parsed);
  }

  return entries;
}

function parseDebugLogEntries(rawLog: string): DebugLogEntry[] {
  const entries: DebugLogEntry[] = [];

  for (const line of rawLog.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = JSON.parse(trimmed) as DebugLogEntry;
    entries.push(parsed);
  }

  return entries;
}

async function _readDebugLogEntriesWithWait(
  logPath: string,
  timeoutMs: number,
  baselineCount = 0
): Promise<DebugLogEntry[]> {
  const startedAt = Date.now();
  let lastEntries: DebugLogEntry[] = [];

  while (Date.now() - startedAt < timeoutMs) {
    const entries = await readDebugLogEntries(logPath);
    if (entries.length > baselineCount) {
      lastEntries = entries;
      if (hasPrimaryTimingEntries(entries.slice(baselineCount))) {
        return entries;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return lastEntries;
}

async function readChunkCount(fixtureDir: string, fixtureKind: "unified" | "vault"): Promise<number | null> {
  const indexPath = fixtureKind === "unified"
    ? path.join(fixtureDir, ".hf", "index.json")
    : path.join(fixtureDir, "vault", ".vault-index.json");

  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as { items?: unknown[]; entries?: unknown[] };
    if (Array.isArray(parsed.items)) {
      return parsed.items.length;
    }
    if (Array.isArray(parsed.entries)) {
      return parsed.entries.length;
    }
    return null;
  } catch {
    return null;
  }
}

async function _waitForChunkCount(
  fixtureDir: string,
  fixtureKind: "unified" | "vault",
  timeoutMs: number
): Promise<number | null> {
  const startedAt = Date.now();
  let lastValue: number | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const chunkCount = await readChunkCount(fixtureDir, fixtureKind);
    if (chunkCount !== null) {
      return chunkCount;
    }
    lastValue = chunkCount;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return lastValue;
}

function readElapsedMs(entries: DebugLogEntry[], tag: string, prefix: string): number | null {
  const match = entries.find((entry) => entry.tag === tag && entry.msg.startsWith(prefix));
  return toNumber(match?.data?.elapsed_ms);
}

function hasPrimaryTimingEntries(entries: DebugLogEntry[]): boolean {
  return entries.some((entry) => entry.tag === "plugin" && entry.msg.startsWith("hydrateRuntime [done"))
    && entries.some((entry) => entry.tag === "runtime" && entry.msg.startsWith("lazy vault load [done"));
}

function deriveApproximatePhaseTimings(runs: RunDiagnostics[]): void {
  for (const fixtureKind of ["unified", "vault"] as const) {
    const coldRun = runs.find((run) => run.fixtureKind === fixtureKind && run.label.includes("cold"));
    const warmRun = runs.find((run) => run.fixtureKind === fixtureKind && run.label.includes("warm"));

    if (!coldRun || !warmRun) {
      continue;
    }

    for (const run of [coldRun, warmRun]) {
      if (run.modelLoadMs !== null && run === warmRun) {
        run.notes.push("Warm runs reuse the same fixture contents, but each opencode subprocess still logs its own loadExtractor timing.");
      }
    }
  }
}

function readAverageEmbeddingPerChunkMs(entries: DebugLogEntry[]): number | null {
  const batchEntries = entries.filter((entry) => entry.tag === "embedding-model" && entry.msg.startsWith("embedBatch [done"));

  if (batchEntries.length === 0) {
    return null;
  }

  let totalElapsedMs = 0;
  let totalTexts = 0;

  for (const entry of batchEntries) {
    const elapsedMs = toNumber(entry.data?.elapsed_ms);
    const textCount = toNumber(entry.data?.text_count);

    if (elapsedMs === null || textCount === null || textCount <= 0) {
      continue;
    }

    totalElapsedMs += elapsedMs;
    totalTexts += textCount;
  }

  if (totalTexts === 0) {
    return null;
  }

  return Math.round((totalElapsedMs / totalTexts) * 10) / 10;
}

function buildSubprocessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const blocklist = ["NODE_OPTIONS", "VITEST", "VITEST_MODE", "VITEST_POOL_ID", "VITEST_WORKER_ID", "TSX_TSCONFIG_PATH"];

  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST_") || blocklist.includes(key)) {
      delete env[key];
    }
  }

  return env;
}

function toNumber(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

function buildSummaryRows(runs: RunDiagnostics[]): SummaryRow[] {
  const rows: SummaryRow[] = [];

  for (const run of runs) {
    rows.push({
      phase: "hydration total",
      run: run.label,
      durationMs: run.hydrationMs,
      timeoutLabel: "HYDRATION_TIMEOUT_MS",
      timeoutMs: HYDRATION_TIMEOUT_MS
    });
    rows.push({
      phase: "ONNX model load",
      run: run.label,
      durationMs: run.modelLoadMs,
      timeoutLabel: "HYDRATION_TIMEOUT_MS",
      timeoutMs: HYDRATION_TIMEOUT_MS,
      notes: "parsed from embedding-model loadExtractor timer"
    });
    rows.push({
      phase: "embedding generation per chunk (avg)",
      run: run.label,
      durationMs: run.averageEmbeddingPerChunkMs,
      timeoutLabel: run.fixtureKind === "unified"
        ? `UNIFIED_INDEX_TIMEOUT_MS / ${run.chunkCount ?? "?"}`
        : `VAULT_INDEX_TIMEOUT_MS / ${run.chunkCount ?? "?"}`,
      timeoutMs: run.chunkCount && run.chunkCount > 0
        ? Math.round(((run.fixtureKind === "unified" ? UNIFIED_INDEX_TIMEOUT_MS : VAULT_INDEX_TIMEOUT_MS) / run.chunkCount) * 10) / 10
        : null,
      notes: run.chunkCount ? `${run.chunkCount} chunks` : "chunk count unavailable"
    });

    if (run.fixtureKind === "unified") {
      rows.push({
        phase: "unified index build total",
        run: run.label,
        durationMs: run.unifiedIndexMs,
        timeoutLabel: "UNIFIED_INDEX_TIMEOUT_MS",
        timeoutMs: UNIFIED_INDEX_TIMEOUT_MS
      });
    }

    if (run.fixtureKind === "vault") {
      rows.push({
        phase: "vault index build total",
        run: run.label,
        durationMs: run.vaultIndexMs,
        timeoutLabel: "VAULT_INDEX_TIMEOUT_MS",
        timeoutMs: VAULT_INDEX_TIMEOUT_MS
      });
    }
  }

  return rows;
}

function formatSummaryTable(rows: SummaryRow[]): string {
  const headers = ["run", "phase", "duration_ms", "timeout", "ratio", "notes"];
  const data = rows.map((row) => {
    const durationText = row.durationMs === null ? "n/a" : formatMs(row.durationMs);
    const timeoutText = row.timeoutMs === null ? row.timeoutLabel : `${row.timeoutLabel}=${formatMs(row.timeoutMs)}`;
    const ratioText = row.durationMs !== null && row.timeoutMs !== null
      ? `${Math.round((row.durationMs / row.timeoutMs) * 100)}%`
      : "n/a";

    return [row.run, row.phase, durationText, timeoutText, ratioText, row.notes ?? ""];
  });

  const widths = headers.map((header, index) => {
    const columnValues = data.map((row) => row[index] ?? "");
    return Math.max(header.length, ...columnValues.map((value) => value.length));
  });

  const lines = [
    "Timeout diagnostics summary",
    formatTableRow(headers, widths),
    formatTableRow(widths.map((width) => "-".repeat(width)), widths)
  ];

  for (const row of data) {
    lines.push(formatTableRow(row, widths));
  }

  return lines.join("\n");
}

function formatTableRow(cells: string[], widths: number[]): string {
  return cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ");
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10}ms`;
}

function looksLikeProviderFailure(output: string): boolean {
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
  ].some((needle) => output.includes(needle));
}

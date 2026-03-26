import path from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";

/**
 * Persistent file logger for the Hybrid Framework runtime.
 *
 * Writes to `plans/runtime/hf-debug.log` (append-only, one JSON line per entry).
 * Uses synchronous I/O to guarantee every log is flushed immediately —
 * this is a diagnostic tool, not a hot-path concern.
 *
 * Enable by setting `HF_DEBUG=1` in the environment.
 * The log path can be overridden with `HF_DEBUG_LOG=/absolute/path.log`.
 */

let resolvedLogPath: string | null = null;
let enabled: boolean | null = null;

function isEnabled(): boolean {
  if (enabled === null) {
    enabled = process.env.HF_DEBUG === "1" || process.env.HF_DEBUG === "true";
  }
  return enabled;
}

function getLogPath(): string {
  if (resolvedLogPath) return resolvedLogPath;

  if (process.env.HF_DEBUG_LOG) {
    resolvedLogPath = path.resolve(process.env.HF_DEBUG_LOG);
  } else {
    // Default: next to the hybrid-framework install
    const fallback = path.resolve(process.cwd(), "plans", "runtime", "hf-debug.log");
    resolvedLogPath = fallback;
  }

  try {
    mkdirSync(path.dirname(resolvedLogPath), { recursive: true });
  } catch {
    // best-effort
  }

  return resolvedLogPath;
}

export interface LogEntry {
  /** Short tag identifying the subsystem (e.g. "plugin", "runtime", "claude-hook"). */
  tag: string;
  /** Human-readable message. */
  msg: string;
  /** Optional structured data. */
  data?: Record<string, unknown>;
}

/**
 * Append a timestamped JSON log line to the debug log.
 * No-op when `HF_DEBUG` is not set.
 */
export function hfLog(entry: LogEntry): void {
  if (!isEnabled()) return;

  const line = JSON.stringify({
    t: new Date().toISOString(),
    tag: entry.tag,
    msg: entry.msg,
    ...(entry.data ? { data: entry.data } : {}),
    pid: process.pid
  });

  try {
    appendFileSync(getLogPath(), line + "\n");
  } catch {
    // Logging must never throw — swallow silently.
  }
}

/**
 * Convenience: log with elapsed-time measurement.
 * Returns a `done()` function that writes the "end" entry with duration.
 */
export function hfLogTimed(entry: LogEntry): (extra?: Record<string, unknown>) => void {
  const start = performance.now();
  hfLog({ ...entry, msg: `${entry.msg} [start]` });
  return (extra?: Record<string, unknown>) => {
    const ms = Math.round(performance.now() - start);
    hfLog({
      ...entry,
      msg: `${entry.msg} [done ${ms}ms]`,
      data: { ...entry.data, ...extra, elapsed_ms: ms }
    });
  };
}

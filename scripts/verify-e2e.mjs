#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISO_DATE_LENGTH = 10;
const today = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
const proofSlug = `${today}-package-lifecycle-proof`;
const proofDir = path.join(repoRoot, "plans", "evidence", proofSlug);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(relativePath, content) {
  const targetPath = path.join(proofDir, relativePath);
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
}

function run(command, args, options = {}) {
  const windowsCmdShim = process.platform === "win32" && command === "npm";
  const executable = windowsCmdShim ? "cmd.exe" : command;
  const finalArgs = windowsCmdShim ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    ...options
  });

  return {
    command: `${executable} ${args.join(" ")}`.trim(),
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error) : undefined
  };
}

function assertSuccess(result, label) {
  if (result.status !== 0) {
    const message = [
      `${label} failed`,
      `command: ${result.command}`,
      `exit: ${result.status}`,
      result.error ? `error:\n${result.error}` : "",
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : ""
    ].filter(Boolean).join("\n\n");
    throw new Error(message);
  }
}

function writeCommandResult(relativeBase, result) {
  writeFile(`${relativeBase}.stdout.txt`, result.stdout);
  writeFile(`${relativeBase}.stderr.txt`, result.stderr);
  writeFile(`${relativeBase}.meta.json`, `${JSON.stringify({
    command: result.command,
    exitCode: result.status
  }, null, 2)}\n`);
}

function parsePackSummary(stdout) {
  const jsonPayload = stdout.match(/(\[\s*\{[\s\S]*\}\s*\])/u)?.[1];
  if (!jsonPayload) {
    throw new Error(`Could not find npm pack JSON output.\n\n${stdout}`);
  }

  const parsed = JSON.parse(jsonPayload);
  const packResult = parsed[0];
  if (!packResult) {
    throw new Error("Expected npm pack --dry-run --json to return one result.");
  }

  const packagedPaths = new Set(packResult.files.map((file) => file.path));
  return {
    entryCount: packResult.entryCount,
    includesRuntimeBin: packagedPaths.has("dist/src/bin/hf-runtime.js"),
    includesInstaller: packagedPaths.has("scripts/install-runtime.mjs"),
    includesVaultTemplate: packagedPaths.has("vault/templates/plan-context.md"),
    excludesTests: !packagedPaths.has("tests/install-runtime.test.ts"),
    excludesSource: !packagedPaths.has("src/runtime/runtime.ts"),
    excludesPlans: !packagedPaths.has("plans/2026-03-16-package-distribution-and-project-init-plan.md")
  };
}

function main() {
  cleanDir(proofDir);

  const packResult = run("npm", ["pack", "--dry-run", "--json"]);
  assertSuccess(packResult, "npm pack --dry-run --json");
  writeCommandResult("01-pack-dry-run", packResult);

  const lifecycleTests = run("npm", ["run", "test:lifecycle"]);
  assertSuccess(lifecycleTests, "npm run test:lifecycle");
  writeCommandResult("02-test-lifecycle", lifecycleTests);

  const packSummary = parsePackSummary(packResult.stdout);
  const summary = {
    proofDir,
    checks: {
      packPassed: packResult.status === 0,
      lifecycleTestsPassed: lifecycleTests.status === 0,
      ...packSummary
    }
  };

  writeFile("summary.json", `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

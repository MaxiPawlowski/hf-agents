#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : sourceRoot;

function hasPackageJson(dirPath) {
  return fs.existsSync(path.join(dirPath, "package.json"));
}

function main() {
  if (targetRoot === sourceRoot) {
    return;
  }

  if (!hasPackageJson(targetRoot)) {
    return;
  }

  const result = spawnSync(
    "node",
    [path.join(sourceRoot, "scripts", "install-runtime.mjs"), "--tool", "all", "--skip-build", "--target-dir", targetRoot],
    {
      cwd: sourceRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    }
  );

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

main();

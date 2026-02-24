#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function defaultOpenCodeConfigDir() {
  return path.join(os.homedir(), ".config", "opencode");
}

function printHelp() {
  console.log("Uninstall .opencode assets from your OpenCode config directory.");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/install/uninstall-opencode-global.mjs [--dry-run] [--force]");
  console.log("");
  console.log("Notes:");
  console.log("  - Default target is <home>/.config/opencode.");
  console.log("  - To override, pass --target <path> (forwarded to the underlying uninstaller).\n");
  console.log("Run `node scripts/install/uninstall-opencode-assets.mjs --help` for full details.");
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const hasTarget = argv.includes("--target");
const forwarded = hasTarget ? argv : ["--target", defaultOpenCodeConfigDir(), ...argv];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "uninstall-opencode-assets.mjs");

const result = spawnSync(process.execPath, [scriptPath, ...forwarded], { stdio: "inherit" });
process.exit(typeof result.status === "number" ? result.status : 2);

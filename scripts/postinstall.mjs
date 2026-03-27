#!/usr/bin/env node

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
  if (targetRoot === sourceRoot || !hasPackageJson(targetRoot)) {
    return;
  }

  process.stdout.write(
    [
      "hybrid-framework: package install completed.",
      "No adapter wiring or project scaffolding runs automatically during postinstall.",
      "Next steps (choose one flow):",
      "  - Combined: npm exec hf-install -- --target-dir .",
      "  - Claude only: npm exec hf-install-claude -- --target-dir .",
      "  - OpenCode only: npm exec hf-install-opencode -- --target-dir .",
      "Then use the matching init/sync/uninstall command for that flow.",
      "See README.md for the consumer installation contract and config file shape."
    ].join("\n") + "\n"
  );
}

main();

#!/usr/bin/env node
// scripts/sonar.mjs
// Loads .env (if present) via Node's built-in --env-file support, then runs sonar-scanner.
// Usage: node --env-file=.env scripts/sonar.mjs
//
// The --env-file flag is passed by the npm script — this file just validates and delegates.

import { execSync } from "node:child_process";

if (!process.env.SONAR_TOKEN) {
  console.error(
    "ERROR: SONAR_TOKEN is not set.\n" +
    "  1. Copy .env.example to .env\n" +
    "  2. Generate a token in SonarQube (http://localhost:9000)\n" +
    "  3. Paste it as SONAR_TOKEN=<value> in .env"
  );
  process.exit(1);
}

console.log("Running sonar-scanner...");
execSync("npx sonar-scanner -Dsonar.host.url=http://localhost:9000", {
  stdio: "inherit",
  env: process.env,
});

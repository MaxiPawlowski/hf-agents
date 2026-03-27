#!/usr/bin/env node

import process from "node:process";

import { mainForTool } from "./install-runtime.mjs";

try {
  mainForTool("claude");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

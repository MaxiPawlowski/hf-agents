#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const registryPath = path.join(repoRoot, ".opencode", "registry.json");

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

if (!fs.existsSync(registryPath)) {
  fail(`Registry file not found: ${registryPath}`, 2);
}

let registry;
try {
  registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
} catch (error) {
  fail(`Registry parse error: ${error.message}`, 2);
}

const assets = Array.isArray(registry.assets) ? registry.assets : [];
if (assets.length === 0) {
  fail("Registry has no assets", 3);
}

const seenIds = new Set();
const errors = [];

for (const asset of assets) {
  if (!asset.id || typeof asset.id !== "string") {
    errors.push("Asset has invalid or missing 'id'");
    continue;
  }

  if (seenIds.has(asset.id)) {
    errors.push(`Duplicate asset id: ${asset.id}`);
  }
  seenIds.add(asset.id);

  if (!asset.path || typeof asset.path !== "string") {
    errors.push(`Asset '${asset.id}' missing string 'path'`);
    continue;
  }

  const absolutePath = path.join(repoRoot, asset.path);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`Missing path for '${asset.id}': ${asset.path}`);
  }

  if (!Array.isArray(asset.dependsOn)) {
    errors.push(`Asset '${asset.id}' has invalid dependsOn (must be array)`);
  }
}

if (errors.length > 0) {
  console.error("Registry validation failed:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log(`Registry validation passed (${assets.length} assets).`);

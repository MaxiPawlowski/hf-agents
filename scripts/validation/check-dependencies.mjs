#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const registryPath = path.join(repoRoot, ".opencode", "registry.json");

function parseRegistry(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function detectCycles(graph) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function dfs(node, stack) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    const next = graph.get(node) || [];
    for (const dep of next) {
      dfs(dep, [...stack, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    dfs(node, []);
  }
  return cycles;
}

if (!fs.existsSync(registryPath)) {
  console.error(`ERROR: Registry not found: ${registryPath}`);
  process.exit(2);
}

let registry;
try {
  registry = parseRegistry(registryPath);
} catch (error) {
  console.error(`ERROR: Could not parse registry: ${error.message}`);
  process.exit(2);
}

const assets = Array.isArray(registry.assets) ? registry.assets : [];
const idToAsset = new Map(assets.map((asset) => [asset.id, asset]));
const graph = new Map();
const errors = [];

for (const asset of assets) {
  const deps = Array.isArray(asset.dependsOn) ? asset.dependsOn : [];
  graph.set(asset.id, deps);
  for (const dep of deps) {
    if (!idToAsset.has(dep)) {
      errors.push(`Asset '${asset.id}' depends on missing '${dep}'`);
    }
  }
}

const cycles = detectCycles(graph);
for (const cycle of cycles) {
  errors.push(`Dependency cycle detected: ${cycle.join(" -> ")}`);
}

if (errors.length > 0) {
  console.error("Dependency validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Dependency validation passed (${assets.length} assets, no cycles).`);

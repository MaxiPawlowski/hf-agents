#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-status}"
FEATURE="${2:-}"

node -e '
const fs = require("fs");
const path = require("path");

const command = process.argv[1] || "status";
const featureFilter = process.argv[2] || "";
const root = path.resolve(process.cwd(), ".tmp", "tasks");

if (!fs.existsSync(root)) {
  console.log("No task artifacts found in .tmp/tasks");
  process.exit(0);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function featureDirs() {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !featureFilter || name === featureFilter);
}

function loadFeature(name) {
  const featurePath = path.join(root, name);
  const taskPath = path.join(featurePath, "task.json");
  const subtaskFiles = fs
    .readdirSync(featurePath)
    .filter((file) => /^subtask_\d+\.json$/.test(file))
    .sort();
  const subtasks = subtaskFiles.map((file) => readJson(path.join(featurePath, file)));
  const task = fs.existsSync(taskPath) ? readJson(taskPath) : { id: name, name };
  return { name, task, subtasks };
}

function isReady(subtask, all) {
  if (subtask.status !== "pending") return false;
  return (subtask.depends_on || subtask.dependsOn || []).every((dep) => {
    const match = all.find((candidate) => candidate.seq === dep);
    return match && match.status === "completed";
  });
}

function showStatus(feature) {
  const totals = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0
  };

  for (const subtask of feature.subtasks) {
    const key = subtask.status;
    if (key in totals) totals[key] += 1;
  }

  const total = feature.subtasks.length || 1;
  const progress = Math.round((totals.completed / total) * 100);
  console.log(`[${feature.name}] ${feature.task.name || feature.task.id}`);
  console.log(`  Progress: ${progress}% (${totals.completed}/${feature.subtasks.length})`);
  console.log(`  Pending: ${totals.pending} | In Progress: ${totals.in_progress} | Completed: ${totals.completed} | Blocked: ${totals.blocked}`);
}

const features = featureDirs().map(loadFeature);

if (features.length === 0) {
  console.log("No matching feature task artifacts found.");
  process.exit(0);
}

for (const feature of features) {
  if (command === "status") {
    showStatus(feature);
    continue;
  }

  if (command === "next") {
    const ready = feature.subtasks.filter((subtask) => isReady(subtask, feature.subtasks));
    console.log(`=== Ready tasks: ${feature.name} ===`);
    if (ready.length === 0) {
      console.log("  (none)");
    }
    for (const subtask of ready) {
      console.log(`  ${subtask.seq} - ${subtask.title}`);
    }
    continue;
  }

  if (command === "parallel") {
    const readyParallel = feature.subtasks.filter(
      (subtask) => subtask.parallel === true && isReady(subtask, feature.subtasks)
    );
    console.log(`=== Parallel-ready tasks: ${feature.name} ===`);
    if (readyParallel.length === 0) {
      console.log("  (none)");
    }
    for (const subtask of readyParallel) {
      console.log(`  ${subtask.seq} - ${subtask.title}`);
    }
    continue;
  }

  if (command === "blocked") {
    const blocked = feature.subtasks.filter((subtask) => {
      if (subtask.status !== "pending") return false;
      return !isReady(subtask, feature.subtasks);
    });
    console.log(`=== Blocked tasks: ${feature.name} ===`);
    if (blocked.length === 0) {
      console.log("  (none)");
    }
    for (const subtask of blocked) {
      const deps = subtask.depends_on || subtask.dependsOn || [];
      console.log(`  ${subtask.seq} - ${subtask.title} (waiting on: ${deps.join(", ") || "n/a"})`);
    }
    continue;
  }

  if (command === "validate") {
    const seqSet = new Set(feature.subtasks.map((subtask) => subtask.seq));
    const errors = [];
    for (const subtask of feature.subtasks) {
      const deps = subtask.depends_on || subtask.dependsOn || [];
      for (const dep of deps) {
        if (!seqSet.has(dep)) {
          errors.push(`${subtask.seq} depends on missing ${dep}`);
        }
      }
      if (!Array.isArray(subtask.acceptance_criteria || subtask.acceptanceCriteria)) {
        errors.push(`${subtask.seq} missing acceptance criteria array`);
      }
    }
    console.log(`=== Validation: ${feature.name} ===`);
    if (errors.length === 0) {
      console.log("  OK");
    } else {
      for (const error of errors) {
        console.log(`  ERROR: ${error}`);
      }
      process.exitCode = 1;
    }
    continue;
  }

  console.log(`Unknown command: ${command}`);
  process.exitCode = 1;
}
' "$COMMAND" "$FEATURE"

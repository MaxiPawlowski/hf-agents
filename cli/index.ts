#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { listSubagents } from "../src/registry/agent-registry.js";
import { listSkills } from "../src/skills/skill-engine.js";
import { loadPolicy, policyFileForMode } from "../src/policies/policy-loader.js";
import { runTask } from "../src/orchestrator/core-agent.js";
import { createTaskBundle } from "../src/tasks/task-bundle.js";
import {
  addTaskResearchEntry,
  buildTaskResume,
  getNextReadySubtask,
  getTaskLifecycle,
  listBlockedSubtasks,
  listTaskLifecycles,
  setTaskSubtaskStatusValidated,
  upsertTaskLifecycle
} from "../src/tasks/task-lifecycle.js";
import { formatDiagnosticsReport, generateDiagnosticsReport } from "../src/diagnostics/report.js";
import { runHookRuntime } from "../src/hooks/runtime.js";
import {
  enqueueBackgroundTask,
  executeBackgroundTask,
  getBackgroundTask,
  listBackgroundTasks,
  listDispatchableTasks,
  markStaleTasks
} from "../src/background/runtime.js";
import { runMcpSearch } from "../src/mcp/providers.js";
import { delegationCategorySchema, policyModeSchema } from "../src/contracts/index.js";
import { loadHookRuntimeConfig, loadMcpIntegrations } from "../src/policies/policy-loader.js";

const program = new Command();

function policyPathForMode(mode: string): string {
  const relativePath = policyFileForMode(policyModeSchema.parse(mode));
  if (existsSync(relativePath)) {
    return relativePath;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", relativePath);
}

program
  .name("framework")
  .description("Framework CLI")
  .version("0.1.0");

program
  .command("agents")
  .description("List available subagents")
  .action(() => {
    for (const agent of listSubagents()) {
      console.log(`${agent.id}: ${agent.specialization}`);
    }
  });

program
  .command("skills")
  .description("List available skills")
  .action(() => {
    for (const skill of listSkills()) {
      console.log(skill.id);
    }
  });

program
  .command("policy")
  .description("Show selected policy")
  .option("-m, --mode <mode>", "Policy mode", "fast")
  .action((options: { mode: string }) => {
    const mode = policyModeSchema.parse(options.mode);
    const policy = loadPolicy(policyPathForMode(mode));
    console.log(JSON.stringify(policy, null, 2));
  });

program
  .command("run")
  .description("Run a task through orchestrator")
  .requiredOption("-i, --intent <intent>", "Task intent")
  .option("-c, --category <category>", "Delegation category")
  .option("-m, --mode <mode>", "Policy mode", "fast")
  .action(async (options: { intent: string; mode: string; category?: string }) => {
    const mode = policyModeSchema.parse(options.mode);
    const category = options.category ? delegationCategorySchema.parse(options.category) : undefined;
    const task = {
      id: `task-${Date.now()}`,
      intent: options.intent,
      category,
      constraints: [],
      successCriteria: []
    };
    const policy = loadPolicy(policyPathForMode(mode));
    const result = await runTask(task, policy);
    if (result.taskBundle) {
      upsertTaskLifecycle(result.taskBundle);
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("doctor")
  .description("Generate runtime diagnostics report")
  .option("-m, --mode <mode>", "Policy mode for hook settings", "fast")
  .option("--json", "Output diagnostics as JSON", false)
  .action((options: { json?: boolean; mode: string }) => {
    const mode = policyModeSchema.parse(options.mode);
    const policy = loadPolicy(policyPathForMode(mode));
    const hookConfig = loadHookRuntimeConfig(policy);
    const report = generateDiagnosticsReport();
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const runtime = runHookRuntime({
      stage: "before_output",
      output: formatDiagnosticsReport(report),
      maxOutputChars: 12000,
      hookConfig,
      notes: []
    });
    console.log(runtime.output ?? "");
    if (runtime.notes.length > 0) {
      for (const note of runtime.notes) {
        console.log(`- ${note}`);
      }
    }
  });

program
  .command("task-bundle")
  .description("Generate dependency-aware task bundle for an intent")
  .requiredOption("-i, --intent <intent>", "Task intent")
  .action((options: { intent: string }) => {
    const task = {
      id: `task-${Date.now()}`,
      intent: options.intent,
      constraints: [],
      successCriteria: []
    };
    const bundle = createTaskBundle(task);
    upsertTaskLifecycle(bundle);
    console.log(JSON.stringify(bundle, null, 2));
  });

program
  .command("task-status")
  .description("Show task lifecycle status")
  .option("-f, --feature <featureId>", "Task feature id")
  .option("--json", "Output as JSON", false)
  .action((options: { feature?: string; json?: boolean }) => {
    if (options.feature) {
      const lifecycle = getTaskLifecycle(options.feature);
      if (!lifecycle) {
        console.error(`Task lifecycle not found for feature: ${options.feature}`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(lifecycle, null, 2));
        return;
      }
      console.log(`${lifecycle.featureId} [${lifecycle.status}]`);
      for (const subtask of lifecycle.subtasks) {
        console.log(`- ${subtask.seq} ${subtask.title} (${subtask.status})`);
      }
      return;
    }

    const all = listTaskLifecycles().map((entry) => ({
      featureId: entry.featureId,
      status: entry.status,
      total: entry.subtasks.length,
      completed: entry.subtasks.filter((subtask) => subtask.status === "completed").length
    }));

    if (options.json) {
      console.log(JSON.stringify(all, null, 2));
      return;
    }

    if (all.length === 0) {
      console.log("No task lifecycle records found.");
      return;
    }

    for (const entry of all) {
      console.log(`${entry.featureId} [${entry.status}] ${entry.completed}/${entry.total} completed`);
    }
  });

program
  .command("task-resume")
  .description("Show the next subtask to resume")
  .requiredOption("-f, --feature <featureId>", "Task feature id")
  .option("-m, --mode <mode>", "Policy mode for hook settings", "fast")
  .option("--mark-in-progress", "Mark suggested subtask as in_progress", false)
  .option("--json", "Output as JSON", false)
  .action((options: { feature: string; mode: string; markInProgress?: boolean; json?: boolean }) => {
    const mode = policyModeSchema.parse(options.mode);
    const policy = loadPolicy(policyPathForMode(mode));
    const hookConfig = loadHookRuntimeConfig(policy);
    let resume = buildTaskResume(options.feature);
    if (!resume) {
      console.error(`Task lifecycle not found for feature: ${options.feature}`);
      process.exitCode = 1;
      return;
    }

    if (options.markInProgress && resume.nextSubtask) {
      const mutation = setTaskSubtaskStatusValidated(options.feature, resume.nextSubtask.seq, "in_progress");
      if (!mutation.ok) {
        console.error(mutation.message);
        process.exitCode = 1;
        return;
      }
      resume = buildTaskResume(options.feature);
      if (!resume) {
        console.error(`Task lifecycle not found for feature: ${options.feature}`);
        process.exitCode = 1;
        return;
      }
    }

    const hookResult = runHookRuntime({
      stage: "resume",
      lifecycleStatus: resume.status,
      hookConfig,
      notes: []
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...resume,
            hookNotes: hookResult.notes
          },
          null,
          2
        )
      );
      return;
    }

    console.log(resume.message);
    if (resume.nextSubtask) {
      console.log(`Next: ${resume.nextSubtask.seq} ${resume.nextSubtask.title} (${resume.nextSubtask.suggestedAgent})`);
    }
    if (resume.blockedSubtasks.length > 0) {
      console.log("Blocked:");
      for (const subtask of resume.blockedSubtasks) {
        console.log(`- ${subtask.seq} ${subtask.title}`);
      }
    }
    for (const note of hookResult.notes) {
      console.log(`- ${note}`);
    }
  });

program
  .command("task-next")
  .description("Show next ready subtask for a feature")
  .requiredOption("-f, --feature <featureId>", "Task feature id")
  .option("--json", "Output as JSON", false)
  .action((options: { feature: string; json?: boolean }) => {
    const next = getNextReadySubtask(options.feature);
    if (!next) {
      console.error(`No ready subtask found for feature: ${options.feature}`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(next, null, 2));
      return;
    }

    console.log(`${next.seq} ${next.title} (${next.suggestedAgent})`);
  });

program
  .command("task-blocked")
  .description("List blocked subtasks and reasons")
  .requiredOption("-f, --feature <featureId>", "Task feature id")
  .option("--json", "Output as JSON", false)
  .action((options: { feature: string; json?: boolean }) => {
    const blocked = listBlockedSubtasks(options.feature);
    if (options.json) {
      console.log(JSON.stringify(blocked, null, 2));
      return;
    }
    if (blocked.length === 0) {
      console.log("No blocked subtasks.");
      return;
    }
    for (const entry of blocked) {
      console.log(`${entry.subtask.seq} ${entry.subtask.title}: ${entry.reason}`);
    }
  });

program
  .command("task-complete")
  .description("Mark subtask as completed after dependency checks")
  .requiredOption("-f, --feature <featureId>", "Task feature id")
  .requiredOption("-s, --seq <seq>", "Subtask sequence (NN)")
  .action((options: { feature: string; seq: string }) => {
    const mutation = setTaskSubtaskStatusValidated(options.feature, options.seq, "completed");
    if (!mutation.ok) {
      console.error(mutation.message);
      process.exitCode = 1;
      return;
    }
    console.log(mutation.message);
  });

program
  .command("task-block")
  .description("Mark a subtask as blocked with reason")
  .requiredOption("-f, --feature <featureId>", "Task feature id")
  .requiredOption("-s, --seq <seq>", "Subtask sequence (NN)")
  .requiredOption("-r, --reason <reason>", "Blocked reason")
  .action((options: { feature: string; seq: string; reason: string }) => {
    const mutation = setTaskSubtaskStatusValidated(options.feature, options.seq, "blocked", undefined, options.reason);
    if (!mutation.ok) {
      console.error(mutation.message);
      process.exitCode = 1;
      return;
    }
    console.log(mutation.message);
  });

program
  .command("mcp-search")
  .description("Run MCP research via tavily or gh-grep")
  .requiredOption("-p, --provider <provider>", "Provider: tavily|gh-grep")
  .requiredOption("-q, --query <query>", "Search query")
  .option("-m, --mode <mode>", "Policy mode", "fast")
  .option("-f, --feature <featureId>", "Attach result to task lifecycle research log")
  .option("--json", "Output as JSON", false)
  .action(async (options: { provider: string; query: string; mode: string; feature?: string; json?: boolean }) => {
    const mode = policyModeSchema.parse(options.mode);
    const policy = loadPolicy(policyPathForMode(mode));
    const integrations = loadMcpIntegrations(policy);
    const result = await runMcpSearch(options.provider, options.query, integrations);

    if (options.feature) {
      const mutation = addTaskResearchEntry(options.feature, {
        provider: result.provider,
        query: result.query,
        summary: result.summary,
        links: result.items.map((item) => item.locator)
      });
      if (!mutation.ok) {
        console.error(mutation.message);
        process.exitCode = 1;
        return;
      }
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.summary);
    for (const item of result.items) {
      console.log(`- ${item.title}: ${item.locator}`);
    }
  });

program
  .command("background-enqueue")
  .description("Queue a background task run or mcp search")
  .requiredOption("-k, --kind <kind>", "Kind: run-task|mcp-search")
  .option("-i, --intent <intent>", "Task intent for run-task")
  .option("-c, --category <category>", "Task category for run-task")
  .option("-p, --provider <provider>", "MCP provider for mcp-search")
  .option("-q, --query <query>", "Query for mcp-search")
  .option("-f, --feature <featureId>", "Feature id for lifecycle integration")
  .option("-m, --mode <mode>", "Policy mode", "fast")
  .action((options: {
    kind: string;
    intent?: string;
    category?: string;
    provider?: string;
    query?: string;
    feature?: string;
    mode: string;
  }) => {
    const mode = policyModeSchema.parse(options.mode);
    if (options.kind !== "run-task" && options.kind !== "mcp-search") {
      console.error("Invalid --kind. Expected run-task or mcp-search.");
      process.exitCode = 1;
      return;
    }
    if (options.kind === "run-task" && !options.intent) {
      console.error("run-task requires --intent");
      process.exitCode = 1;
      return;
    }
    if (options.kind === "mcp-search" && (!options.provider || !options.query)) {
      console.error("mcp-search requires --provider and --query");
      process.exitCode = 1;
      return;
    }

    const payload =
      options.kind === "run-task"
        ? {
            kind: "run-task" as const,
            mode,
            task: {
              id: `task-${Date.now()}`,
              intent: options.intent as string,
              category: options.category ? delegationCategorySchema.parse(options.category) : undefined,
              constraints: [],
              successCriteria: []
            }
          }
        : {
            kind: "mcp-search" as const,
            mode,
            mcpProvider: options.provider,
            query: options.query,
            featureId: options.feature
          };

    const job = enqueueBackgroundTask(payload);
    console.log(JSON.stringify(job, null, 2));
  });

program
  .command("background-dispatch")
  .description("Dispatch queued background jobs based on concurrency limits")
  .option("-m, --mode <mode>", "Policy mode", "fast")
  .action(async (options: { mode: string }) => {
    const mode = policyModeSchema.parse(options.mode);
    const policy = loadPolicy(policyPathForMode(mode));
    const stale = markStaleTasks(policy);
    const dispatchable = listDispatchableTasks(policy);
    if (dispatchable.length === 0) {
      console.log(JSON.stringify({ staleMarked: stale, dispatched: 0 }, null, 2));
      return;
    }

    const completed = await Promise.all(dispatchable.map((job) => executeBackgroundTask(job.id, policy)));
    console.log(
      JSON.stringify(
        {
          staleMarked: stale,
          dispatched: completed.length,
          jobIds: completed.map((job) => job.id)
        },
        null,
        2
      )
    );
  });

program
  .command("background-status")
  .description("List background jobs or fetch one job")
  .option("-j, --job <jobId>", "Background job id")
  .option("--json", "Output as JSON", false)
  .action((options: { job?: string; json?: boolean }) => {
    if (options.job) {
      const job = getBackgroundTask(options.job);
      if (!job) {
        console.error(`Background job not found: ${options.job}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(job, null, 2));
      return;
    }

    const jobs = listBackgroundTasks();
    if (options.json) {
      console.log(JSON.stringify(jobs, null, 2));
      return;
    }
    if (jobs.length === 0) {
      console.log("No background jobs.");
      return;
    }
    for (const job of jobs) {
      console.log(`${job.id} [${job.status}] ${job.payload.kind}`);
    }
  });

program.parse();

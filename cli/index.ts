#!/usr/bin/env node
import { Command } from "commander";
import { listSubagents } from "../src/registry/agent-registry.js";
import { listSkills } from "../src/skills/skill-engine.js";
import { loadPolicy } from "../src/policies/policy-loader.js";
import { runTask } from "../src/orchestrator/core-agent.js";
import { createTaskBundle } from "../src/tasks/task-bundle.js";

const program = new Command();

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
    const path = `policies/${options.mode}.yaml`;
    const policy = loadPolicy(path);
    console.log(JSON.stringify(policy, null, 2));
  });

program
  .command("run")
  .description("Run a task through orchestrator")
  .requiredOption("-i, --intent <intent>", "Task intent")
  .option("-m, --mode <mode>", "Policy mode", "fast")
  .action(async (options: { intent: string; mode: string }) => {
    const task = {
      id: `task-${Date.now()}`,
      intent: options.intent,
      constraints: [],
      successCriteria: []
    };
    const policy = loadPolicy(`policies/${options.mode}.yaml`);
    const result = await runTask(task, policy);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("doctor")
  .description("Print runtime defaults and safety profile")
  .action(() => {
    console.log("Worktrees: disabled by default");
    console.log("Git management: disabled by default");
    console.log("Tests: optional/manual by default");
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
    console.log(JSON.stringify(bundle, null, 2));
  });

program.parse();

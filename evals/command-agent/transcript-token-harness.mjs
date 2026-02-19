#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { fixture: "evals/command-agent/fixtures/sample-run.jsonl" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--fixture" && argv[i + 1]) {
      args.fixture = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function safeUsage(payload) {
  return {
    input: payload?.input_tokens ?? 0,
    output: payload?.output_tokens ?? 0,
    cacheRead: payload?.cache_read_input_tokens ?? 0,
    cacheWrite: payload?.cache_creation_input_tokens ?? 0
  };
}

const { fixture } = parseArgs(process.argv.slice(2));
const fixturePath = path.resolve(process.cwd(), fixture);

if (!fs.existsSync(fixturePath)) {
  console.error(`ERROR: fixture not found: ${fixturePath}`);
  process.exit(2);
}

const lines = fs
  .readFileSync(fixturePath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const byActor = new Map();
let messages = 0;

for (const line of lines) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }

  const usage = safeUsage(event?.usage || event?.message?.usage || event?.toolUseResult?.usage);
  const actor = event.agentId || event?.toolUseResult?.agentId || event.role || event.type || "unknown";

  if (!byActor.has(actor)) {
    byActor.set(actor, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, events: 0 });
  }
  const bucket = byActor.get(actor);
  bucket.input += usage.input;
  bucket.output += usage.output;
  bucket.cacheRead += usage.cacheRead;
  bucket.cacheWrite += usage.cacheWrite;
  bucket.events += 1;
  messages += 1;
}

console.log(`Transcript: ${fixturePath}`);
console.log(`Events: ${messages}`);
console.log("Token usage by actor:");
for (const [actor, usage] of byActor.entries()) {
  console.log(
    `- ${actor}: input=${usage.input}, output=${usage.output}, cacheRead=${usage.cacheRead}, cacheWrite=${usage.cacheWrite}, events=${usage.events}`
  );
}

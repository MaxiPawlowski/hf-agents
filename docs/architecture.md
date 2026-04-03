# Hybrid Framework — Architecture Reference

This document is the architectural entry point for contributors and integrators. It explains how the hybrid framework's six layers fit together, how data flows from a user request to a turn outcome, and where each concern lives in the codebase. For a quick-start and project overview, see [`README.md`](../README.md).

## Table of Contents

- [Introduction](#introduction)
- [Architecture Overview](#architecture-overview)
- [Runtime Core and Semantic Search Pipeline](#runtime-core-and-semantic-search-pipeline)
- [Adapter Layer and Lifecycle Hooks](#adapter-layer-and-lifecycle-hooks)
- [Agent, Subagent, and Skill Prompt Layer](#agent-subagent-and-skill-prompt-layer)
- [Operational Guide](#operational-guide)
- [Contributing](#contributing)

---

## Introduction

The hybrid framework is a markdown-first orchestration layer that drives unattended, multi-turn AI development loops. A human author writes a plan doc — a structured markdown file that declares milestones, acceptance criteria, and evidence requirements — and the framework's runtime executes that plan one milestone at a time, routing work through planner, builder, and reviewer agents until each milestone is verified and closed.

The core problem the framework solves is **loop control**: keeping an AI agent from drifting off-scope, repeating work, or losing state across turns and tool calls. Every agent in the loop emits a canonical `turn_outcome:` trailer block; the runtime ingests only that final fenced block, updates the plan doc, and decides whether to advance to the next milestone, retry the current one, or surface a blocker. No state lives in an agent's memory — all durable state lives in the plan doc and runtime sidecar files under `plans/runtime/<slug>/`.

This document covers the six architectural layers that make that loop work, describes the data flow from user request to runtime decision, and links to the detailed reference docs for each subsystem. Readers should start here to understand how the pieces connect before diving into any individual module. See [`README.md`](../README.md) for installation instructions and the canonical directory layout.

---

## Architecture Overview

The framework is organized into six layers. Each layer has a single responsibility and communicates with adjacent layers through defined interfaces rather than direct imports across layer boundaries.

### Layer Summary

| Layer | Purpose | Key files |
|---|---|---|
| Agent / subagent / skill prompt layer | Markdown files that define orchestrator and worker behavior; injected as system prompts at turn start | `agents/`, `subagents/`, `skills/` |
| Runtime core | TypeScript loop control, turn-outcome ingestion, state persistence, and vault semantic search | `src/runtime/` |
| Adapter layer | Platform-specific translators that convert Claude hooks or OpenCode plugin events into runtime calls | `src/claude/`, `src/opencode/` |
| Shared adapter utilities | Cross-adapter lifecycle helpers: session hydration, turn-outcome parsing, destructive-command guard | `src/adapters/lifecycle.ts` |
| Plan doc layer | Source of truth for milestones, acceptance criteria, completion state, and execution evidence | `plans/<slug>.md`, `plans/runtime/<slug>/` |
| Vault layer | Optional markdown context layer; semantically indexed and retrieved to supplement agent prompts | `vault/plans/<slug>/`, `vault/shared/`, `src/runtime/unified-index-pipeline.ts` |

### Layer Descriptions

**Agent / subagent / skill prompt layer.** Markdown files in `agents/`, `subagents/`, and `skills/` define what each role does and what it must produce. `hf-builder` is injected when a milestone is being implemented; `hf-reviewer` is injected when evidence is being evaluated; `hf-planner` drives milestone decomposition. Prompts are plain markdown — no code generation required to update agent behavior, and no framework code changes are needed when a prompt is revised.

**Runtime core.** The TypeScript modules in `src/runtime/` own loop control: they read the active plan doc, determine which milestone to work on, generate the prompt context for the active agent, ingest the `turn_outcome:` emitted by that agent, update plan state, and decide the next action (advance, retry, or surface a blocker). The runtime also hosts the vault semantic search pipeline — building the vector index, diffing changed files, and returning the top-K relevant chunks to inject into the next prompt.

**Adapter layer.** The Claude adapter (`src/claude/`) and OpenCode plugin (`src/opencode/`) are thin platform bridges. They receive lifecycle events from their respective platforms (hook pre/post calls, plugin session events), translate them into runtime calls, and forward the runtime's output back to the platform. Neither adapter owns any loop logic — they delegate entirely to the runtime core and shared lifecycle utilities.

**Shared adapter utilities.** `src/adapters/lifecycle.ts` consolidates the parts of the adapter contract that are identical across platforms: reading the runtime state file to hydrate a session, parsing the `turn_outcome:` trailer from agent output, and enforcing the destructive-command guard that prevents agents from running irreversible operations without explicit approval. Centralizing these here means a fix or policy change propagates to all adapters at once.

**Plan doc layer.** A plan doc (`plans/<slug>.md`) is the executable contract for a development session. It records every milestone, its acceptance criteria, and its completion evidence. Runtime sidecar files under `plans/runtime/<slug>/` store turn-by-turn state that the runtime reads at session start to resume exactly where it left off. The plan doc is the only source of truth for "what has been done" — agents do not maintain their own memory across turns.

**Vault layer.** `vault/` is an optional context layer that agents author and the runtime reads. Plan-specific notes live under `vault/plans/<slug>/`; durable cross-plan knowledge lives under `vault/shared/`. At query time the runtime embeds the current milestone description and returns the top-K semantically relevant chunks, which are appended to the agent's prompt as supplemental context. The vault is never on the critical path — when it is absent or the index fails to load, execution continues unchanged. See [`docs/vault.md`](vault.md) for full implementation details.

---

### Data Flow

The end-to-end path from a user request to the next runtime decision:

1. **User request** — a human provides a goal or task to the active platform (Claude, OpenCode, or CLI).
2. **Planner** — `hf-planner` decomposes the goal into discrete, verifiable milestones and writes a draft plan doc.
3. **Plan reviewer** — `hf-plan-reviewer` checks the draft for coverage, clarity, and builder-readiness; the plan is revised until approved.
4. **Plan doc** — the approved plan doc (`plans/<slug>.md`) becomes the execution contract; the runtime reads it to determine the active milestone.
5. **Builder** (`hf-builder` / `hf-coder`) — the adapter injects the active milestone scope and context, the agent implements the milestone, and emits a `turn_outcome:` trailer as the final fenced block of its response.
6. **Reviewer** (`hf-reviewer`) — the adapter injects the milestone's acceptance criteria and the builder's evidence; the reviewer evaluates the output and emits its own `turn_outcome:` with a pass/fail/retry verdict.
7. **Turn outcome ingestion** — the runtime's shared lifecycle utility parses the final `turn_outcome:` block from the reviewer's response and extracts the verdict, summary, and any blocker details.
8. **Runtime decision** — the runtime core writes the verdict to the plan doc and runtime sidecar, then decides: if `state === "done"` advance the milestone pointer; if `state === "progress"` or `state === "blocked"` retry or surface the blocker to the user.
9. **Next milestone** — the runtime selects the next open milestone, rebuilds the prompt context (including a fresh vault query), and the cycle repeats from step 5.

---

## Runtime Core and Semantic Search Pipeline

The runtime core owns loop control and vault semantic search. All modules live under `src/runtime/`.

### HybridLoopRuntime Lifecycle

`HybridLoopRuntime` in `src/runtime/runtime.ts` drives the loop through five methods called in order each turn:

| Method | Responsibility |
|---|---|
| `hydrate()` | Reads the plan doc and runtime sidecar files to reconstruct session state; fires `warmupEmbeddingModel()` so the embedding model is ready before it is first needed |
| `recordEvent()` | Appends a structured event object to `events.jsonl` (session start, turn outcome, state transition) |
| `evaluateTurn()` | Parses the `turn_outcome:` trailer from the agent's response and validates it against the current milestone |
| `decideNext()` | Writes the verdict to the plan doc, updates `status.json`, and returns the next action: advance, retry, or surface a blocker |
| `writeState()` | Persists the current loop state snapshot to `status.json` and regenerates `resume-prompt.txt` |

### State Persistence

`src/runtime/persistence.ts` reads and writes three sidecar files under `plans/runtime/<slug>/`:

| File | Contents |
|---|---|
| `status.json` | Current loop state: active milestone pointer, loop counters, last decision, and blocker summary |
| `events.jsonl` | Append-only event log; each line is a JSON object representing one session event, turn outcome, or state transition |
| `resume-prompt.txt` | The last-generated resume prompt, including the injected vault context, ready for the next turn |

These files are the only source of durable turn-by-turn state. Agents hold no memory across turns — `hydrate()` reconstructs everything from these files and the plan doc at the start of each session.

---

### Semantic Search Pipeline

`src/runtime/unified-index-pipeline.ts` orchestrates an eight-step pipeline that keeps the vector index current and returns relevant chunks for prompt injection.

**Steps:**

1. **Scan** — recursively collect vault `.md` files and `.ts` source files (excluding `.test.ts`, `.d.ts`, `node_modules/`, `dist/`).
2. **Hash** — compute SHA-256 of each file's content.
3. **Diff** — compare hashes against `index.fileHashes`; bucket files into `changedOrAdded` and `removedPaths`. If nothing changed, return the existing index immediately with no embeddings or writes.
4. **Chunk** — split changed files into `VaultChunk[]` (see Chunking below).
5. **Embed** — send chunks to `embedBatch()` in groups of 100.
6. **Upsert** — call `upsertItem()` for each chunk; stale chunks from changed/removed files are purged first.
7. **Persist** — write `.hf/index.json` (metadata) and `.hf/index.bin` (vectors) atomically.
8. **Query → inject** — embed the active milestone description, run `queryItems()` for top-K results, and pass them to `formatSemanticVaultContext()` for prompt injection.

### Embedding Model

- **Model**: `Xenova/all-MiniLM-L6-v2` — HuggingFace Transformers.js, runs via local ONNX; no network required after the first download.
- **Dimension**: 384; vectors are L2-normalized at write time (mean pooling).
- **Singleton loading**: `getExtractor()` returns the same `Promise` if loading is already in progress, preventing duplicate loads.
- **Warmup**: `warmupEmbeddingModel()` is called during `hydrate()` so the model is warm before the first `embedBatch()` call. If loading fails, an `EmbeddingModelError` is thrown; the pipeline catches it and returns `null` instead of crashing.

### Chunking Strategies

**Vault markdown** (`vault-chunker.ts`): splits at `##` and `###` header boundaries (not top-level `#`). Empty preamble before the first header is filtered. Thin sections (body content < 20 characters) are merged with the adjacent section to avoid noise chunks. Each `VaultChunk` carries a deterministic `id` derived from `sourcePath + sectionTitle`.

**TypeScript source** (`code-chunker.ts`): splits at top-level declaration boundaries — `import`/`export` blocks, functions, classes, interfaces, type aliases, enums, and exported variables. All import/export statements are grouped into a single "imports" chunk. Thin chunks are merged forward. `metadata.kind` is set to `"code"`.

### Query and Prompt Injection

At turn start the runtime calls:

1. `refreshVaultIndex()` — runs the scan → hash → diff → embed → persist pipeline if the vault or source files have changed.
2. `queryItems()` — dot-product cosine similarity on unit vectors, returning top-K `QueryItemResult[]` sorted by descending score.
3. `formatSemanticVaultContext()` in `src/runtime/prompt.ts` — formats the results into two labeled sections appended to the resume prompt: `## Vault context` (plan-specific vault chunks) and `## Knowledge context` (shared vault and code chunks).

`buildResumePrompt()` and `buildPlanlessResumePrompt()` call `formatSemanticVaultContext()` to compose the final prompt text that is written to `resume-prompt.txt`.

### Fallback Behavior

When semantic results are `null` or empty — for example when the embedding model fails to load or no vault files are present — the runtime falls back to a brute-force sequential dump: it iterates vault documents in file order and appends content to the prompt until the character budget is exhausted (3 000 chars in execution mode; 4 000 chars in planning mode). This ensures agents always receive some vault context even when vector search is unavailable.

---

> **Deep dive**: see [`docs/vault.md`](vault.md) for the full module map, index storage format, testing strategy, and schema details.

---

## Adapter Layer and Lifecycle Hooks

The adapter layer is the boundary between the framework's runtime core and the AI platform that hosts the active agent session. Two adapters exist: a **Claude adapter** (`src/claude/`) driven by Claude's JSON hook system, and an **OpenCode adapter** (`src/opencode/`) driven by OpenCode's plugin event bus. Both adapters are thin translators — they receive platform events, call shared lifecycle utilities and the runtime core, and forward the runtime's output back to the platform. Neither adapter contains loop logic.

### Shared Adapter Utilities (`src/adapters/lifecycle.ts`)

All platform-specific adapters import from this module. Centralizing these helpers means a policy change (e.g., adding a new destructive command pattern) propagates to all adapters at once.

| Export | What it does |
|---|---|
| `hydrateRuntimeWithTimeout()` | Creates a `HybridLoopRuntime`, resolves the plan path (with planless fallback), races hydration against a configurable timeout, and surfaces timeout errors with a clear message |
| `ingestTurnOutcome()` | Extracts the `turn_outcome:` trailer from the hook payload via `detectTurnOutcomeInPayload()`, validates it with `parseTurnOutcomeInput()`, then calls `runtime.evaluateTurn()` for valid outcomes or `noteStopWithoutOutcome()` for missing/invalid ones |
| `isDestructiveCommand()` | Returns `true` for commands matching `git reset --hard`, `git checkout --`, or `rm -rf`; used by both adapters to block irreversible agent operations |
| `recordCompactionArchive()` | Saves a status snapshot of the current runtime state before a compaction event so the archive is queryable after the context window rolls over |
| `recordSubagentLifecycle()` | Appends a subagent start or stop event record to `events.jsonl` for traceability |

### Claude Adapter Hooks

The Claude adapter registers a single hook handler in `src/claude/hook-handler.ts`. Claude invokes it synchronously at each lifecycle event; the handler inspects `hook_event_name` and dispatches accordingly.

| Event | What the adapter does |
|---|---|
| `SessionStart` | Hydrates the runtime for the plan, calls `decideNext()`, and returns the resume prompt as `additionalContext` to prime the opening turn |
| `UserPromptSubmit` | Same flow as `SessionStart` — hydrate, record the event, call `decideNext()`, and inject the resume prompt so every human-initiated turn begins with correct plan context |
| `PreToolUse` (Bash only) | Calls `isDestructiveCommand()` on the command string; blocks execution and returns an error response if the command is destructive |
| `PreCompact` | Hydrates the runtime, records the compaction event, calls `recordCompactionArchive()` to snapshot current state, then calls `decideNext()` and injects the resume prompt into the compaction context |
| `Stop` | Hydrates the runtime, calls `detectTurnOutcomeInPayload()` to find the trailer, calls `ingestTurnOutcome()`, calls `decideNext()`, then calls `mapDecisionToClaudeStopResponse()` to translate the runtime decision into a Claude allow/block stop response |
| `SubagentStart` | Calls `recordSubagentLifecycle()` to record that a subagent session has started (running state) |
| `SubagentStop` | Calls `recordSubagentLifecycle()` to record that the subagent has finished (completed or failed state) |
| `PostToolUse` / `Notification` | Short-circuits immediately and returns `{ decision: "allow" }` — no runtime work is needed for these events |

**Claude-specific patterns:**

- **Plan binding via `--plan` flag or auto-discovery.** When the Claude adapter starts, it looks for an explicit `--plan <slug>` argument in the session's launch arguments. If none is present, it auto-discovers the most recently modified in-progress plan doc under `plans/`. This means Claude sessions can start without any manual configuration.
- **`mapDecisionToClaudeStopResponse()`.** The runtime's `decideNext()` returns a structured decision object (advance, retry, pause, escalate, complete). This function translates that decision into the exact Claude stop-hook response shape — either `{ decision: "allow" }` to let the session end, or `{ decision: "block", reason: "..." }` to inject a continuation prompt and keep the loop running.

### OpenCode Adapter Hooks

The OpenCode adapter registers hooks in `src/opencode/plugin.ts` using OpenCode's plugin API. Hooks are registered as either event observers (fire-and-forget after the fact) or filter hooks (can mutate or block the operation).

| Event | Hook type | What the adapter does |
|---|---|---|
| `session.created` | Event observer | Hydrates a per-session runtime instance, records the session-start event, calls `decideNext()`, and returns the resume prompt as `additionalContext` |
| `session.idle` | Event observer | Checks the ESC-interrupt flag; if interrupted, skips; otherwise checks the agent gate (hf-* only); ingests the turn outcome; calls `decideNext()`; auto-continues if the runtime decision and configuration allow it |
| `session.compacted` | Filter hook (`experimental.session.compacting`) | Records the compaction event, calls `recordCompactionArchive()` to snapshot runtime state, calls `decideNext()`, and injects the resume prompt into the compaction context |
| `tool.execute.before` | Filter hook | Calls `isDestructiveCommand()` to block irreversible operations; also fires a fire-and-forget event record for tool-use traceability |
| `message.updated` | Event observer | Updates two per-session flags: `interrupted` (set when a `MessageAbortedError` is detected, indicating an ESC abort) and `activeAgentIsHf` (set when the agent name matches the `hf-*` prefix pattern) |
| `subagent.started` | Event observer | Calls `recordSubagentLifecycle()` to record that a subagent has started |
| `subagent.completed` | Event observer | Calls `recordSubagentLifecycle()` to record that a subagent has completed |
| `hf_plan_start` tool | Tool registration | Binds the current session to a specific plan doc slug, triggers eager runtime hydration, and returns a status summary so the agent can confirm the plan is loaded before beginning work |

**OpenCode-specific patterns:**

- **Per-session runtime map (LRU 20).** OpenCode hosts multiple concurrent sessions. The adapter maintains an LRU-capped map (maximum 20 entries) of session ID → `HybridLoopRuntime` instance. When a new session arrives and the map is at capacity, the oldest session's runtime is evicted. Plan bindings are held in a parallel `Map<sessionId, planSlug>`.
- **Agent gate (`hf-*` prefix).** The `message.updated` observer tracks the name of the active agent. The `session.idle` handler skips all runtime logic entirely for sessions where the active agent is not `hf-*` prefixed. This prevents the framework from interfering with plain OpenCode sessions that have no plan.
- **ESC interrupt detection.** When a user presses ESC to abort a running agent turn, OpenCode surfaces a `MessageAbortedError`. The `message.updated` observer catches this and sets an `interrupted` flag on the session. The `session.idle` handler checks this flag first and skips auto-continue if it is set, so an ESC abort genuinely stops the loop rather than immediately re-triggering it.
- **`hf_plan_start` plan binding.** OpenCode sessions do not auto-discover plans. The agent must explicitly call the `hf_plan_start` tool with a plan slug. This tool call binds the session, hydrates the runtime eagerly, and returns a human-readable status summary. All subsequent hooks for that session use the bound plan.

### Comparative View

Both adapters translate the same conceptual runtime operations — hydrate, decide, ingest outcome, record lifecycle — into different platform event models. The table below maps each runtime operation to the event that triggers it in each adapter.

| Runtime operation | Claude event | OpenCode event |
|---|---|---|
| Hydrate session runtime | `SessionStart`, `UserPromptSubmit` | `session.created` |
| Inject resume prompt | `SessionStart`, `UserPromptSubmit`, `PreCompact` | `session.created`, `session.compacted` |
| Ingest turn outcome | `Stop` | `session.idle` |
| Auto-continue / advance loop | `Stop` (via block response) | `session.idle` (auto-continue) |
| Archive before compaction | `PreCompact` | `session.compacted` |
| Block destructive commands | `PreToolUse` (Bash) | `tool.execute.before` |
| Record subagent lifecycle | `SubagentStart`, `SubagentStop` | `subagent.started`, `subagent.completed` |
| Bind session to plan | `--plan` flag / auto-discovery | `hf_plan_start` tool call |

The key architectural point is that neither adapter contains any loop logic. Every decision — whether to advance, retry, pause, or escalate — comes from `runtime.decideNext()`. The adapters only translate the platform's event language into runtime calls and translate the runtime's decision back into the platform's response language.

### Turn Outcome Trailer Flow

Every agent in the loop is required to emit a `turn_outcome:` fenced JSON block as the final block of its response. The adapter detects and processes this trailer through a fixed pipeline:

```
Agent response emitted
        │
        ▼
detectTurnOutcomeInPayload()
  Recursively searches the full hook payload for a fenced
  `turn_outcome:` block. Works regardless of where in the
  payload structure the agent's output appears.
        │
        ▼
parseTurnOutcomeInput()
  Extracts the JSON from the fence and validates it against
  the turn-outcome schema. Returns a typed outcome object
  on success, or null on parse/validation failure.
        │
        ├─── valid outcome ──────────────────────────────────────┐
        │                                                         │
        ▼                                                         ▼
noteStopWithoutOutcome()                              runtime.evaluateTurn()
  Called when the trailer is absent or invalid.         Called with the validated outcome.
  Records a missed-outcome event so the plan doc         Updates turn counters, applies loop
  reflects that the agent did not report correctly.      state (running / paused / escalated /
                                                          complete), and records the outcome
                                                          to the runtime sidecar files.
        │                                                         │
        └─────────────────────┬───────────────────────────────────┘
                              │
                              ▼
                       runtime.decideNext()
                  Returns the next loop action
                  (advance, retry, pause, escalate, complete)
```

The `ingestTurnOutcome()` shared utility encapsulates the `detectTurnOutcomeInPayload()` → `parseTurnOutcomeInput()` → `evaluateTurn()` / `noteStopWithoutOutcome()` sequence so neither adapter implements this logic directly.

---

## Agent, Subagent, and Skill Prompt Layer

### Agent Hierarchy

The framework has two types of prompt-driven participants: **main agents** (orchestrators that own the full loop) and **subagents** (workers dispatched by an orchestrator for a single focused task).

| Name | Type | Purpose | Source |
|---|---|---|---|
| `hf-planner` | Main agent | Converts a user request into a plan doc; explores the repo, writes vault notes, synthesizes milestones, dispatches `hf-plan-reviewer` for approval | `agents/hf-planner.md` |
| `hf-builder` | Main agent | Executes exactly one approved milestone at a time; dispatches `hf-coder` to implement and `hf-reviewer` to verify | `agents/hf-builder.md` |
| `hf-coder` | Subagent | Implements the scope of a single milestone; makes the smallest change that satisfies acceptance criteria; reports every file touched | `subagents/hf-coder.md` |
| `hf-reviewer` | Subagent | Technical tester; verifies milestone output against acceptance criteria; returns approved/rejected with reasoning and `next_action_owner` | `subagents/hf-reviewer.md` |
| `hf-plan-reviewer` | Subagent | Reviews draft plans for coverage, clarity, and builder-readiness; returns approved/not-approved with revision requests | `subagents/hf-plan-reviewer.md` |

### Skills

Skills are packaged prompt instructions that an agent invokes to execute a specific, bounded task. They are not standalone agents — they run inside the invoking agent's turn.

| Skill | Purpose | Invoked by | Source |
|---|---|---|---|
| `hf-local-context` | Minimal repo exploration; writes findings to vault for later use by the plan-synthesis skill | `hf-planner` | `skills/local-context/SKILL.md` |
| `hf-plan-synthesis` | Writes the canonical plan doc from vault findings; structures milestones with scope, acceptance criteria, and review policy | `hf-planner` | `skills/plan-synthesis/SKILL.md` |
| `hf-milestone-tracking` | Reads and updates milestone checkboxes and appends evidence in the plan doc | `hf-builder` | `skills/milestone-tracking/SKILL.md` |
| `hf-verification-before-completion` | Runs the final verification pass before setting `status: complete` | `hf-builder` | `skills/verification-before-completion/SKILL.md` |
| `hf-vault-bootstrap` | Interactive vault initialization from a kickoff conversation; gathers context through dialogue and writes approved vault files | User-invoked | `skills/vault-bootstrap/SKILL.md` |
| `hf-workflow-eval` | Framework health evaluation; checks agent prompts, eval fixtures, and execution traces | User-invoked | `skills/workflow-eval/SKILL.md` |

### Subagent Context Flow

Vault context reaches subagents through the main agent, not through independent queries. This is an intentional design decision, not a gap.

1. **Runtime performs semantic search.** When the runtime builds the resume prompt for a main agent turn, it embeds the active milestone description, queries the vault index, and injects the top-K relevant chunks directly into that prompt.
2. **Main agent sees results in its resume prompt.** The main agent (`hf-builder` or `hf-planner`) reads the injected vault context as part of its normal context window before deciding what to do next.
3. **Main agent curates what to forward.** When the main agent constructs a dispatch payload for a subagent, it manually selects which vault excerpts are relevant to that subagent's specific task and includes only those in the payload.
4. **Subagents receive curated context via dispatch payload.** Subagents do not issue their own semantic queries. They operate exclusively on the context the main agent provides.

**Rationale.** The main agent already holds the semantically relevant chunks and has the task-level knowledge to know which subset matters to each subagent. Giving subagents independent queries would produce redundant retrieval, introduce inconsistency between what the orchestrator and worker see, and remove the orchestrator's control over relevance scoping.

### Plan Doc as Source of Truth

The plan doc (`plans/<slug>.md`) is the executable contract for a development session. Agents do not maintain memory across turns; the plan doc is the only durable record of what has been done.

- **Frontmatter** carries `plan` (slug), `created` date, and `status` (`in-progress` or `complete`). The runtime reads `status` to determine whether the plan is still active.
- **Milestones** are written as `- [ ] N. Title` checklist lines with scope and acceptance criteria in the body. Completed milestones use `- [x]`.
- **Evidence** for each milestone is appended as indented bullet lines directly under the milestone line, recording the concrete proof that acceptance criteria were met.
- **Active milestone detection.** At session start the runtime reads the plan doc top-to-bottom and treats the first unchecked milestone as the active one. No external state is needed.

---

## Operational Guide

### Debugging

Set `HF_DEBUG=1` in the environment before running a session to enable structured debug logging.

- Appends structured JSONL entries to `plans/runtime/hf-debug.log` (one JSON object per log entry).
- Useful for tracing hook dispatch, runtime hydration, and vault index build timing.
- Each entry includes a timestamp, event type, and relevant context; `jq` or any JSONL viewer can filter by event type.

### Configuration

Runtime behaviour is controlled by the `index` section of `hybrid-framework.json` at the project root. All fields are optional; defaults live in `schemas/index-defaults.json` and are merged at startup.

| Field | Default | Description |
|---|---|---|
| `topK` | `5` | Number of vault chunks to retrieve per semantic query |
| `vaultCharBudget` | `3000` | Max characters for vault context in execution-mode prompts |
| `planningVaultCharBudget` | `4000` | Max characters for vault context in planning-mode prompts |
| `codeRoots` | `["src"]` | TypeScript source directories included in the vector index |
| `indexTimeoutMs` | `15000` | Max milliseconds to wait for index build before falling back to brute-force context |

Override any field by adding an `index` key to `hybrid-framework.json`:

```json
{
  "index": {
    "topK": 8,
    "vaultCharBudget": 5000
  }
}
```

Defaults for all fields are documented in `schemas/index-defaults.json`.

### File Locking and Atomic Writes

`unified-store.ts` protects the vector index against concurrent writes and partial updates:

- Before writing, it acquires an exclusive lock file at `.hf/index.lock`. Concurrent processes wait rather than racing.
- The index save writes to a temporary file first, then atomically renames it into place. A crash mid-write leaves the previous index intact.
- The lock is released after the rename completes. If the process is killed before release, the lock file is left behind; delete `.hf/index.lock` manually to unblock subsequent runs.

### Destructive Command Guard

Both the Claude and OpenCode adapters call `isDestructiveCommand()` from `src/adapters/lifecycle.ts` before executing any Bash or shell command.

- **Blocked patterns**: `git reset --hard`, `git checkout --`, `rm -rf`
- When a command matches, the adapter returns an error response and the command is never executed; the agent receives a clear message explaining why.
- To add new blocked patterns, edit `isDestructiveCommand()` in `src/adapters/lifecycle.ts` — the change propagates to both adapters automatically.

### Testing

**Unit tests** (`tests/*.test.ts`) — run with `npm test`. Cover runtime state transitions, vault store CRUD, index pipeline, prompt generation, turn-outcome parsing, and adapter utilities. Embeddings are mocked via a deterministic stub.

**Integration tests** (`tests/unified-index-pipeline.test.ts`, `tests/prompt.test.ts`) — run with `npm test`. Use real temp directories with a mocked `embedBatch`; test the full scan → hash → diff → embed → persist → query pipeline with deterministic seed vectors.

**OpenCode e2e** (`tests/e2e/runtime-opencode-e2e.test.ts`) — run with `npm test`. Exercises the OpenCode plugin hook lifecycle with a mock SDK client; covers `session.created`, `tool.execute.before`, `session.idle` ESC-interrupt guard, and turn-outcome ingestion.

**Claude fast e2e** (`tests/e2e/runtime-claude-e2e.test.ts`) — run with `npm test`. Exercises the planless runtime path with a real `claude -p` invocation. Skipped automatically if the Claude CLI is not available or not authenticated.

**Claude slow e2e** (`tests/e2e/vault-claude-e2e.test.ts`) — requires `HF_RUN_SLOW=1` plus an authenticated Claude CLI. Tests the managed-plan/vault path end-to-end. See [`docs/claude-e2e-contract.md`](claude-e2e-contract.md) for the three-layer evidence strategy used in these tests.

Run the full suite: `npm test`. Add the slow Claude tests: `HF_RUN_SLOW=1 npm test`.

---

## Contributing

- **What to read first**: start with this document (overview and layer connections), then [`docs/vault.md`](vault.md) for semantic search details, [`docs/consumer-install.md`](consumer-install.md) for the consumer lifecycle, and [`docs/claude-e2e-contract.md`](claude-e2e-contract.md) for testing boundaries.
- **Where to find things**: prompt assets in `agents/`, `subagents/`, `skills/`; runtime in `src/runtime/`; Claude adapter in `src/claude/`; OpenCode adapter in `src/opencode/`; shared adapter utilities in `src/adapters/lifecycle.ts`; schemas in `schemas/`; tests in `tests/`.
- **Changing agent behavior**: edit the markdown file in `agents/`, `subagents/`, or `skills/` — no code changes needed. Run the relevant eval fixtures in `agents/evals/` or `subagents/evals/` to catch regressions.
- **Changing runtime behavior**: edit TypeScript in `src/runtime/` and run `npm test` to verify. Adapter-specific behavior is in `src/claude/` and `src/opencode/`.
- **Adding vault content**: see [`docs/vault.md`](vault.md) "Adding Vault Content" — use `##`/`###` headers for chunk boundaries; the index rebuilds incrementally on next use.
- **Adding a new blocked command pattern**: edit `isDestructiveCommand()` in `src/adapters/lifecycle.ts`; the change applies to all adapters automatically.
- **Running the full suite**: `npm test` for all fast tests; `HF_RUN_SLOW=1 npm test` to add the slow Claude e2e tests.

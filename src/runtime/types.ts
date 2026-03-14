export type RuntimeVendor = "opencode" | "claude" | "runtime";

export type TurnState =
  | "progress"
  | "blocked"
  | "milestone_complete"
  | "plan_complete"
  | "needs_review";

export interface TestRun {
  command: string;
  result: "pass" | "fail" | "not_run";
  summary?: string;
}

export interface BlockerInfo {
  message: string;
  signature?: string;
}

export interface TurnOutcome {
  state: TurnState;
  summary: string;
  files_changed: string[];
  tests_run: TestRun[];
  blocker?: BlockerInfo | null;
  next_action: string;
}

export interface RuntimeEvent {
  vendor: RuntimeVendor;
  type: string;
  timestamp: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

export interface VendorSessionRef {
  id: string;
  updatedAt: string;
}

export interface SubagentRef {
  id: string;
  name: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
}

export interface PlanConfig {
  maxTotalTurns: number;
  autoContinue: boolean;
}

export interface RuntimeCounters {
  /** Counts every stop/idle event (i.e. each agent invocation attempt). */
  totalAttempts: number;
  /** Counts validated turn outcomes only (successful evaluateTurn calls). */
  totalTurns: number;
  /** Upper bound on totalTurns before the loop is halted. */
  maxTotalTurns: number;
  /** Consecutive turns with no forward progress. */
  noProgress: number;
  /** Consecutive turns hitting the same blocker signature. */
  repeatedBlocker: number;
  /** Consecutive verification failures. */
  verificationFailures: number;
  /** Attempts since the last validated turn outcome. */
  turnsSinceLastOutcome: number;
}

export interface RuntimeRecoveryState {
  trigger: "stop" | "idle" | "compact" | "resume";
  sourceTrigger?: "stop" | "idle" | "compact";
  vendor: RuntimeVendor;
  eventType: string;
  sessionId?: string;
  pendingOutcome: boolean;
  at: string;
}

export interface RuntimeStatus {
  version: 1;
  planPath: string;
  planSlug: string;
  planMtimeMs: number;
  loopState: "idle" | "running" | "paused" | "escalated" | "complete";
  phase: "planning" | "execution";
  currentMilestone: PlanMilestone | null;
  counters: RuntimeCounters;
  lastProgressAt?: string;
  lastBlocker?: {
    signature: string;
    message: string;
    at: string;
  };
  lastVerification?: {
    status: "pass" | "fail" | "unknown";
    summary?: string;
    at: string;
  };
  sessions: Partial<Record<RuntimeVendor, VendorSessionRef>>;
  subagents: SubagentRef[];
  recovery?: RuntimeRecoveryState;
  recommendedNextAction?: string;
  lastOutcome?: TurnOutcome | null;
  lastTurnEvaluatedAt?: string;
  autoContinue: boolean;
  updatedAt: string;
}

export interface ContinueDecision {
  action: "continue" | "allow_stop" | "pause" | "escalate" | "complete" | "max_turns";
  reason: string;
  resume_prompt?: string;
}

export interface MilestoneContext {
  scope?: string[];
  conventions?: string;
  notes?: string;
}

export type ReviewPolicy = "required" | "auto" | "skip";

export interface PlanMilestone {
  index: number;
  checked: boolean;
  text: string;
  title: string;
  context?: MilestoneContext;
  reviewPolicy?: ReviewPolicy;
}

export interface ParsedPlan {
  path: string;
  slug: string;
  raw: string;
  userIntent?: string;
  milestones: PlanMilestone[];
  currentMilestone: PlanMilestone | null;
  status: "planning" | "in-progress" | "complete";
  completed: boolean;
  approved: boolean;
  mtimeMs: number;
  config: PlanConfig;
}

export interface VaultPaths {
  vaultRoot: string;
  planDir: string;
  sharedDir: string;
  planFiles: string[];
  sharedFiles: string[];
}

export interface VaultDocument {
  path: string;
  title: string;
  content: string;
}

export interface VaultContext {
  plan: VaultDocument[];
  shared: VaultDocument[];
}

export interface VaultChunk {
  /** Deterministic id derived from file path + section title, for deduplication. */
  id: string;
  /** Header line + body text of the section (markdown preserved). */
  text: string;
  /** Tracing metadata linking back to the source document. */
  metadata: {
    sourcePath: string;
    sectionTitle: string;
    documentTitle: string;
  };
}

export interface VaultIndexEntry {
  id: string;
  vector: number[];
  text: string;
  metadata: VaultChunk["metadata"];
}

export interface VaultIndex {
  entries: VaultIndexEntry[];
  contentHash: string;
  timestamp: string;
}

export interface VaultSearchResult {
  score: number;
  text: string;
  metadata: VaultChunk["metadata"];
}

export interface LoopRuntime {
  hydrate(planRef: string): Promise<RuntimeStatus>;
  recordEvent(event: RuntimeEvent): Promise<RuntimeStatus>;
  evaluateTurn(outcome: TurnOutcome): Promise<RuntimeStatus>;
  recordSubagent(ref: SubagentRef): Promise<RuntimeStatus>;
  recordOutcomeIngestionIssue(event: RuntimeEvent): Promise<void>;
  noteStopWithoutOutcome(): Promise<RuntimeStatus>;
  decideNext(): ContinueDecision;
  writeState(): Promise<void>;
  getStatus(): RuntimeStatus;
  getPlan(): ParsedPlan;
}

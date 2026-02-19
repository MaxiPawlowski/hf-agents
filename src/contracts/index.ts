import { z } from "zod";

export const policyModeSchema = z.enum(["fast", "balanced", "strict"]);

export const delegationCategorySchema = z.enum([
  "feature",
  "planning",
  "context",
  "validation",
  "review",
  "build",
  "docs",
  "completion",
  "implementation"
]);

export const delegationCategoryProfileSchema = z.object({
  preferredSubagent: z.string().min(1),
  requiredSkills: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([])
});

export const delegationCategoryProfilesSchema = z
  .record(delegationCategorySchema, delegationCategoryProfileSchema)
  .default({});

export const hookIdSchema = z.enum([
  "context-injection-note",
  "output-truncation-guard",
  "completion-continuation-reminder"
]);

export const hookSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  note: z.string().min(1).optional(),
  maxOutputChars: z.number().int().positive().optional()
});

export const hookRuntimeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  hooks: z.record(hookIdSchema, hookSettingsSchema).default({})
});

export const backgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().int().min(1).default(2),
  staleTimeoutMs: z.number().int().min(60_000).default(180_000)
});

export const mcpProviderIdSchema = z.enum(["tavily", "gh-grep"]);

export const mcpProviderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxResults: z.number().int().min(1).max(50).default(5)
});

export const mcpIntegrationsSchema = z.object({
  tavily: mcpProviderConfigSchema.default({ enabled: true, maxResults: 5 }),
  ghGrep: mcpProviderConfigSchema.default({ enabled: true, maxResults: 10 })
});

export const taskSchema = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
  category: delegationCategorySchema.optional(),
  constraints: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium")
});

export const policySchema = z.object({
  mode: policyModeSchema,
  useWorktreesByDefault: z.boolean().default(false),
  manageGitByDefault: z.boolean().default(false),
  requireTests: z.boolean().default(false),
  requireApprovalGates: z.boolean().default(false),
  requireVerification: z.boolean().default(false),
  requireCodeReview: z.boolean().default(false),
  enableTaskArtifacts: z.boolean().default(true),
  delegationProfiles: delegationCategoryProfilesSchema.default({}),
  hookRuntime: hookRuntimeConfigSchema.default({ enabled: true, hooks: {} }),
  backgroundTask: backgroundTaskConfigSchema.default({ defaultConcurrency: 2, staleTimeoutMs: 180000 }),
  mcp: mcpIntegrationsSchema.default({
    tavily: { enabled: true, maxResults: 5 },
    ghGrep: { enabled: true, maxResults: 10 }
  })
});

export const agentSchema = z.object({
  id: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  speedScore: z.number().min(1).max(10).default(5)
});

export const subagentSchema = z.object({
  id: z.string().min(1),
  specialization: z.string().min(1),
  inputContract: z.string().min(1),
  outputContract: z.string().min(1)
});

export const skillSchema = z.object({
  id: z.string().min(1),
  strictIn: z.array(policyModeSchema).default([]),
  triggerHints: z.array(z.string()).default([])
});

export const executionStepSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1)
});

export const executionPlanSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  steps: z.array(executionStepSchema).min(1)
});

export const codePatchSchema = z.object({
  taskId: z.string().min(1),
  summary: z.string().min(1),
  filesTouched: z.array(z.string()).default([]),
  safeguards: z.object({
    usedWorktrees: z.boolean(),
    managedGit: z.boolean(),
    autoTestsRun: z.boolean()
  })
});

export const reviewReportSchema = z.object({
  taskId: z.string().min(1),
  approved: z.boolean(),
  findings: z.array(z.string()).default([]),
  reviewer: z.literal("Reviewer")
});

export const coreDelegationResultSchema = z.object({
  plan: executionPlanSchema,
  patch: codePatchSchema,
  review: reviewReportSchema
});

export const taskArtifactSchema = z.object({
  id: z.string().min(1),
  seq: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).default("pending"),
  dependsOn: z.array(z.string().regex(/^\d{2}$/)).default([]),
  parallel: z.boolean().default(false),
  suggestedAgent: z.string().min(1),
  contextFiles: z.array(z.string()).default([]),
  referenceFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([])
});

export const taskBundleSchema = z.object({
  featureId: z.string().min(1),
  name: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(["active", "completed"]).default("active"),
  contextFiles: z.array(z.string()).default([]),
  referenceFiles: z.array(z.string()).default([]),
  exitCriteria: z.array(z.string()).default([]),
  subtasks: z.array(taskArtifactSchema).min(1)
});

export const taskLifecycleSubtaskSchema = z.object({
  id: z.string().min(1),
  seq: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).default("pending"),
  blockedReason: z.string().min(1).optional(),
  dependsOn: z.array(z.string().regex(/^\d{2}$/)).default([]),
  parallel: z.boolean().default(false),
  suggestedAgent: z.string().min(1),
  updatedAt: z.string().datetime()
});

export const taskResearchEntrySchema = z.object({
  id: z.string().min(1),
  provider: mcpProviderIdSchema,
  query: z.string().min(1),
  summary: z.string().min(1),
  links: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime()
});

export const taskLifecycleStateSchema = z.object({
  featureId: z.string().min(1),
  name: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(["active", "completed", "blocked"]).default("active"),
  contextFiles: z.array(z.string()).default([]),
  referenceFiles: z.array(z.string()).default([]),
  exitCriteria: z.array(z.string()).default([]),
  subtasks: z.array(taskLifecycleSubtaskSchema).min(1),
  researchLog: z.array(taskResearchEntrySchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const taskLifecycleStoreSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskLifecycleStateSchema).default([])
});

export const markdownContractLintFindingSchema = z.object({
  filePath: z.string().min(1),
  rule: z.enum([
    "frontmatter",
    "purpose",
    "preconditions",
    "execution-contract",
    "required-output",
    "failure-contract"
  ]),
  message: z.string().min(1)
});

export const markdownContractLintResultSchema = z.object({
  filePath: z.string().min(1),
  ok: z.boolean(),
  findings: z.array(markdownContractLintFindingSchema).default([])
});

export const routeTaskInputSchema = z.object({
  intent: z.string().min(1),
  category: delegationCategorySchema.optional(),
  profiles: delegationCategoryProfilesSchema.default({})
});

export const routeTaskDecisionSchema = z.object({
  assignedSubagent: z.string().min(1),
  source: z.enum(["profile", "heuristic"]),
  matchedCategory: delegationCategorySchema.optional()
});

export const hookRuntimeStageSchema = z.enum(["before_output", "after_output", "resume"]);

export const hookRuntimeContextSchema = z.object({
  stage: hookRuntimeStageSchema,
  intent: z.string().optional(),
  output: z.string().optional(),
  maxOutputChars: z.number().int().positive().default(4000),
  lifecycleStatus: z.enum(["active", "completed", "blocked"]).optional(),
  hookConfig: hookRuntimeConfigSchema.optional(),
  notes: z.array(z.string()).default([])
});

export const hookRuntimeResultSchema = z.object({
  output: z.string().optional(),
  notes: z.array(z.string()).default([]),
  truncated: z.boolean().default(false)
});

export const diagnosticsItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pass", "warn", "fail"]),
  summary: z.string().min(1),
  details: z.array(z.string()).default([])
});

export const diagnosticsReportSchema = z.object({
  jsonVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  ok: z.boolean(),
  items: z.array(diagnosticsItemSchema).min(1)
});

export const backgroundTaskPayloadSchema = z.object({
  kind: z.enum(["run-task", "mcp-search"]),
  mode: policyModeSchema.optional(),
  task: taskSchema.optional(),
  mcpProvider: mcpProviderIdSchema.optional(),
  query: z.string().min(1).optional(),
  featureId: z.string().min(1).optional()
});

export const backgroundTaskJobSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed"]),
  payload: backgroundTaskPayloadSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  error: z.string().min(1).optional(),
  result: z.unknown().optional()
});

export const backgroundTaskStoreSchema = z.object({
  version: z.literal(1),
  jobs: z.array(backgroundTaskJobSchema).default([])
});

export type Task = z.infer<typeof taskSchema>;
export type Policy = z.infer<typeof policySchema>;
export type DelegationCategory = z.infer<typeof delegationCategorySchema>;
export type DelegationCategoryProfile = z.infer<typeof delegationCategoryProfileSchema>;
export type DelegationCategoryProfiles = z.infer<typeof delegationCategoryProfilesSchema>;
export type HookId = z.infer<typeof hookIdSchema>;
export type HookSettings = z.infer<typeof hookSettingsSchema>;
export type HookRuntimeConfig = z.infer<typeof hookRuntimeConfigSchema>;
export type BackgroundTaskConfig = z.infer<typeof backgroundTaskConfigSchema>;
export type McpProviderId = z.infer<typeof mcpProviderIdSchema>;
export type McpProviderConfig = z.infer<typeof mcpProviderConfigSchema>;
export type McpIntegrations = z.infer<typeof mcpIntegrationsSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Subagent = z.infer<typeof subagentSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type PolicyMode = z.infer<typeof policyModeSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type CodePatch = z.infer<typeof codePatchSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type CoreDelegationResult = z.infer<typeof coreDelegationResultSchema>;
export type TaskArtifact = z.infer<typeof taskArtifactSchema>;
export type TaskBundle = z.infer<typeof taskBundleSchema>;
export type TaskLifecycleSubtask = z.infer<typeof taskLifecycleSubtaskSchema>;
export type TaskResearchEntry = z.infer<typeof taskResearchEntrySchema>;
export type TaskLifecycleState = z.infer<typeof taskLifecycleStateSchema>;
export type TaskLifecycleStore = z.infer<typeof taskLifecycleStoreSchema>;
export type MarkdownContractLintFinding = z.infer<typeof markdownContractLintFindingSchema>;
export type MarkdownContractLintResult = z.infer<typeof markdownContractLintResultSchema>;
export type RouteTaskInput = z.infer<typeof routeTaskInputSchema>;
export type RouteTaskDecision = z.infer<typeof routeTaskDecisionSchema>;
export type HookRuntimeStage = z.infer<typeof hookRuntimeStageSchema>;
export type HookRuntimeContext = z.infer<typeof hookRuntimeContextSchema>;
export type HookRuntimeResult = z.infer<typeof hookRuntimeResultSchema>;
export type DiagnosticsItem = z.infer<typeof diagnosticsItemSchema>;
export type DiagnosticsReport = z.infer<typeof diagnosticsReportSchema>;
export type BackgroundTaskPayload = z.infer<typeof backgroundTaskPayloadSchema>;
export type BackgroundTaskJob = z.infer<typeof backgroundTaskJobSchema>;
export type BackgroundTaskStore = z.infer<typeof backgroundTaskStoreSchema>;

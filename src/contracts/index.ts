import { z } from "zod";

export const settingsProfileSchema = z.enum(["light", "balanced", "strict"]);
export const contextStrategySchema = z.enum(["minimal", "standard"]);

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

export const taskSchema = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
  category: delegationCategorySchema.optional(),
  constraints: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium")
});

export const contextBundleSchema = z.object({
  taskId: z.string().min(1),
  summary: z.string().min(1),
  relevantFiles: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([])
});

export const runtimeSettingsSchema = z.object({
  profile: settingsProfileSchema,
  contextStrategy: contextStrategySchema.default("minimal"),
  useWorktreesByDefault: z.boolean().default(false),
  manageGitByDefault: z.boolean().default(false),
  requireTests: z.boolean().default(false),
  requireApprovalGates: z.boolean().default(false),
  requireVerification: z.boolean().default(false),
  requireCodeReview: z.boolean().default(false),
  enableTaskArtifacts: z.boolean().default(true),
  delegationProfiles: delegationCategoryProfilesSchema.default({}),
  hookRuntime: hookRuntimeConfigSchema.default({ enabled: true, hooks: {} })
});

export const runtimeSettingsOverridesSchema = z.object({
  profile: settingsProfileSchema.optional(),
  contextStrategy: contextStrategySchema.optional(),
  useWorktreesByDefault: z.boolean().optional(),
  manageGitByDefault: z.boolean().optional(),
  requireTests: z.boolean().optional(),
  requireApprovalGates: z.boolean().optional(),
  requireVerification: z.boolean().optional(),
  requireCodeReview: z.boolean().optional(),
  enableTaskArtifacts: z.boolean().optional(),
  delegationProfiles: delegationCategoryProfilesSchema.optional(),
  hookRuntime: hookRuntimeConfigSchema.optional()
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
  strictIn: z.array(settingsProfileSchema).default([]),
  triggerHints: z.array(z.string()).default([])
});

export const executionStepSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1)
});

export const executionPlanSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  steps: z.array(executionStepSchema).min(1),
  contextFiles: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([])
});

export const codePatchSchema = z.object({
  taskId: z.string().min(1),
  summary: z.string().min(1),
  filesTouched: z.array(z.string()).default([]),
  validationNotes: z.array(z.string()).default([]),
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
  blockingFindings: z.array(z.string()).default([]),
  reviewer: z.literal("Reviewer")
});

export const coreDelegationResultSchema = z.object({
  context: contextBundleSchema,
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

export const taskLifecycleStateSchema = z.object({
  featureId: z.string().min(1),
  name: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(["active", "completed", "blocked"]).default("active"),
  contextFiles: z.array(z.string()).default([]),
  referenceFiles: z.array(z.string()).default([]),
  exitCriteria: z.array(z.string()).default([]),
  subtasks: z.array(taskLifecycleSubtaskSchema).min(1),
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

export type Task = z.infer<typeof taskSchema>;
export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;
export type RuntimeSettingsOverrides = z.infer<typeof runtimeSettingsOverridesSchema>;
export type DelegationCategory = z.infer<typeof delegationCategorySchema>;
export type DelegationCategoryProfile = z.infer<typeof delegationCategoryProfileSchema>;
export type DelegationCategoryProfiles = z.infer<typeof delegationCategoryProfilesSchema>;
export type HookId = z.infer<typeof hookIdSchema>;
export type HookSettings = z.infer<typeof hookSettingsSchema>;
export type HookRuntimeConfig = z.infer<typeof hookRuntimeConfigSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Subagent = z.infer<typeof subagentSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type SettingsProfile = z.infer<typeof settingsProfileSchema>;
export type ContextBundle = z.infer<typeof contextBundleSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type CodePatch = z.infer<typeof codePatchSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type CoreDelegationResult = z.infer<typeof coreDelegationResultSchema>;
export type TaskArtifact = z.infer<typeof taskArtifactSchema>;
export type TaskBundle = z.infer<typeof taskBundleSchema>;
export type TaskLifecycleSubtask = z.infer<typeof taskLifecycleSubtaskSchema>;
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

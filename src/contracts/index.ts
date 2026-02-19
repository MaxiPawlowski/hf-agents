import { z } from "zod";

export const policyModeSchema = z.enum(["fast", "balanced", "strict"]);

export const taskSchema = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
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
  enableTaskArtifacts: z.boolean().default(true)
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

export type Task = z.infer<typeof taskSchema>;
export type Policy = z.infer<typeof policySchema>;
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

import type { Subagent } from "../contracts/index.js";

const CORE_SUBAGENTS: Subagent[] = [
  {
    id: "PlanOrchestrator",
    specialization: "Orchestrates brainstorm → parallel research → plan doc",
    inputContract: "Task",
    outputContract: "PlanDocument"
  },
  {
    id: "BuildOrchestrator",
    specialization: "Orchestrates milestone-by-milestone coder/reviewer loop with evidence",
    inputContract: "PlanDocument",
    outputContract: "CompletedPlan"
  },
  {
    id: "TaskManager",
    specialization: "Creates dependency-aware task artifacts for complex features",
    inputContract: "Task",
    outputContract: "TaskBundle"
  },
  {
    id: "TaskPlanner",
    specialization: "Breaks goals into executable steps",
    inputContract: "Task",
    outputContract: "ExecutionPlan"
  },
  {
    id: "ContextScout",
    specialization: "Finds relevant context and constraints",
    inputContract: "Task",
    outputContract: "ContextBundle"
  },
  {
    id: "Coder",
    specialization: "Implements code changes",
    inputContract: "ExecutionPlan",
    outputContract: "CodePatch"
  },
  {
    id: "Tester",
    specialization: "Designs and runs validations",
    inputContract: "CodePatch",
    outputContract: "ValidationReport"
  },
  {
    id: "Reviewer",
    specialization: "Reviews quality and requirement fit",
    inputContract: "CodePatch",
    outputContract: "ReviewReport"
  },
  {
    id: "BuildValidator",
    specialization: "Runs build/type checks",
    inputContract: "CodePatch",
    outputContract: "BuildReport"
  },
  {
    id: "ExternalDocsScout",
    specialization: "Fetches external library docs",
    inputContract: "LibraryQuery",
    outputContract: "DocsBundle"
  }
];

export function listSubagents(): Subagent[] {
  return CORE_SUBAGENTS;
}

export function hasSubagent(id: string): boolean {
  return CORE_SUBAGENTS.some((s) => s.id === id);
}

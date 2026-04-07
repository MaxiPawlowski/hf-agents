import { readEventLines, readStatus, getRuntimePaths } from "./persistence.js";
import { parsePlan } from "./plan-doc.js";
import type { ParsedPlan, RuntimeStatus } from "./types.js";

export interface DoctorResult {
  ok: boolean;
  issues: string[];
}

function checkStatusConsistency(status: RuntimeStatus, plan: ParsedPlan, issues: string[]): void {
  if (status.planPath !== plan.path) {
    issues.push("status.json planPath does not match the requested plan path.");
  }
  const expectedCurrentMilestone = plan.currentMilestone?.index ?? null;
  const actualCurrentMilestone = status.currentMilestone?.index ?? null;
  if (expectedCurrentMilestone !== actualCurrentMilestone) {
    issues.push("status.json current milestone is out of sync with the plan doc.");
  }
}

function validateEventLines(eventLines: string[], issues: string[]): void {
  for (const [index, line] of eventLines.entries()) {
    try {
      JSON.parse(line);
    } catch {
      issues.push(`events.jsonl line ${index + 1} is not valid JSON.`);
      break;
    }
  }
}

export async function runDoctor(planPath: string): Promise<DoctorResult> {
  const issues: string[] = [];
  let plan: ParsedPlan;

  try {
    plan = await parsePlan(planPath);
  } catch (error) {
    return {
      ok: false,
      issues: [(error as Error).message]
    };
  }

  const runtimePaths = getRuntimePaths(plan);
  let status = null;
  try {
    status = await readStatus(runtimePaths);
  } catch (error) {
    issues.push((error as Error).message);
  }
  const eventLines = await readEventLines(runtimePaths);

  if (status) {
    checkStatusConsistency(status, plan, issues);
  } else {
    issues.push("status.json is missing. Hydrate the runtime before using doctor.");
  }

  validateEventLines(eventLines, issues);

  return {
    ok: issues.length === 0,
    issues
  };
}

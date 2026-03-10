import { readEventLines, readStatus } from "./persistence.js";
import { parsePlan } from "./plan-doc.js";
import type { ParsedPlan } from "./types.js";
import { getRuntimePaths } from "./persistence.js";

export interface DoctorResult {
  ok: boolean;
  issues: string[];
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

  if (!status) {
    issues.push("status.json is missing. Hydrate the runtime before using doctor.");
  } else {
    if (status.planPath !== plan.path) {
      issues.push("status.json planPath does not match the requested plan path.");
    }

    const expectedCurrentMilestone = plan.currentMilestone?.index ?? null;
    const actualCurrentMilestone = status.currentMilestone?.index ?? null;
    if (expectedCurrentMilestone !== actualCurrentMilestone) {
      issues.push("status.json current milestone is out of sync with the plan doc.");
    }
  }

  for (const [index, line] of eventLines.entries()) {
    try {
      JSON.parse(line);
    } catch (error) {
      issues.push(`events.jsonl line ${index + 1} is not valid JSON.`);
      break;
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

import path from "node:path";
import { promises as fs } from "node:fs";

import type { ParsedPlan, PlanConfig, PlanMilestone } from "./types.js";

const CHECKBOX_PATTERN = /^- \[( |x)\] (.+)$/;
const DEFAULT_MAX_TOTAL_TURNS = 50;
const DEFAULT_AUTO_CONTINUE = true;

export function derivePlanSlug(planPath: string): string {
  const base = path.basename(planPath, path.extname(planPath));
  const match = base.match(/^\d{4}-\d{2}-\d{2}-(.+)-plan$/);
  return match?.[1] ?? base;
}

function extractConfig(raw: string): PlanConfig {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    return { maxTotalTurns: DEFAULT_MAX_TOTAL_TURNS, autoContinue: DEFAULT_AUTO_CONTINUE };
  }

  const fm = fmMatch[1] ?? "";

  const maxTurnsMatch = fm.match(/^max_turns:\s*(\d+)/m);
  const maxTotalTurns = maxTurnsMatch ? parseInt(maxTurnsMatch[1] ?? "", 10) : DEFAULT_MAX_TOTAL_TURNS;

  const autoContinueMatch = fm.match(/^auto_continue:\s*(true|false)/m);
  const autoContinue = autoContinueMatch ? autoContinueMatch[1] === "true" : DEFAULT_AUTO_CONTINUE;

  return {
    maxTotalTurns: Number.isFinite(maxTotalTurns) && maxTotalTurns > 0 ? maxTotalTurns : DEFAULT_MAX_TOTAL_TURNS,
    autoContinue
  };
}

function extractStatus(raw: string): "in-progress" | "complete" {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    return "in-progress";
  }

  const fm = fmMatch[1] ?? "";
  const statusMatch = fm.match(/^status:\s*(in-progress|complete)\s*$/m);
  return statusMatch?.[1] === "complete" ? "complete" : "in-progress";
}

function extractMilestones(raw: string): PlanMilestone[] {
  const lines = raw.split(/\r?\n/);
  const milestones: PlanMilestone[] = [];

  let inMilestones = false;

  for (const line of lines) {
    if (/^##\s+Milestones\b/i.test(line)) {
      inMilestones = true;
      continue;
    }

    if (inMilestones && /^##\s+/.test(line)) {
      break;
    }

    if (!inMilestones) {
      continue;
    }

    const match = line.match(CHECKBOX_PATTERN);
    if (!match) {
      continue;
    }

    const [, checkedMark, rawText] = match;
    const text = (rawText ?? "").trim();
    const title = text.replace(/^\d+\.\s*/, "");

    milestones.push({
      index: milestones.length + 1,
      checked: checkedMark === "x",
      text,
      title
    });
  }

  return milestones;
}

export async function parsePlan(planPath: string): Promise<ParsedPlan> {
  const absolutePlanPath = path.resolve(planPath);
  const raw = await fs.readFile(absolutePlanPath, "utf8");
  const stats = await fs.stat(absolutePlanPath);
  const milestones = extractMilestones(raw);
  const config = extractConfig(raw);
  const status = extractStatus(raw);

  if (milestones.length === 0) {
    throw new Error(`Plan doc does not contain a ## Milestones section with checkboxes: ${absolutePlanPath}`);
  }

  const currentMilestone = milestones.find((milestone) => !milestone.checked) ?? null;

  return {
    path: absolutePlanPath,
    slug: derivePlanSlug(absolutePlanPath),
    raw,
    milestones,
    currentMilestone,
    status,
    completed: currentMilestone === null && status === "complete",
    mtimeMs: stats.mtimeMs,
    config
  };
}

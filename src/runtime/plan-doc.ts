import path from "node:path";
import { promises as fs } from "node:fs";

import { hfLog } from "./logger.js";
import type { MilestoneContext, ParsedPlan, PlanConfig, PlanMilestone, ReviewPolicy } from "./types.js";

const CHECKBOX_PATTERN = /^- \[( |x)\] (.+)$/;
const METADATA_LINE_PATTERN = /^  - (\S+?):\s*(.+)$/;
const _KNOWN_METADATA_KEYS = new Set(["scope", "conventions", "notes", "review"]);
const KNOWN_EVIDENCE_KEYS = new Set(["files", "verification", "review_result", "loop", "completed", "per-item", "skill"]);
const DEFAULT_MAX_TOTAL_TURNS = 50;
const DEFAULT_AUTO_CONTINUE = true;

export function derivePlanSlug(planPath: string): string {
  const base = path.basename(planPath, path.extname(planPath));
  const match = base.match(/^\d{4}-\d{2}-\d{2}-(.+)-plan$/);
  return match?.[1] ?? base;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

function extractFrontmatter(raw: string): string | null {
  const match = raw.match(FRONTMATTER_PATTERN);
  return match?.[1] ?? null;
}

function extractConfig(fm: string | null): PlanConfig {
  if (!fm) {
    return { maxTotalTurns: DEFAULT_MAX_TOTAL_TURNS, autoContinue: DEFAULT_AUTO_CONTINUE };
  }

  const maxTurnsMatch = fm.match(/^max_turns:\s*(\d+)/m);
  const maxTotalTurns = maxTurnsMatch ? parseInt(maxTurnsMatch[1] ?? "", 10) : DEFAULT_MAX_TOTAL_TURNS;

  const autoContinueMatch = fm.match(/^auto_continue:\s*(true|false)/m);
  const autoContinue = autoContinueMatch ? autoContinueMatch[1] === "true" : DEFAULT_AUTO_CONTINUE;

  return {
    maxTotalTurns: Number.isFinite(maxTotalTurns) && maxTotalTurns > 0 ? maxTotalTurns : DEFAULT_MAX_TOTAL_TURNS,
    autoContinue
  };
}

function extractStatus(fm: string | null): "planning" | "in-progress" | "complete" {
  if (!fm) {
    return "in-progress";
  }

  const statusMatch = fm.match(/^status:\s*(planning|in-progress|complete)\s*$/m);
  const value = statusMatch?.[1];
  return value === "complete" || value === "in-progress" || value === "planning" ? value : "in-progress";
}

const REVIEW_POLICY_VALUES = new Set(["required", "auto", "skip"]);

function parseScope(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, ""))
    .filter(Boolean);
}

function parseMetadataLines(
  metadataLines: string[]
): { context?: MilestoneContext; reviewPolicy?: ReviewPolicy } {
  const context: MilestoneContext = {};
  let reviewPolicy: ReviewPolicy | undefined;

  for (const line of metadataLines) {
    const match = line.match(METADATA_LINE_PATTERN);
    if (!match) continue;

    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();

    switch (key) {
      case "scope":
        context.scope = parseScope(value);
        break;
      case "conventions":
        context.conventions = value;
        break;
      case "notes":
        context.notes = value;
        break;
      case "review":
        if (REVIEW_POLICY_VALUES.has(value)) {
          reviewPolicy = value as ReviewPolicy;
        }
        // Legacy evidence values are ignored; new evidence uses review_result: key
        break;
      default:
        if (!KNOWN_EVIDENCE_KEYS.has(key)) {
          hfLog({ tag: "plan-doc", msg: `unknown metadata key "${key}" — typo?`, data: { key, value } });
        }
        break;
    }
  }

  const result: { context?: MilestoneContext; reviewPolicy?: ReviewPolicy } = {};

  if (context.scope || context.conventions || context.notes) {
    result.context = context;
  }

  if (reviewPolicy) {
    result.reviewPolicy = reviewPolicy;
  }

  return result;
}

function extractSection(raw: string, heading: string): string | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^##\\s+${escapedHeading}\\b\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "im");
  const match = raw.match(pattern);
  const section = match?.[1]?.trim();
  return section && section.length > 0 ? section : undefined;
}

function extractMilestones(raw: string): PlanMilestone[] {
  const lines = raw.split(/\r?\n/);
  const milestones: PlanMilestone[] = [];

  let inMilestones = false;
  let pendingMetadata: string[] = [];

  function finalizePending(): void {
    if (milestones.length > 0 && pendingMetadata.length > 0) {
      const last = milestones[milestones.length - 1]!;
      const parsed = parseMetadataLines(pendingMetadata);
      if (parsed.context) last.context = parsed.context;
      if (parsed.reviewPolicy) last.reviewPolicy = parsed.reviewPolicy;
    }
    pendingMetadata = [];
  }

  for (const line of lines) {
    if (/^##\s+Milestones\b/i.test(line)) {
      inMilestones = true;
      continue;
    }

    if (inMilestones && /^##\s+/.test(line)) {
      finalizePending();
      break;
    }

    if (!inMilestones) {
      continue;
    }

    const checkboxMatch = line.match(CHECKBOX_PATTERN);
    if (checkboxMatch) {
      finalizePending();

      const [, checkedMark, rawText] = checkboxMatch;
      const text = (rawText ?? "").trim();
      const title = text.replace(/^\d+\.\s*/, "");

      milestones.push({
        index: milestones.length + 1,
        checked: checkedMark === "x",
        text,
        title
      });
      continue;
    }

    // Collect indented metadata lines for the current milestone
    if (METADATA_LINE_PATTERN.test(line)) {
      pendingMetadata.push(line);
    }
  }

  finalizePending();
  return milestones;
}

export async function parsePlan(planPath: string): Promise<ParsedPlan> {
  const absolutePlanPath = path.resolve(planPath);
  const [raw, stats] = await Promise.all([
    fs.readFile(absolutePlanPath, "utf8"),
    fs.stat(absolutePlanPath)
  ]);
  const fm = extractFrontmatter(raw);
  const userIntent = extractSection(raw, "User Intent");
  const milestones = extractMilestones(raw);
  const config = extractConfig(fm);
  const status = extractStatus(fm);

  if (milestones.length === 0) {
    throw new Error(`Plan doc does not contain a ## Milestones section with checkboxes: ${absolutePlanPath}`);
  }

  const currentMilestone = milestones.find((milestone) => !milestone.checked) ?? null;

  return {
    path: absolutePlanPath,
    slug: derivePlanSlug(absolutePlanPath),
    raw,
    ...(userIntent ? { userIntent } : {}),
    milestones,
    currentMilestone,
    status,
    approved: status !== "planning",
    completed: currentMilestone === null && status === "complete",
    mtimeMs: stats.mtimeMs,
    config
  };
}

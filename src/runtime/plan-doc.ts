import path from "node:path";
import { promises as fs } from "node:fs";

import { hfLog } from "./logger.js";
import type { MilestoneContext, ParsedPlan, PlanConfig, PlanMilestone, ReviewPolicy } from "./types.js";

const CHECKBOX_PATTERN = /^- \[([ x])\] (.+)$/;
const METADATA_LINE_PATTERN = /^ {2}- ([^:\s]+):[ \t]*(\S[^\r\n]*)$/;
const _KNOWN_METADATA_KEYS = new Set(["scope", "conventions", "notes", "review"]);
const KNOWN_EVIDENCE_KEYS = new Set(["files", "verification", "review_result", "loop", "completed", "per-item", "skill"]);
const DEFAULT_MAX_TOTAL_TURNS = 50;
const DEFAULT_AUTO_CONTINUE = true;
const PLAN_SLUG_PATTERN = /^\d{4}-\d{2}-\d{2}-(.+)-plan$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
const MAX_TURNS_PATTERN = /^max_turns:\s*(\d+)/m;
const AUTO_CONTINUE_PATTERN = /^auto_continue:\s*(true|false)/m;
const STATUS_PATTERN = /^status:\s*(planning|in-progress|complete)\s*$/m;
const STATUS_IN_PROGRESS = "in-progress" as const;

export function derivePlanSlug(planPath: string): string {
  const base = path.basename(planPath, path.extname(planPath));
  const match = PLAN_SLUG_PATTERN.exec(base);
  return match?.[1] ?? base;
}

function extractFrontmatter(raw: string): string | null {
  const match = FRONTMATTER_PATTERN.exec(raw);
  return match?.[1] ?? null;
}

function extractConfig(fm: string | null): PlanConfig {
  if (!fm) {
    return { maxTotalTurns: DEFAULT_MAX_TOTAL_TURNS, autoContinue: DEFAULT_AUTO_CONTINUE };
  }

  const maxTurnsMatch = MAX_TURNS_PATTERN.exec(fm);
  const maxTotalTurns = maxTurnsMatch ? parseInt(maxTurnsMatch[1] ?? "", 10) : DEFAULT_MAX_TOTAL_TURNS;

  const autoContinueMatch = AUTO_CONTINUE_PATTERN.exec(fm);
  const autoContinue = autoContinueMatch ? autoContinueMatch[1] === "true" : DEFAULT_AUTO_CONTINUE;

  return {
    maxTotalTurns: Number.isFinite(maxTotalTurns) && maxTotalTurns > 0 ? maxTotalTurns : DEFAULT_MAX_TOTAL_TURNS,
    autoContinue
  };
}

function extractStatus(fm: string | null): "planning" | "in-progress" | "complete" {
  if (!fm) {
    return STATUS_IN_PROGRESS;
  }

  const statusMatch = STATUS_PATTERN.exec(fm);
  const value = statusMatch?.[1];
  return value === "complete" || value === STATUS_IN_PROGRESS || value === "planning" ? value : STATUS_IN_PROGRESS;
}

const REVIEW_POLICY_VALUES = new Set(["required", "auto", "skip"]);

function parseScope(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().replaceAll(/^`|`$/g, ""))
    .filter(Boolean);
}

function applyMetadataKey(
  key: string,
  value: string,
  context: MilestoneContext,
): ReviewPolicy | undefined {
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
        return value as ReviewPolicy;
      }
      // Legacy evidence values are ignored; new evidence uses review_result: key
      break;
    default:
      if (!KNOWN_EVIDENCE_KEYS.has(key)) {
        hfLog({ tag: "plan-doc", msg: `unknown metadata key "${key}" — typo?`, data: { key, value } });
      }
      break;
  }
  return undefined;
}

function parseMetadataLines(
  metadataLines: string[]
): { context?: MilestoneContext; reviewPolicy?: ReviewPolicy } {
  const context: MilestoneContext = {};
  let reviewPolicy: ReviewPolicy | undefined;

  for (const line of metadataLines) {
    const match = METADATA_LINE_PATTERN.exec(line);
    if (!match) continue;
    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();
    const policy = applyMetadataKey(key, value, context);
    if (policy) reviewPolicy = policy;
  }

  const result: { context?: MilestoneContext; reviewPolicy?: ReviewPolicy } = {};
  if (context.scope || context.conventions || context.notes) result.context = context;
  if (reviewPolicy) result.reviewPolicy = reviewPolicy;
  return result;
}

function extractSection(raw: string, heading: string): string | undefined {
  const escapedHeading = heading.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^##\\s+${escapedHeading}\\b\\r?\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "im");
  const match = pattern.exec(raw);
  const section = match?.[1]?.trim();
  return section && section.length > 0 ? section : undefined;
}

function applyPendingMetadata(milestones: PlanMilestone[], pendingMetadata: string[]): void {
  if (milestones.length > 0 && pendingMetadata.length > 0) {
    const last = milestones.at(-1);
    if (!last) return;
    const parsed = parseMetadataLines(pendingMetadata);
    if (parsed.context) last.context = parsed.context;
    if (parsed.reviewPolicy) last.reviewPolicy = parsed.reviewPolicy;
  }
}

interface MilestoneParseState {
  milestones: PlanMilestone[];
  pendingMetadata: string[];
  inMilestones: boolean;
  done: boolean;
}

function processCheckboxLine(match: RegExpExecArray, state: MilestoneParseState): void {
  applyPendingMetadata(state.milestones, state.pendingMetadata);
  state.pendingMetadata = [];
  const [, checkedMark, rawText] = match;
  const text = (rawText ?? "").trim();
  const title = text.replace(/^\d+\.\s*/, "");
  state.milestones.push({
    index: state.milestones.length + 1,
    checked: checkedMark === "x",
    text,
    title
  });
}

function processLine(line: string, state: MilestoneParseState): void {
  if (/^##\s+Milestones\b/i.test(line)) {
    state.inMilestones = true;
    return;
  }
  if (state.inMilestones && /^##\s+/.test(line)) {
    applyPendingMetadata(state.milestones, state.pendingMetadata);
    state.pendingMetadata = [];
    state.done = true;
    return;
  }
  if (!state.inMilestones) return;
  const checkboxMatch = CHECKBOX_PATTERN.exec(line);
  if (checkboxMatch) {
    processCheckboxLine(checkboxMatch, state);
    return;
  }
  if (METADATA_LINE_PATTERN.test(line)) {
    state.pendingMetadata.push(line);
  }
}

function extractMilestones(raw: string): PlanMilestone[] {
  const lines = raw.split(/\r?\n/);
  const state: MilestoneParseState = { milestones: [], pendingMetadata: [], inMilestones: false, done: false };

  for (const line of lines) {
    processLine(line, state);
    if (state.done) break;
  }

  applyPendingMetadata(state.milestones, state.pendingMetadata);
  return state.milestones;
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

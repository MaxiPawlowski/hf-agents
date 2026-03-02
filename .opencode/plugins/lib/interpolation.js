import fs from "fs";
import path from "path";
import { TOGGLE_KEYS, TOGGLE_RULE_TEXT, FRAMEWORK_ROOT } from "./config.js";

// Detects any interpolation token: inline, conditional, or skill include.
export const hasInterpolationTokens = (text) =>
  /\{\{(?:toggle\.|rule\.|skill\.|#(?:if|unless)\s+toggle\.)/i.test(String(text ?? ""));

// --- Markdown cleanup ---

// Collapses blank list items left behind after interpolation removes rule text,
// strips trailing whitespace, and normalises runs of blank lines.
const cleanupInterpolatedMarkdown = (text) => {
  const lines = String(text ?? "").split(/\r?\n/);
  const cleaned = [];
  let inFence = false;
  let fenceToken = "";

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceToken = token[0];
      } else if (token[0] === fenceToken) {
        inFence = false;
        fenceToken = "";
      }
      cleaned.push(line.replace(/\s+$/g, ""));
      continue;
    }

    const trimmed = line.trim();
    if (!inFence && (trimmed === "-" || trimmed === "*" || /^\d+\.$/.test(trimmed))) {
      cleaned.push("");
      continue;
    }
    // Preserve indentation for whitespace-only lines (e.g., inside indented code blocks).
    cleaned.push(trimmed === "" ? line : line.replace(/\s+$/g, ""));
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n");
};

// --- Toggle state line pruning (backwards compat) ---

// Drops lines whose sole purpose is to report an OFF toggle state,
// keeping the context clean when a gate is disabled.
const pruneToggleStateLines = (text, toggles) => {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Example: "- Toggle state `require_verification`: OFF"
    const toggleStateMatch = trimmed.match(/toggle\s+state\s+`([^`]+)`\s*:\s*(on|off)\b/i);
    if (toggleStateMatch) {
      const [, key, state] = toggleStateMatch;
      if (TOGGLE_KEYS.includes(key) && state.toLowerCase() === "off" && !toggles[key]) continue;
    }

    // Example: "Gate state: `require_tests=OFF`"
    const gateStateMatch = trimmed.match(/gate\s+state\s*:\s*`\s*([a-z0-9_]+)\s*=\s*(on|off)\s*`/i);
    if (gateStateMatch) {
      const [, key, state] = gateStateMatch;
      if (TOGGLE_KEYS.includes(key) && state.toLowerCase() === "off" && !toggles[key]) continue;
    }

    out.push(line);
  }

  return out.join("\n");
};

// --- Inline token resolution ---

const resolveInlineTokens = (text, toggles) =>
  String(text ?? "").replace(
    /\{\{(toggle|rule)\.([a-z0-9_]+)\}\}/g,
    (_full, kind, key) => {
      if (!TOGGLE_KEYS.includes(key)) return "";
      if (kind === "toggle") return toggles[key] ? "ON" : "OFF";
      return toggles[key] ? (TOGGLE_RULE_TEXT[key] ?? "") : "";
    },
  );

// --- Conditional block resolution ---

// Iterates until stable so nested blocks are resolved bottom-up (innermost first).
// Supports {{#if toggle.key}}...{{else}}...{{/if}} and the inverse {{#unless}}.
const resolveConditionals = (text, toggles) => {
  let prev;
  do {
    prev = text;
    text = text.replace(
      /\{\{#if\s+toggle\.([a-z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key, body) => {
        const [truePart, falsePart = ""] = body.split("{{else}}");
        return toggles[key] ? truePart : falsePart;
      },
    );
    text = text.replace(
      /\{\{#unless\s+toggle\.([a-z0-9_]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      (_, key, body) => {
        const [falsePart, truePart = ""] = body.split("{{else}}");
        return !toggles[key] ? falsePart : truePart;
      },
    );
  } while (text !== prev);
  return text;
};

// --- Skill file inclusion ---

const MAX_SKILL_DEPTH = 5;
const SKILL_TOKEN = /\{\{skill\.([a-z0-9_-]+)\}\}/g;

const stripFrontmatter = (text) =>
  String(text ?? "").replace(/^---[\s\S]*?\n---\s*\n?/, "");

// Function declarations for mutual recursion (hoisted within this module).

function pipeline(text, toggles, depth = 0) {
  text = resolveSkillIncludes(text, toggles, depth);
  text = resolveConditionals(text, toggles);
  text = resolveInlineTokens(text, toggles);
  text = pruneToggleStateLines(text, toggles);
  return cleanupInterpolatedMarkdown(text);
}

// Resolves {{skill.name}} by reading FRAMEWORK_ROOT/skills/name/SKILL.md,
// stripping its frontmatter, and running the full pipeline recursively.
// Returns an HTML comment on missing or unreadable files.
function resolveSkillIncludes(text, toggles, depth) {
  if (depth >= MAX_SKILL_DEPTH) return text;
  return String(text ?? "").replace(SKILL_TOKEN, (_, name) => {
    const filePath = path.join(FRAMEWORK_ROOT, "skills", name, "SKILL.md");
    if (!fs.existsSync(filePath)) return `<!-- skill.${name}: not found -->`;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return pipeline(stripFrontmatter(raw), toggles, depth + 1);
    } catch {
      return `<!-- skill.${name}: read error -->`;
    }
  });
}

export const interpolateText = (text, toggles) =>
  pipeline(String(text ?? ""), toggles, 0);

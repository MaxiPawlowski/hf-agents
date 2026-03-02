import fs from "fs";
import path from "path";
import {
  FRAMEWORK_ROOT,
  FRAMEWORK_NAME,
  TOGGLE_KEYS,
  TOGGLE_COMMAND_FILE_BY_KEY,
} from "./config.js";
import { safeRead, safeWrite } from "./state.js";

// --- Input handling ---

export const isCommandOutput = (value) =>
  value !== null &&
  typeof value === "object" &&
  "parts" in value &&
  Array.isArray(value.parts);

export const parseToggleArg = (value) => {
  const token = String(value ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (["on", "true", "1", "enable", "enabled"].includes(token)) return true;
  if (["off", "false", "0", "disable", "disabled"].includes(token)) return false;
  return null;
};

// --- Output formatting ---

export const statusText = (toggles) =>
  `Toggle status: ${TOGGLE_KEYS.map((key) => `${key}=${toggles[key] ? "ON" : "OFF"}`).join(", ")}`;

export const formatToggleStatusLine = (toggles) =>
  `Toggle Status: ${TOGGLE_KEYS.map((key) => `${key}=${toggles[key] ? "ON" : "OFF"}`).join(", ")}`;

export const formatToggleUpdatedAndStatus = (toggleKey, enabled, toggles) =>
  `Toggle Updated: ${toggleKey}=${enabled ? "ON" : "OFF"}\n${formatToggleStatusLine(toggles)}`;

// --- Bootstrap block ---

const enabledToggleKeys = (toggles) =>
  TOGGLE_KEYS.filter((key) => Boolean(toggles?.[key]));

export const buildBootstrap = (toggles) => {
  const enabled = enabledToggleKeys(toggles);
  const enabledText = enabled.length ? enabled.join(", ") : "none";
  return `<FRAMEWORK_IMPORTANT>
You are running inside the Hybrid Framework runtime.

Framework root: ${FRAMEWORK_ROOT}
Runtime toggles enabled: ${enabledText}

Key references (do not inline full docs):
- ${FRAMEWORK_NAME}/context/project/runtime-preferences.md
- ${FRAMEWORK_NAME}/skills/core-delegation/SKILL.md
</FRAMEWORK_IMPORTANT>`;
};

// --- Command palette description updates ---

// Updates the frontmatter `description:` for toggle commands to include
// an "HF: ON|OFF - ..." prefix so slash-command palettes stay current.
// Called only on actual toggle changes; instance.dispose() handles the reload.
export const updateToggleCommandDescriptions = (toggles) => {
  for (const key of TOGGLE_KEYS) {
    const fileName = TOGGLE_COMMAND_FILE_BY_KEY[key];
    if (!fileName) continue;

    const filePath = path.join(FRAMEWORK_ROOT, "commands", fileName);
    if (!fs.existsSync(filePath)) continue;

    const raw = safeRead(filePath);
    if (!raw) continue;

    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const descMatch = fm.match(/^description\s*:\s*(.*)\s*$/m);
    if (!descMatch) continue;

    const unquoted = descMatch[1].trim().replace(/^["']|["']$/g, "").trim();
    const base = unquoted.replace(/^HF:\s*(?:ON|OFF)\s*-\s*/i, "HF: ");
    const nextDesc = base.replace(/^HF:\s*/i, `HF: ${toggles[key] ? "ON" : "OFF"} - `);

    const nextFm = fm.replace(/^description\s*:\s*.*\s*$/m, `description: "${nextDesc}"`);
    const nextRaw = raw.replace(fmMatch[0], `---${eol}${nextFm}${eol}---${eol}`);

    if (nextRaw !== raw) safeWrite(filePath, nextRaw);
  }
};

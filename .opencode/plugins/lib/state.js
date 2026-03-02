import fs from "fs";
import path from "path";
import { SETTINGS_TOGGLE_KEYS } from "./config.js";

const STATE_BY_DIRECTORY = new Map();
const MAX_CACHED_DIRECTORIES = 50;

// --- File I/O utilities (also used by commands.js) ---

export const safeRead = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

export const safeWrite = (filePath, content) => {
  fs.writeFileSync(filePath, content, "utf8");
};

// --- Settings file ---

const settingsPathFor = (directory) =>
  path.join(directory, "settings", "framework-settings.json");

const readSettingsFile = (directory) => {
  const settingsPath = settingsPathFor(directory);
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const raw = safeRead(settingsPath);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

// --- Toggle state ---

const defaultToggles = () => ({
  use_worktree: false,
  require_tests: false,
  require_verification: false,
  task_artifacts: false,
});

const fromSettingsFile = (directory) => {
  const raw = readSettingsFile(directory);
  const toggles = defaultToggles();
  const source = raw && typeof raw === "object" ? raw.toggles ?? {} : {};

  toggles.use_worktree = Boolean(source.useWorktreesByDefault || source.manageGitByDefault);
  toggles.require_tests = Boolean(source.requireTests);
  toggles.require_verification = Boolean(
    source.requireApprovalGates || source.requireVerification || source.requireCodeReview,
  );
  toggles.task_artifacts = Boolean(source.enableTaskArtifacts);

  return toggles;
};

const persistState = (directory) => {
  const settingsPath = settingsPathFor(directory);
  const settingsDir = path.dirname(settingsPath);
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  const state = getState(directory);
  const existing = readSettingsFile(directory);
  const nextToggles = { ...(existing.toggles ?? {}) };

  for (const [pluginKey, settingsKeys] of Object.entries(SETTINGS_TOGGLE_KEYS)) {
    for (const settingsKey of settingsKeys) {
      nextToggles[settingsKey] = Boolean(state[pluginKey]);
    }
  }

  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify({ ...existing, toggles: nextToggles }, null, 2)}\n`,
    "utf8",
  );
};

// --- Public API ---

export const getState = (directory) => {
  const key = path.resolve(directory);
  if (!STATE_BY_DIRECTORY.has(key)) {
    if (STATE_BY_DIRECTORY.size >= MAX_CACHED_DIRECTORIES) {
      const firstKey = STATE_BY_DIRECTORY.keys().next().value;
      if (firstKey) STATE_BY_DIRECTORY.delete(firstKey);
    }
    STATE_BY_DIRECTORY.set(key, fromSettingsFile(key));
  }
  return STATE_BY_DIRECTORY.get(key);
};

export const setToggle = (directory, toggleKey, value) => {
  const state = getState(directory);
  state[toggleKey] = value;
  persistState(directory);
};

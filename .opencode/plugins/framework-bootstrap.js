/**
 * Framework plugin for OpenCode
 *
 * Injects markdown-first bootstrap guidance into system prompt.
 * Keeps runtime aligned with repository defaults and local skills.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return content;
  return match[2];
};

const safeRead = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

const parseDotenvLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) {
    return null;
  }

  const key = match[1];
  let value = match[2] ?? "";

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    const inlineComment = value.indexOf(" #");
    if (inlineComment >= 0) {
      value = value.slice(0, inlineComment).trimEnd();
    }
  }

  return { key, value };
};

const loadDotenvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = safeRead(filePath);
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotenvLine(line);
    if (!parsed) {
      continue;
    }
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
};

export const FrameworkBootstrapPlugin = async () => {
  const homeDir = os.homedir();
  const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(homeDir, ".config/opencode");
  const dotenvCandidates = [
    process.env.OPENCODE_DOTENV_PATH,
    path.join(configDir, ".env"),
    path.join(process.cwd(), ".env")
  ].filter(Boolean);

  for (const dotenvPath of dotenvCandidates) {
    loadDotenvFile(path.resolve(String(dotenvPath)));
  }

  const runtimePrefPath = path.resolve(__dirname, "../context/project/runtime-preferences.md");
  const coreDelegationPath = path.resolve(__dirname, "../skills/core-delegation/SKILL.md");

  const runtimePreferences = safeRead(runtimePrefPath);
  const coreDelegationBody = stripFrontmatter(safeRead(coreDelegationPath));

  const bootstrap = `<FRAMEWORK_IMPORTANT>
You are running inside the framework runtime.

This repository is markdown-first for OpenCode behavior. Prefer .opencode markdown configuration over hardcoded assumptions.

Skills location:
- Project: .opencode/skills/
- User: ${configDir}/skills/

Canonical defaults and mode behavior live in:
- .opencode/context/project/runtime-preferences.md

Canonical delegation workflow lives in:
- .opencode/skills/core-delegation/SKILL.md

Runtime config alerts:
- Lightweight profile enabled: background and MCP integrations are intentionally excluded.

Runtime preferences context:
${runtimePreferences}

Core delegation reference:
${coreDelegationBody}
</FRAMEWORK_IMPORTANT>`;

  return {
    event: async () => {},
    "experimental.chat.system.transform": async (_input, output) => {
      (output.system ||= []).push(bootstrap);
    }
  };
};

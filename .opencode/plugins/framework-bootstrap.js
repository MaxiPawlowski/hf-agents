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

const resolveTavilyApiKey = () => {
  if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.length > 0) {
    return process.env.TAVILY_API_KEY;
  }

  const mcpUrl = process.env.TAVILY_MCP_URL;
  if (!mcpUrl) {
    return undefined;
  }

  try {
    const url = new URL(mcpUrl);
    const key = url.searchParams.get("tavilyApiKey");
    return key && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
};

const skillList = [
  "hf-brainstorming",
  "hf-writing-plans",
  "hf-subagent-driven-development",
  "hf-systematic-debugging",
  "hf-verification-before-completion",
  "hf-dispatching-parallel-agents",
  "hf-test-driven-development",
  "hf-executing-plans",
  "hf-requesting-code-review",
  "hf-receiving-code-review",
  "hf-finishing-a-development-branch",
  "hf-using-git-worktrees",
  "hf-task-management",
  "hf-core-delegation"
];

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

  const envFilePath = path.join(configDir, ".env");
  const tavilyConfigured = Boolean(resolveTavilyApiKey());
  let tavilyWarningShown = false;

  const runtimePrefPath = path.resolve(__dirname, "../context/project/runtime-preferences.md");
  const coreDelegationPath = path.resolve(__dirname, "../skills/core-delegation/SKILL.md");

  const runtimePreferences = safeRead(runtimePrefPath);
  const coreDelegationBody = stripFrontmatter(safeRead(coreDelegationPath));

  const bootstrap = `<FRAMEWORK_IMPORTANT>
You are running inside the framework runtime.

This repository is markdown-first for OpenCode behavior. Prefer .opencode markdown configuration over hardcoded assumptions.

Runtime defaults:
- No worktrees unless explicitly requested by the user.
- No git management unless explicitly requested by the user.
- No mandatory tests by default; manual validation is acceptable unless user requests tests.
- No approval-gate blocking flow by default.

Primary skill set:
${skillList.map((s) => `- ${s}`).join("\n")}

Skills location:
- Project: .opencode/skills/
- User: ${configDir}/skills/

Use OpenCode native skill tool to load skills when needed.

Runtime config alerts:
${tavilyConfigured ? "- Tavily: configured" : `- Tavily: not configured. Set TAVILY_API_KEY in ${envFilePath} (or use TAVILY_MCP_URL).`}

Runtime preferences context:
${runtimePreferences}

Core delegation reference:
${coreDelegationBody}
</FRAMEWORK_IMPORTANT>`;

  return {
    event: async () => {
      if (!tavilyConfigured && !tavilyWarningShown) {
        tavilyWarningShown = true;
        console.warn(
          `[framework-bootstrap] Tavily is not configured. Add TAVILY_API_KEY to ${envFilePath} (or set TAVILY_MCP_URL).`
        );
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      (output.system ||= []).push(bootstrap);
    }
  };
};

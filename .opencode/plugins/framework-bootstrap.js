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

Runtime preferences context:
${runtimePreferences}

Core delegation reference:
${coreDelegationBody}
</FRAMEWORK_IMPORTANT>`;

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      (output.system ||= []).push(bootstrap);
    }
  };
};

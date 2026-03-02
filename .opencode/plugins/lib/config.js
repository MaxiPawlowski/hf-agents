import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve framework root from plugin install location.
// lib/ sits one level below plugins/, which sits one level below the framework root.
// This allows installs under .opencode, .opencode.local, or any other namespace.
export const FRAMEWORK_ROOT = path.resolve(__dirname, "../..");
export const FRAMEWORK_NAME = path.basename(FRAMEWORK_ROOT);

export const TOGGLE_KEYS = [
  "use_worktree",
  "require_tests",
  "require_verification",
  "task_artifacts",
];

export const COMMAND_TOGGLE_MAP = {
  "toggle-worktree": "use_worktree",
  "toggle-tests": "require_tests",
  "toggle-verification": "require_verification",
  "toggle-artifacts": "task_artifacts",
};

export const TOGGLE_COMMAND_FILE_BY_KEY = {
  use_worktree: "toggle-worktree.md",
  require_tests: "toggle-tests.md",
  require_verification: "toggle-verification.md",
  task_artifacts: "toggle-artifacts.md",
};

export const TOGGLE_RULE_TEXT = {
  use_worktree: "Enable worktree-aware and managed git execution decisions.",
  require_tests: "Require test evidence before ready state.",
  require_verification:
    "Require approval, verification, and reviewer signoff before completion.",
  task_artifacts: "Maintain task lifecycle artifacts during execution.",
};

export const SETTINGS_TOGGLE_KEYS = {
  use_worktree: ["useWorktreesByDefault", "manageGitByDefault"],
  require_tests: ["requireTests"],
  require_verification: [
    "requireApprovalGates",
    "requireVerification",
    "requireCodeReview",
  ],
  task_artifacts: ["enableTaskArtifacts"],
};


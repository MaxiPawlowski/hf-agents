import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve framework root from plugin install location.
// lib/ sits one level below plugins/, which sits one level below the framework root.
// This allows installs under .opencode, .opencode.local, or any other namespace.
export const FRAMEWORK_ROOT = path.resolve(__dirname, "../..");
export const FRAMEWORK_NAME = path.basename(FRAMEWORK_ROOT);

export const TOGGLE_KEYS = [
  "deep_plan",
  "enable_review",
];

export const COMMAND_TOGGLE_MAP = {
  "toggle-plan": "deep_plan",
  "toggle-review": "enable_review",
};

export const TOGGLE_COMMAND_FILE_BY_KEY = {
  deep_plan: "toggle-plan.md",
  enable_review: "toggle-review.md",
};

export const TOGGLE_RULE_TEXT = {
  deep_plan: "Run web research, brainstorming, online code search, and plan synthesis during planning phase.",
  enable_review: "Run verification and reviewer agent at the end of the build flow.",
};

export const SETTINGS_TOGGLE_KEYS = {
  deep_plan: ["deepPlan"],
  enable_review: ["enableReview"],
};


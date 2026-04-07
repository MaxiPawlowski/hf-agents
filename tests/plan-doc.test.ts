import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { derivePlanSlug, parsePlan } from "../src/runtime/plan-doc.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-plandoc-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writePlan(content: string, filename = "2026-03-07-my-feature-plan.md"): Promise<string> {
  const plansDir = path.join(tmpDir, "plans");
  await fs.mkdir(plansDir, { recursive: true });
  const planPath = path.join(plansDir, filename);
  await fs.writeFile(planPath, content, "utf8");
  return planPath;
}

const MINIMAL_PLAN = [
  "# Test Plan",
  "",
  "## User Intent",
  "",
  "Build a feature.",
  "",
  "## Milestones",
  "",
  "- [ ] 1. First milestone",
  "- [ ] 2. Second milestone"
].join("\n");

// ---------------------------------------------------------------------------
// derivePlanSlug
// ---------------------------------------------------------------------------

describe("derivePlanSlug", () => {
  test("extracts slug from date-prefixed plan filename", () => {
    expect(derivePlanSlug("plans/2026-03-07-my-feature-plan.md")).toBe("my-feature");
  });

  test("returns base name for non-matching filename", () => {
    expect(derivePlanSlug("plans/random-file.md")).toBe("random-file");
  });

  test("returns base name when -plan suffix is missing", () => {
    expect(derivePlanSlug("plans/2026-03-07-no-suffix.md")).toBe("2026-03-07-no-suffix");
  });

  test("handles absolute paths", () => {
    expect(derivePlanSlug("/home/user/project/plans/2026-03-07-auth-plan.md")).toBe("auth");
  });

  test("handles multi-word slugs", () => {
    expect(derivePlanSlug("plans/2026-01-15-add-dark-mode-plan.md")).toBe("add-dark-mode");
  });
});

// ---------------------------------------------------------------------------
// parsePlan
// ---------------------------------------------------------------------------

describe("parsePlan", () => {
  test("throws when plan has no milestones section", async () => {
    const planPath = await writePlan("# Plan\n\nJust a heading, no milestones.");
    await expect(parsePlan(planPath)).rejects.toThrow("does not contain");
  });

  test("throws when milestones section has no checkboxes", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "Some text but no checkboxes."
    ].join("\n");
    const planPath = await writePlan(content);
    await expect(parsePlan(planPath)).rejects.toThrow("does not contain");
  });

  test("parses a minimal plan with defaults", async () => {
    const planPath = await writePlan(MINIMAL_PLAN);
    const plan = await parsePlan(planPath);

    expect(plan.milestones).toHaveLength(2);
    expect(plan.currentMilestone?.index).toBe(1);
    expect(plan.status).toBe("in-progress");
    expect(plan.approved).toBe(true);
    expect(plan.completed).toBe(false);
    expect(plan.config.maxTotalTurns).toBe(50);
    expect(plan.config.autoContinue).toBe(true);
  });

  test("returns completed:true when all milestones checked and status is complete", async () => {
    const content = [
      "---",
      "status: complete",
      "---",
      "",
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [x] 1. First done",
      "- [x] 2. Second done"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.completed).toBe(true);
    expect(plan.currentMilestone).toBeNull();
    expect(plan.status).toBe("complete");
  });

  test("returns completed:false when all checked but status is in-progress", async () => {
    const content = [
      "---",
      "status: in-progress",
      "---",
      "",
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [x] 1. First done",
      "- [x] 2. Second done"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.completed).toBe(false);
    expect(plan.currentMilestone).toBeNull();
  });

  test("uses defaults when no frontmatter exists", async () => {
    const planPath = await writePlan(MINIMAL_PLAN);
    const plan = await parsePlan(planPath);

    expect(plan.config.maxTotalTurns).toBe(50);
    expect(plan.config.autoContinue).toBe(true);
    expect(plan.status).toBe("in-progress");
  });

  test("treats max_turns:0 as invalid and uses default 50", async () => {
    const content = [
      "---",
      "max_turns: 0",
      "---",
      "",
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [ ] 1. First milestone"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.config.maxTotalTurns).toBe(50);
  });

  test("respects valid max_turns and auto_continue from frontmatter", async () => {
    const content = [
      "---",
      "max_turns: 10",
      "auto_continue: false",
      "---",
      "",
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [ ] 1. First milestone"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.config.maxTotalTurns).toBe(10);
    expect(plan.config.autoContinue).toBe(false);
  });

  test("parses enriched milestone metadata", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [ ] 1. Build auth module",
      "  - scope: `src/auth`, `src/middleware`",
      "  - conventions: Use JWT tokens",
      "  - notes: Check existing patterns first",
      "  - review: required"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.milestones).toHaveLength(1);
    const [milestone] = plan.milestones;
    assert(milestone !== undefined, "Expected milestone at index 0");
    expect(milestone.context?.scope).toEqual(["src/auth", "src/middleware"]);
    expect(milestone.context?.conventions).toBe("Use JWT tokens");
    expect(milestone.context?.notes).toBe("Check existing patterns first");
    expect(milestone.reviewPolicy).toBe("required");
  });

  test("extracts each valid status value", async () => {
    for (const status of ["planning", "in-progress", "complete"] as const) {
      const content = [
        "---",
        `status: ${status}`,
        "---",
        "",
        "# Plan",
        "",
        "## Milestones",
        "",
        "- [x] 1. Done"
      ].join("\n");
      const planPath = await writePlan(content, `plan-${status}.md`);
      const plan = await parsePlan(planPath);

      expect(plan.status).toBe(status);
      expect(plan.approved).toBe(status !== "planning");
    }
  });

  test("defaults status to in-progress without frontmatter status field", async () => {
    const content = [
      "---",
      "max_turns: 25",
      "---",
      "",
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [ ] 1. First"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.status).toBe("in-progress");
    expect(plan.approved).toBe(true);
  });

  test("extracts userIntent from ## User Intent section", async () => {
    const planPath = await writePlan(MINIMAL_PLAN);
    const plan = await parsePlan(planPath);

    expect(plan.userIntent).toBe("Build a feature.");
  });

  test("returns undefined userIntent when section is missing", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [ ] 1. First milestone"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.userIntent).toBeUndefined();
  });

  test("sets slug from plan filename", async () => {
    const planPath = await writePlan(MINIMAL_PLAN, "2026-03-07-my-feature-plan.md");
    const plan = await parsePlan(planPath);

    expect(plan.slug).toBe("my-feature");
  });

  test("currentMilestone is the first unchecked milestone", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [x] 1. First done",
      "- [ ] 2. Second in progress",
      "- [ ] 3. Third pending"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.currentMilestone?.index).toBe(2);
    expect(plan.currentMilestone?.title).toBe("Second in progress");
  });

  test("milestone title strips leading number prefix", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [ ] 1. Build the feature"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.milestones[0]?.title).toBe("Build the feature");
    expect(plan.milestones[0]?.text).toBe("1. Build the feature");
  });

  test("ignores evidence lines and does not treat them as context", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [x] 1. Add validation - reject empty inputs",
      "  - scope: `src/api/users.ts`",
      "  - review: auto",
      "  - files: `src/api/users.ts`",
      "  - verification: `npm test` passed",
      "  - review_result: approved by hf-reviewer - looks good"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);
    const [m] = plan.milestones;
    assert(m !== undefined, "Expected milestone at index 0");

    expect(m.context?.scope).toEqual(["src/api/users.ts"]);
    expect(m.reviewPolicy).toBe("auto");
    expect(m.reviewPolicy).not.toBe("approved by hf-reviewer - looks good");
  });

  test("treats loop-style metadata as non-canonical evidence", async () => {
    const content = [
      "# Plan",
      "",
      "## Milestones",
      "",
      "- [x] 1. Simplify files - lint clean",
      "  - loop: `src/modules/**/*.ts` (12 items)",
      "  - completed: 12/12 items"
    ].join("\n");
    const planPath = await writePlan(content);
    const plan = await parsePlan(planPath);

    expect(plan.milestones[0]?.context).toBeUndefined();
    expect(plan.milestones[0]?.reviewPolicy).toBeUndefined();
  });
});

import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

/** Resolve directories that must carry REVIEW.md + evals/evals.json. */
async function discoverReviewableDirs(): Promise<string[]> {
  const roots = ["agents", "subagents", "skills"] as const;
  const dirs: string[] = [];

  for (const root of roots) {
    const rootPath = path.join(repoRoot, root);
    // Skip if root doesn't exist (e.g. repo hasn't added skills/ yet)
    try {
      await access(rootPath);
    } catch {
      continue;
    }

    if (root === "skills") {
      // skills/ has nested subdirectories — each is a reviewable unit
      const entries = await readdir(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(path.join(rootPath, entry.name));
        }
      }
    } else {
      // agents/ and subagents/ are themselves the reviewable unit
      dirs.push(rootPath);
    }
  }

  return dirs;
}

describe("lean-core repo shape", () => {
  test("agents and subagents stay collapsed to the lean-core set", async () => {
    const agentFiles = (await readdir(path.join(repoRoot, "agents")))
      .filter((entry) => entry.endsWith(".md") && entry !== "REVIEW.md")
      .sort();
    const subagentFiles = (await readdir(path.join(repoRoot, "subagents")))
      .filter((entry) => entry.endsWith(".md") && entry !== "REVIEW.md")
      .sort();

    expect(agentFiles).toEqual(["hf-builder.md", "hf-planner.md"]);
    expect(subagentFiles).toEqual(["hf-coder.md", "hf-plan-reviewer.md", "hf-reviewer.md"]);
  });

  test("every agent, subagent, and skill directory has REVIEW.md and evals/evals.json", async () => {
    const dirs = await discoverReviewableDirs();

    // Sanity: at least the known roots are discovered
    expect(dirs.length).toBeGreaterThanOrEqual(3);

    for (const dir of dirs) {
      const label = path.relative(repoRoot, dir);

      const reviewPath = path.join(dir, "REVIEW.md");
      await expect(
        access(reviewPath),
        `${label} is missing REVIEW.md`
      ).resolves.toBeUndefined();

      const evalsPath = path.join(dir, "evals", "evals.json");
      await expect(
        access(evalsPath),
        `${label} is missing evals/evals.json`
      ).resolves.toBeUndefined();
    }
  });

  test("registry and sync script expose the same lean-core prompt set", async () => {
    const registryRaw = await readFile(path.join(repoRoot, ".opencode", "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { assets: Array<{ path: string }> };
    const exposedPromptPaths = registry.assets
      .map((asset) => asset.path)
      .filter((assetPath) => assetPath.includes("/agents/") || assetPath.includes("/subagents/"))
      .sort();

    expect(exposedPromptPaths).toEqual([
      "../agents/hf-builder.md",
      "../agents/hf-planner.md",
      "../subagents/hf-coder.md",
      "../subagents/hf-plan-reviewer.md",
      "../subagents/hf-reviewer.md"
    ]);

    const syncScript = await readFile(path.join(repoRoot, "scripts", "sync-opencode-assets.mjs"), "utf8");
    expect(syncScript).toContain('"agents/hf-planner.md"');
    expect(syncScript).toContain('"agents/hf-builder.md"');
    expect(syncScript).toContain('"subagents/hf-coder.md"');
    expect(syncScript).toContain('"subagents/hf-plan-reviewer.md"');
    expect(syncScript).toContain('"subagents/hf-reviewer.md"');
    expect(syncScript).not.toContain("hf-builder-deep");
    expect(syncScript).not.toContain("hf-build-validator");
  });

  test("generated OpenCode adapter outputs stay ignored", async () => {
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");

    expect(gitignore).toContain(".opencode/agents/");
    expect(gitignore).toContain(".opencode/skills/");
    expect(gitignore).toContain(".opencode/node_modules/");
    expect(gitignore).toContain(".opencode/plugins/hybrid-runtime.js");
  });
});

describe("adapter README drift detection", () => {
  test("Claude README references only files and directories that exist", async () => {
    const readmePath = path.join(repoRoot, ".claude", "README.md");
    const readme = await readFile(readmePath, "utf8");

    // Key file paths referenced in the Claude README (resolved from .claude/)
    const referencedPaths: Array<{ path: string; label: string }> = [
      { path: "agents", label: "agents/" },
      { path: "subagents", label: "subagents/" },
      { path: "skills", label: "skills/" },
      { path: "src", label: "src/" },
      { path: "schemas", label: "schemas/" },
      { path: "README.md", label: "../README.md" },
      { path: "plans/README.md", label: "../plans/README.md" },
      { path: ".claude/settings.example.json", label: "settings.example.json" },
      { path: "src/claude/hook-handler.ts", label: "../src/claude/hook-handler.ts" },
      { path: "scripts/install-runtime.mjs", label: "scripts/install-runtime.mjs" },
    ];

    for (const ref of referencedPaths) {
      // Verify the README actually mentions this reference
      expect(readme, `Claude README should mention ${ref.label}`).toContain(ref.label);

      // Verify the file/directory exists in the repo
      await expect(
        access(path.join(repoRoot, ref.path)),
        `Claude README references ${ref.label} but ${ref.path} does not exist`,
      ).resolves.toBeUndefined();
    }
  });

  test("Claude README hook event list matches settings.example.json keys", async () => {
    const readme = await readFile(path.join(repoRoot, ".claude", "README.md"), "utf8");
    const settingsRaw = await readFile(
      path.join(repoRoot, ".claude", "settings.example.json"),
      "utf8",
    );
    const settings = JSON.parse(settingsRaw) as { hooks: Record<string, unknown> };
    const hookKeys = Object.keys(settings.hooks).sort();

    // The README lists hook events as "- `EventName`" bullets
    const readmeHookEvents = [...readme.matchAll(/^- `(\w+)`$/gm)]
      .map((m) => m[1])
      .sort();

    expect(readmeHookEvents.length).toBeGreaterThan(0);
    expect(readmeHookEvents).toEqual(hookKeys);
  });

  test("OpenCode README references only files and directories that exist", async () => {
    const readmePath = path.join(repoRoot, ".opencode", "README.md");
    const readme = await readFile(readmePath, "utf8");

    // Key file paths referenced in the OpenCode README (resolved from .opencode/)
    const referencedPaths: Array<{ path: string; label: string }> = [
      { path: "agents", label: "agents/" },
      { path: "subagents", label: "subagents/" },
      { path: "skills", label: "skills/" },
      { path: "src", label: "src/" },
      { path: "schemas", label: "schemas/" },
      { path: "README.md", label: "../README.md" },
      { path: "plans/README.md", label: "../plans/README.md" },
      { path: ".opencode/registry.json", label: "registry.json" },
      { path: "scripts/sync-opencode-assets.mjs", label: "scripts/sync-opencode-assets.mjs" },
      { path: "scripts/install-runtime.mjs", label: "scripts/install-runtime.mjs" },
    ];

    for (const ref of referencedPaths) {
      // Verify the README actually mentions this reference
      expect(readme, `OpenCode README should mention ${ref.label}`).toContain(ref.label);

      // Verify the file/directory exists in the repo
      await expect(
        access(path.join(repoRoot, ref.path)),
        `OpenCode README references ${ref.label} but ${ref.path} does not exist`,
      ).resolves.toBeUndefined();
    }
  });

  test("OpenCode README references correct generated output paths in .gitignore", async () => {
    const readme = await readFile(path.join(repoRoot, ".opencode", "README.md"), "utf8");
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");

    // The README mentions these as generated/not-tracked — they should be in .gitignore
    const generatedPaths = [
      ".opencode/agents/",
      ".opencode/skills/",
      ".opencode/plugins/hybrid-runtime.js",
    ];

    for (const genPath of generatedPaths) {
      // Verify these generated paths are mentioned in README (as not tracked)
      expect(readme, `OpenCode README should mention ${genPath}`).toContain(
        genPath.replace(".opencode/", ".opencode/"),
      );
      // Verify they remain in .gitignore
      expect(gitignore, `${genPath} should be in .gitignore`).toContain(genPath);
    }
  });
});

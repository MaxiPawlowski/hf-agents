import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

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

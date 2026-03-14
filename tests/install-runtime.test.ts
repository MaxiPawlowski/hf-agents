import path from "node:path";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

// @ts-ignore -- Vitest executes the JS installer module directly; this test only checks its exported pure helpers.
import { buildClaudeHooks, buildOpenCodePluginSource, main } from "../scripts/install-runtime.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("install-runtime surfaces", () => {
  test("Claude example settings stay aligned with the shipped linux hook map", async () => {
    const raw = await readFile(path.join(repoRoot, ".claude", "settings.example.json"), "utf8");
    const settings = JSON.parse(raw) as { hooks: ReturnType<typeof buildClaudeHooks> };

    expect(settings.hooks).toEqual(buildClaudeHooks("linux"));
  });

  test("OpenCode plugin loader source matches the installer output", async () => {
    expect(buildOpenCodePluginSource()).toBe("export { HybridRuntimePlugin } from \"../../dist/src/opencode/plugin.js\";\n");
  });
});

describe("install-runtime smoke tests", () => {
  test("module exports are defined functions", () => {
    expect(typeof buildClaudeHooks).toBe("function");
    expect(typeof buildOpenCodePluginSource).toBe("function");
    expect(typeof main).toBe("function");
  });

  test("buildClaudeHooks returns expected hook event keys for both platforms", () => {
    const expectedKeys = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PreCompact",
      "Stop",
      "SubagentStart",
      "SubagentStop"
    ];

    for (const platform of ["linux", "windows"] as const) {
      const hooks = buildClaudeHooks(platform);
      expect(Object.keys(hooks).sort()).toEqual([...expectedKeys].sort());

      // Each event key maps to a non-empty array of hook groups
      for (const key of expectedKeys) {
        expect(Array.isArray(hooks[key])).toBe(true);
        expect(hooks[key].length).toBeGreaterThan(0);
      }
    }
  });

  test("buildClaudeHooks windows commands use backslash path separators", () => {
    const hooks = buildClaudeHooks("windows");
    const sessionStartCommand = hooks.SessionStart[0].hooks[0].command as string;

    expect(sessionStartCommand).toContain("%CLAUDE_PROJECT_DIR%");
    expect(sessionStartCommand).toContain("\\\\");
    expect(sessionStartCommand).toMatch(/^node /);
  });

  test("buildClaudeHooks linux commands use forward-slash path separators", () => {
    const hooks = buildClaudeHooks("linux");
    const sessionStartCommand = hooks.SessionStart[0].hooks[0].command as string;

    expect(sessionStartCommand).toContain("$CLAUDE_PROJECT_DIR/");
    expect(sessionStartCommand).not.toContain("\\\\");
    expect(sessionStartCommand).toMatch(/^node /);
  });

  test("buildClaudeHooks with external targetDir produces node_modules paths", () => {
    const externalDir = "/some/other/project";
    const hooks = buildClaudeHooks("linux", externalDir, "hybrid-framework");
    const command = hooks.Stop[0].hooks[0].command as string;

    expect(command).toContain("node_modules/hybrid-framework/dist/src/bin/hf-claude-hook.js");
  });

  test("buildOpenCodePluginSource with external targetDir produces node_modules path", () => {
    const externalDir = "/some/other/project";
    const source = buildOpenCodePluginSource(externalDir, "hybrid-framework");

    expect(source).toContain("node_modules/hybrid-framework/dist/src/opencode/plugin.js");
    expect(source).toMatch(/^export \{/);
    expect(source).toMatch(/\n$/);
  });
});

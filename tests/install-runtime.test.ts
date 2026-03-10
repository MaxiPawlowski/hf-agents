import path from "node:path";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

// @ts-ignore -- Vitest executes the JS installer module directly; this test only checks its exported pure helpers.
import { buildClaudeHooks, buildOpenCodePluginSource } from "../scripts/install-runtime.mjs";

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

import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";

import { describe, expect, test } from "vitest";

// @ts-ignore -- Vitest executes the JS installer module directly; this test only checks its exported pure helpers.
import { buildClaudeHooks } from "../scripts/lib/install-claude.mjs";
// @ts-ignore
import { buildOpenCodePluginSource } from "../scripts/lib/install-opencode.mjs";
import { isString } from "../src/runtime/utils.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

function runScript(platform: "install-claude.mjs" | "install-opencode.mjs", args: string[]) {
  // Map old per-platform entry-point scripts to hf-setup with --platform flag.
  const platformFlag = platform === "install-claude.mjs" ? "claude" : "opencode";
  const [cmd, ...rest] = args;
  const mappedArgs = cmd && !cmd.startsWith("-")
    ? ["--command", cmd, "--platform", platformFlag, ...rest]
    : ["--platform", platformFlag, ...args];
  const result = spawnSync(process.execPath, [path.join(repoRoot, "dist", "src", "bin", "hf-setup.js"), ...mappedArgs], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error([
      `hf-setup (${platform}) failed: ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n\n"));
  }

  return result;
}

function runInstaller(args: string[]) {
  // Map positional command to --command flag (e.g. ["init", "--skip-build", ...] → ["--command", "init", "--skip-build", ...])
  // Always add --platform both so hf-setup runs non-interactively (same as the old install-runtime.mjs default).
  const [cmd, ...rest] = args;
  const mappedArgs = cmd && !cmd.startsWith("-")
    ? ["--command", cmd, "--platform", "both", ...rest]
    : ["--platform", "both", ...args];
  const result = spawnSync(process.execPath, [path.join(repoRoot, "dist", "src", "bin", "hf-setup.js"), ...mappedArgs], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error([
      `hf-setup failed: ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n\n"));
  }

  return result;
}

function runPackDryRun() {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- test intentionally validates PATH-based npm execution
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error([
      "npm pack --dry-run --json failed",
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n\n"));
  }

  const npmPackJsonPattern = /(\[\s*\{[\s\S]*\}\s*\])/u;
  const match = npmPackJsonPattern.exec(result.stdout);
  const jsonPayload = match?.[1];
  if (!jsonPayload) {
    throw new Error(`Could not find npm pack JSON output:\n\n${result.stdout}`);
  }

  return JSON.parse(jsonPayload) as Array<{ files: Array<{ path: string }>; entryCount: number }>;
}

async function expectPath(filePath: string) {
  await expect(stat(filePath)).resolves.toBeDefined();
}

async function expectMissingPath(filePath: string) {
  await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

async function createConsumerFixture() {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "hf-install-runtime-"));

  await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
    name: "fixture-project",
    private: true
  }, null, 2), "utf8");

  await writeFile(path.join(fixtureRoot, "hybrid-framework.json"), JSON.stringify({
    adapters: {
      claude: { enabled: true },
      opencode: { enabled: true }
    },
    scaffold: {
      plans: true,
      vault: true
    },
    assets: {
      mode: "copy",
      claude: {
        copy: [
          "agents/hf-builder.md",
          "skills/local-context/SKILL.md"
        ]
      },
      opencode: {
        copy: [
          "agents/hf-builder.md",
          "skills/local-context/SKILL.md"
        ],
        syncGenerated: true
      }
    }
  }, null, 2), "utf8");

  await mkdir(path.join(fixtureRoot, ".claude"), { recursive: true });
  await writeFile(path.join(fixtureRoot, ".claude", "settings.local.json"), JSON.stringify({
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: "node ./custom-stop.js"
            }
          ]
        }
      ]
    }
  }, null, 2), "utf8");

  return fixtureRoot;
}

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
  test("npm pack dry-run retains lifecycle files and excludes dev-only sources", () => {
    const packResult = runPackDryRun()[0];
    if (!packResult) {
      throw new Error("expected npm pack output");
    }

    const { files, entryCount } = packResult;
    const packagedPaths = new Set(files.map((file) => file.path));

    expect(entryCount).toBeGreaterThan(0);
    expect(packagedPaths).toContain("dist/src/bin/hf-setup.js");
    expect(packagedPaths).toContain("scripts/lib/install-helpers.mjs");
    expect(packagedPaths).toContain("scripts/lib/install-claude.mjs");
    expect(packagedPaths).toContain("scripts/lib/install-opencode.mjs");
    expect(packagedPaths).toContain("scripts/sync-opencode-assets.mjs");
    expect(packagedPaths).toContain("dist/src/bin/hf-runtime.js");
    expect(packagedPaths).toContain("vault/templates/plan-context.md");
    expect(packagedPaths).not.toContain("tests/install-runtime.test.ts");
    expect(packagedPaths).not.toContain("src/runtime/runtime.ts");
    expect(packagedPaths).not.toContain("plans/2026-03-16-package-distribution-and-project-init-plan.md");
  }, 30_000);

  test("module exports are defined functions", () => {
    expect(buildClaudeHooks).toBeTypeOf("function");
    expect(buildOpenCodePluginSource).toBeTypeOf("function");
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
      expect(Object.keys(hooks).sort((a, b) => a.localeCompare(b))).toEqual([...expectedKeys].sort((a, b) => a.localeCompare(b)));

      // Each event key maps to a non-empty array of hook groups
      for (const key of expectedKeys) {
        expect(Array.isArray(hooks[key])).toBe(true);
        expect(hooks[key].length).toBeGreaterThan(0);
      }
    }
  });

  test("buildClaudeHooks commands use $CLAUDE_PROJECT_DIR with forward slashes on all platforms", () => {
    for (const platform of ["linux", "windows"] as const) {
      const hooks = buildClaudeHooks(platform);
      const sessionStartCommand = hooks.SessionStart[0].hooks[0].command as string;

      expect(sessionStartCommand).toContain("$CLAUDE_PROJECT_DIR/");
      expect(sessionStartCommand).not.toContain("\\\\");
      expect(sessionStartCommand).not.toContain("%CLAUDE_PROJECT_DIR%");
      expect(sessionStartCommand).toMatch(/^node /);
    }
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

  test("dedicated Claude install wires only Claude-managed artifacts", async () => {
    const fixtureRoot = await createConsumerFixture();
    const claudeSettingsPath = path.join(fixtureRoot, ".claude", "settings.local.json");

    runScript("install-claude.mjs", ["install", "--skip-build", "--target-dir", fixtureRoot]);

    await expectPath(path.join(fixtureRoot, ".hybrid-framework", "generated-state.json"));
    await expectPath(path.join(fixtureRoot, ".claude", "agents", "hf-builder.md"));
    await expectPath(path.join(fixtureRoot, ".claude", "skills", "local-context", "SKILL.md"));
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "registry.json"));
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "agents", "hf-builder.md"));
    await expectMissingPath(path.join(fixtureRoot, "plans"));
    await expectMissingPath(path.join(fixtureRoot, "vault"));

    const settings = JSON.parse(await readFile(claudeSettingsPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const installedStopCommands = settings.hooks?.Stop
      ?.flatMap((group) => group.hooks ?? [])
      .map((hook) => hook.command)
      .filter((command): command is string => isString(command) && command.includes("hf-claude-hook.js") && command.endsWith(" Stop")) ?? [];
    expect(installedStopCommands).toHaveLength(1);
  });

  test("dedicated Claude init, sync, and uninstall stay isolated from OpenCode", async () => {
    const fixtureRoot = await createConsumerFixture();
    const claudeAgentPath = path.join(fixtureRoot, ".claude", "agents", "hf-builder.md");

    runScript("install-claude.mjs", ["init", "--skip-build", "--target-dir", fixtureRoot]);

    await expectPath(path.join(fixtureRoot, "plans", "README.md"));
    await expectPath(path.join(fixtureRoot, "vault", "README.md"));
    await expectPath(claudeAgentPath);
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "agents", "hf-builder.md"));

    await writeFile(claudeAgentPath, "tampered claude agent\n", "utf8");
    runScript("install-claude.mjs", ["sync", "--target-dir", fixtureRoot]);

    expect(await readFile(claudeAgentPath, "utf8")).toBe(await readFile(path.join(repoRoot, "agents", "hf-builder.md"), "utf8"));
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));

    runScript("install-claude.mjs", ["uninstall", "--target-dir", fixtureRoot]);

    await expectMissingPath(path.join(fixtureRoot, ".hybrid-framework", "generated-state.json"));
    await expectMissingPath(claudeAgentPath);
    await expectMissingPath(path.join(fixtureRoot, ".claude", "skills", "local-context", "SKILL.md"));
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));
  });

  test("dedicated OpenCode install wires only OpenCode-managed artifacts", async () => {
    const fixtureRoot = await createConsumerFixture();
    const claudeSettingsPath = path.join(fixtureRoot, ".claude", "settings.local.json");
    const originalClaudeSettings = await readFile(claudeSettingsPath, "utf8");

    runScript("install-opencode.mjs", ["install", "--skip-build", "--target-dir", fixtureRoot]);

    await expectPath(path.join(fixtureRoot, ".hybrid-framework", "generated-state.json"));
    await expectPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));
    await expectPath(path.join(fixtureRoot, ".opencode", "agents", "hf-builder.md"));
    await expectPath(path.join(fixtureRoot, ".opencode", "skills", "local-context", "SKILL.md"));
    await expectMissingPath(path.join(fixtureRoot, ".claude", "agents", "hf-builder.md"));
    await expectMissingPath(path.join(fixtureRoot, ".claude", "skills", "local-context", "SKILL.md"));
    await expectMissingPath(path.join(fixtureRoot, "plans"));
    await expectMissingPath(path.join(fixtureRoot, "vault"));
    expect(await readFile(claudeSettingsPath, "utf8")).toBe(originalClaudeSettings);
  });

  test("dedicated OpenCode init, sync, and uninstall stay isolated from Claude", async () => {
    const fixtureRoot = await createConsumerFixture();
    const opencodeAgentPath = path.join(fixtureRoot, ".opencode", "agents", "hf-builder.md");
    const claudeSettingsPath = path.join(fixtureRoot, ".claude", "settings.local.json");
    const originalClaudeSettings = await readFile(claudeSettingsPath, "utf8");

    runScript("install-opencode.mjs", ["init", "--skip-build", "--target-dir", fixtureRoot]);

    await expectPath(path.join(fixtureRoot, "plans", "README.md"));
    await expectPath(path.join(fixtureRoot, "vault", "README.md"));
    await expectPath(opencodeAgentPath);
    await expectMissingPath(path.join(fixtureRoot, ".claude", "agents", "hf-builder.md"));
    expect(await readFile(claudeSettingsPath, "utf8")).toBe(originalClaudeSettings);

    await writeFile(opencodeAgentPath, "tampered opencode agent\n", "utf8");
    runScript("install-opencode.mjs", ["sync", "--target-dir", fixtureRoot]);

    expect(await readFile(opencodeAgentPath, "utf8")).toBe(await readFile(path.join(repoRoot, "agents", "hf-builder.md"), "utf8"));
    expect(await readFile(claudeSettingsPath, "utf8")).toBe(originalClaudeSettings);

    runScript("install-opencode.mjs", ["uninstall", "--target-dir", fixtureRoot]);

    await expectMissingPath(path.join(fixtureRoot, ".hybrid-framework", "generated-state.json"));
    await expectMissingPath(opencodeAgentPath);
    await expectMissingPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));
    expect(await readFile(claudeSettingsPath, "utf8")).toBe(originalClaudeSettings);
  });

  test("init, sync, and uninstall manage a consumer fixture safely and idempotently", async () => {
    const fixtureRoot = await createConsumerFixture();
    const plansReadmePath = path.join(fixtureRoot, "plans", "README.md");
    const opencodeAgentPath = path.join(fixtureRoot, ".opencode", "agents", "hf-builder.md");
    const claudeAgentPath = path.join(fixtureRoot, ".claude", "agents", "hf-builder.md");

    runInstaller(["init", "--skip-build", "--target-dir", fixtureRoot]);

    await expectPath(path.join(fixtureRoot, "plans"));
    await expectPath(path.join(fixtureRoot, "plans", "evidence", ".gitkeep"));
    await expectPath(path.join(fixtureRoot, "plans", "runtime", ".gitkeep"));
    await expectPath(path.join(fixtureRoot, "vault", "README.md"));
    await expectPath(path.join(fixtureRoot, "vault", "shared", "architecture.md"));
    await expectPath(path.join(fixtureRoot, "vault", "templates", "plan-context.md"));
    await expectPath(path.join(fixtureRoot, ".hybrid-framework", "generated-state.json"));
    await expectPath(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"));
    await expectPath(path.join(fixtureRoot, ".opencode", "skills", "local-context", "SKILL.md"));
    await expectPath(opencodeAgentPath);
    await expectPath(path.join(fixtureRoot, ".claude", "skills", "local-context", "SKILL.md"));
    await expectPath(claudeAgentPath);

    const initialSettings = JSON.parse(await readFile(path.join(fixtureRoot, ".claude", "settings.local.json"), "utf8")) as {
      permissions?: { allow?: string[] };
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    expect(initialSettings.permissions?.allow).toContain("Bash(npm test)");
    expect(initialSettings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe("node ./custom-stop.js");
    const installedStopCommands = initialSettings.hooks?.Stop
      ?.flatMap((group) => group.hooks ?? [])
      .map((hook) => hook.command)
      .filter((command): command is string => isString(command) && command.includes("hf-claude-hook.js") && command.endsWith(" Stop")) ?? [];
    expect(installedStopCommands).toHaveLength(1);

    await writeFile(plansReadmePath, `${await readFile(plansReadmePath, "utf8")}\nMANUAL MARKER\n`, "utf8");
    await writeFile(opencodeAgentPath, "tampered opencode agent\n", "utf8");
    await writeFile(claudeAgentPath, "tampered claude agent\n", "utf8");

    runInstaller(["init", "--skip-build", "--target-dir", fixtureRoot]);

    expect(await readFile(plansReadmePath, "utf8")).toContain("MANUAL MARKER");
    const rerunSettings = JSON.parse(await readFile(path.join(fixtureRoot, ".claude", "settings.local.json"), "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const rerunStopCommands = rerunSettings.hooks?.Stop
      ?.flatMap((group) => group.hooks ?? [])
      .map((hook) => hook.command)
      .filter((command): command is string => isString(command) && command.includes("hf-claude-hook.js") && command.endsWith(" Stop")) ?? [];
    expect(rerunStopCommands).toHaveLength(1);

    runInstaller(["sync", "--target-dir", fixtureRoot]);

    expect(await readFile(opencodeAgentPath, "utf8")).toBe(await readFile(path.join(repoRoot, "agents", "hf-builder.md"), "utf8"));
    expect(await readFile(claudeAgentPath, "utf8")).toBe(await readFile(path.join(repoRoot, "agents", "hf-builder.md"), "utf8"));

    await writeFile(path.join(fixtureRoot, ".opencode", "agents", "custom-agent.md"), "custom agent\n", "utf8");
    await mkdir(path.join(fixtureRoot, ".opencode", "skills", "custom-skill"), { recursive: true });
    await writeFile(path.join(fixtureRoot, ".opencode", "skills", "custom-skill", "SKILL.md"), "custom skill\n", "utf8");

    runInstaller(["uninstall", "--target-dir", fixtureRoot]);

    await expect(stat(path.join(fixtureRoot, "plans", "README.md"))).resolves.toBeDefined();
    await expect(stat(path.join(fixtureRoot, "vault", "README.md"))).resolves.toBeDefined();
    await expect(stat(path.join(fixtureRoot, ".hybrid-framework", "generated-state.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(fixtureRoot, ".opencode", "plugins", "hybrid-runtime.js"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(opencodeAgentPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(claudeAgentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(fixtureRoot, ".opencode", "agents", "custom-agent.md"), "utf8")).toBe("custom agent\n");
    expect(await readFile(path.join(fixtureRoot, ".opencode", "skills", "custom-skill", "SKILL.md"), "utf8")).toBe("custom skill\n");

    const postUninstallSettings = JSON.parse(await readFile(path.join(fixtureRoot, ".claude", "settings.local.json"), "utf8")) as {
      permissions?: { allow?: string[] };
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    expect(postUninstallSettings.permissions?.allow).toContain("Bash(npm test)");
    expect(postUninstallSettings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toBe("node ./custom-stop.js");
    const remainingStopCommands = postUninstallSettings.hooks?.Stop
      ?.flatMap((group) => group.hooks ?? [])
      .map((hook) => hook.command)
      .filter((command): command is string => isString(command) && command.includes("hf-claude-hook.js") && command.endsWith(" Stop")) ?? [];
    expect(remainingStopCommands).toHaveLength(0);
  });

  test("init seeds index config defaults into hybrid-framework.json", async () => {
    const fixtureRoot = await createConsumerFixture();

    runInstaller(["init", "--skip-build", "--target-dir", fixtureRoot]);

    const raw = await readFile(path.join(fixtureRoot, "hybrid-framework.json"), "utf8");
    const config = JSON.parse(raw) as {
      index?: {
        enabled?: boolean;
        code?: { enabled?: boolean; roots?: string[]; extensions?: string[]; exclude?: string[] };
        semanticTopK?: number;
        maxChunkChars?: number;
        embeddingBatchSize?: number;
        timeoutMs?: number;
        charBudget?: number;
        planningCharBudget?: number;
        planningSemanticTopK?: number;
      };
    };

    expect(config.index).toBeDefined();
    expect(config.index?.enabled).toBe(true);
    expect(config.index?.code?.enabled).toBe(true);
    expect(Array.isArray(config.index?.code?.roots)).toBe(true);
    expect(config.index?.semanticTopK).toBeTypeOf("number");
    expect(config.index?.maxChunkChars).toBeTypeOf("number");
    expect(config.index?.charBudget).toBeTypeOf("number");
    expect(config.index?.planningCharBudget).toBeTypeOf("number");
    expect(config.index?.planningSemanticTopK).toBeTypeOf("number");
  });

  test("init preserves existing index config and does not overwrite it", async () => {
    const fixtureRoot = await createConsumerFixture();

    // Pre-seed a custom index config before init runs
    const configPath = path.join(fixtureRoot, "hybrid-framework.json");
    const existingConfig = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    existingConfig["index"] = { enabled: false, semanticTopK: 99 };
    await writeFile(configPath, JSON.stringify(existingConfig, null, 2), "utf8");

    runInstaller(["init", "--skip-build", "--target-dir", fixtureRoot]);

    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as { index?: { enabled?: boolean; semanticTopK?: number } };

    expect(config.index?.enabled).toBe(false);
    expect(config.index?.semanticTopK).toBe(99);
  });

  test("init preserves other top-level keys when seeding index config", async () => {
    const fixtureRoot = await createConsumerFixture();

    runInstaller(["init", "--skip-build", "--target-dir", fixtureRoot]);

    const raw = await readFile(path.join(fixtureRoot, "hybrid-framework.json"), "utf8");
    const config = JSON.parse(raw) as {
      adapters?: unknown;
      scaffold?: unknown;
      assets?: unknown;
      index?: unknown;
    };

    expect(config.adapters).toBeDefined();
    expect(config.scaffold).toBeDefined();
    expect(config.assets).toBeDefined();
    expect(config.index).toBeDefined();
  });
});

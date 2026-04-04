#!/usr/bin/env node
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionChoice = "install" | "init" | "sync" | "uninstall";
type PlatformChoice = "both" | "claude" | "opencode";

interface WizardOptions {
  yes: boolean;
  command: ActionChoice | null;
  platform: PlatformChoice | null;
  targetDir: string | null;
  skipBuild: boolean;
  configPath: string | null;
}

// Minimal types for the mjs lib functions used by this wizard
interface ParsedOptions {
  command: string;
  tool: string;
  configPath: string | null;
  skipBuild: boolean;
  platform: string;
  targetDir: string;
  help: boolean;
}

interface ProjectConfig {
  path: string;
  exists: boolean;
  value: Record<string, unknown>;
}

interface Manifest {
  version: number;
  packageName: string;
  adapters: Record<string, unknown>;
}

interface AdapterSelection {
  claude: boolean;
  opencode: boolean;
}

interface ScaffoldSelection {
  plans: boolean;
  vault: boolean;
}

interface HelpersLib {
  parseArgs: (argv: string[], options?: { forcedTool?: string | null }) => ParsedOptions;
  ensureTargetDir: (targetDir: string) => void;
  getPackageName: () => string;
  loadProjectConfig: (options: ParsedOptions) => ProjectConfig;
  readManifest: (targetDir: string) => Manifest;
  writeManifest: (targetDir: string, manifest: Manifest) => void;
  resolveAdapterSelection: (options: ParsedOptions, config: Record<string, unknown>, manifest: Manifest) => AdapterSelection;
  resolveScaffoldSelection: (options: ParsedOptions, config: Record<string, unknown>) => ScaffoldSelection;
  seedIndexConfig: (config: ProjectConfig) => void;
  scaffoldProject: (targetDir: string, scaffold: ScaffoldSelection) => void;
  isInstalledPackage: () => boolean;
  run: (command: string, args: string[]) => void;
  log: (message: string) => void;
}

interface ClaudeAdapterState {
  commands: string[];
  settingsPath: string;
  mcpConfigPath: string;
  generatedPaths: string[];
  managedDirectories: string[];
}

interface ClaudeLib {
  installClaude: (platform: string, targetDir: string, packageName: string) => ClaudeAdapterState;
  uninstallClaude: (targetDir: string, claudeState: unknown) => boolean;
}

interface OpencodeAdapterState {
  generatedPaths: string[];
  managedDirectories: string[];
}

interface OpencodeLib {
  installOpenCode: (targetDir: string, packageName: string) => OpencodeAdapterState;
  uninstallOpenCode: (targetDir: string, opencodeState: unknown) => boolean;
  runAssetSync: (options: ParsedOptions, adapters: AdapterSelection) => void;
}

interface InstallContext {
  helpers: HelpersLib;
  claudeLib: ClaudeLib;
  opencodeLib: OpencodeLib;
  options: ParsedOptions;
  manifest: Manifest;
  adapters: AdapterSelection;
  packageName: string;
}

// ---------------------------------------------------------------------------
// Path resolution: dist/src/bin/hf-setup.js → project root is ../../../
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When compiled: dist/src/bin/hf-setup.js → go up 3 levels to reach project root
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const libDir = path.join(projectRoot, "scripts", "lib");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): WizardOptions {
  const options: WizardOptions = {
    yes: false,
    command: null,
    platform: null,
    targetDir: null,
    skipBuild: false,
    configPath: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if ((arg === "--command" || arg === "-c") && argv[i + 1] !== undefined) {
      const val = argv[i + 1] as string;
      if (!["install", "init", "sync", "uninstall"].includes(val)) {
        throw new Error(`Unsupported --command value: ${val}. Must be one of: install, init, sync, uninstall`);
      }
      options.command = val as ActionChoice;
      i++;
      continue;
    }

    if (arg === "--platform" && argv[i + 1] !== undefined) {
      const val = argv[i + 1] as string;
      if (!["both", "claude", "opencode"].includes(val)) {
        throw new Error(`Unsupported --platform value: ${val}. Must be one of: both, claude, opencode`);
      }
      options.platform = val as PlatformChoice;
      i++;
      continue;
    }

    if (arg === "--target-dir" && argv[i + 1] !== undefined) {
      options.targetDir = path.resolve(argv[i + 1] as string);
      i++;
      continue;
    }

    if (arg === "--config" && argv[i + 1] !== undefined) {
      options.configPath = path.resolve(argv[i + 1] as string);
      i++;
      continue;
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Readline prompt helpers (stderr for prompts so stdout stays clean)
// ---------------------------------------------------------------------------

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askAction(rl: ReturnType<typeof createInterface>): Promise<ActionChoice> {
  process.stderr.write("\nSelect action:\n");
  process.stderr.write("  1) Install   — first-time wiring\n");
  process.stderr.write("  2) Init      — scaffold + wiring\n");
  process.stderr.write("  3) Sync      — refresh existing wiring\n");
  process.stderr.write("  4) Uninstall — remove wiring\n");

  const answer = await prompt(rl, "Choice [1-4] (default: 1): ");
  const map: Record<string, ActionChoice> = {
    "": "install",
    "1": "install",
    "2": "init",
    "3": "sync",
    "4": "uninstall",
    install: "install",
    init: "init",
    sync: "sync",
    uninstall: "uninstall"
  };

  const choice = map[answer];
  if (choice === undefined) {
    throw new Error(`Invalid choice: "${answer}". Enter 1-4 or a command name.`);
  }
  return choice;
}

async function askPlatform(rl: ReturnType<typeof createInterface>): Promise<PlatformChoice> {
  process.stderr.write("\nSelect platform:\n");
  process.stderr.write("  1) Both         — Claude + OpenCode\n");
  process.stderr.write("  2) Claude only\n");
  process.stderr.write("  3) OpenCode only\n");

  const answer = await prompt(rl, "Choice [1-3] (default: 1): ");
  const map: Record<string, PlatformChoice> = {
    "": "both",
    "1": "both",
    "2": "claude",
    "3": "opencode",
    both: "both",
    claude: "claude",
    opencode: "opencode"
  };

  const choice = map[answer];
  if (choice === undefined) {
    throw new Error(`Invalid choice: "${answer}". Enter 1-3 or a platform name.`);
  }
  return choice;
}

// ---------------------------------------------------------------------------
// Execute helpers — lifted to module level with explicit InstallContext param
// ---------------------------------------------------------------------------

function executeInstall(commandLabel: string, ctx: InstallContext): void {
  const nextManifest: Manifest = {
    version: 1,
    packageName: ctx.packageName,
    adapters: {
      ...ctx.manifest.adapters
    }
  };

  ctx.opencodeLib.runAssetSync(ctx.options, ctx.adapters);

  if (ctx.adapters.claude) {
    nextManifest.adapters["claude"] = ctx.claudeLib.installClaude(
      ctx.options.platform,
      ctx.options.targetDir,
      ctx.packageName
    );
  }

  if (ctx.adapters.opencode) {
    nextManifest.adapters["opencode"] = ctx.opencodeLib.installOpenCode(
      ctx.options.targetDir,
      ctx.packageName
    );
  }

  ctx.helpers.writeManifest(ctx.options.targetDir, nextManifest);
  ctx.helpers.log(`Hybrid runtime ${commandLabel} complete.`);
}

function executeUninstall(ctx: InstallContext): void {
  const nextManifest: Manifest = {
    ...ctx.manifest,
    adapters: {
      ...ctx.manifest.adapters
    }
  };

  if (ctx.adapters.claude) {
    ctx.claudeLib.uninstallClaude(ctx.options.targetDir, ctx.manifest.adapters["claude"]);
    delete nextManifest.adapters["claude"];
  }

  if (ctx.adapters.opencode) {
    ctx.opencodeLib.uninstallOpenCode(ctx.options.targetDir, ctx.manifest.adapters["opencode"]);
    delete nextManifest.adapters["opencode"];
  }

  ctx.helpers.writeManifest(ctx.options.targetDir, nextManifest);
  ctx.helpers.log("Hybrid runtime uninstall complete.");
}

// ---------------------------------------------------------------------------
// Context builder — loads libs and resolves parsed options + selections
// ---------------------------------------------------------------------------

interface SetupContext {
  ctx: InstallContext;
  config: ProjectConfig;
  scaffold: ScaffoldSelection;
  shouldScaffold: boolean;
}

async function buildSetupContext(
  command: ActionChoice,
  platform: PlatformChoice,
  opts: WizardOptions
): Promise<SetupContext> {
  // Dynamic imports of mjs lib files — resolved via file:// URL so Node ESM resolves correctly
  const helpers = (await import(`file://${path.join(libDir, "install-helpers.mjs")}`)) as HelpersLib;
  const claudeLib = (await import(`file://${path.join(libDir, "install-claude.mjs")}`)) as ClaudeLib;
  const opencodeLib = (await import(`file://${path.join(libDir, "install-opencode.mjs")}`)) as OpencodeLib;

  const toolMap: Record<PlatformChoice, string> = { both: "all", claude: "claude", opencode: "opencode" };

  const cliBits: string[] = [command, "--tool", toolMap[platform]];
  if (opts.targetDir !== null) cliBits.push("--target-dir", opts.targetDir);
  if (opts.skipBuild) cliBits.push("--skip-build");
  if (opts.configPath !== null) cliBits.push("--config", opts.configPath);

  const options = helpers.parseArgs(cliBits);
  helpers.ensureTargetDir(options.targetDir);

  const packageName = helpers.getPackageName();
  const config = helpers.loadProjectConfig(options);
  const manifest = helpers.readManifest(options.targetDir);
  const adapters = helpers.resolveAdapterSelection(options, config.value, manifest);
  const scaffold = helpers.resolveScaffoldSelection(options, config.value);
  const shouldScaffold = command === "init" && (scaffold.plans || scaffold.vault);
  const ctx: InstallContext = { helpers, claudeLib, opencodeLib, options, manifest, adapters, packageName };

  return { ctx, config, scaffold, shouldScaffold };
}

// ---------------------------------------------------------------------------
// Setup orchestration — replicates install-runtime.mjs logic via lib imports
// ---------------------------------------------------------------------------

async function runSetup(command: ActionChoice, platform: PlatformChoice, opts: WizardOptions): Promise<void> {
  const { ctx, config, scaffold, shouldScaffold } = await buildSetupContext(command, platform, opts);
  const { helpers, adapters, options } = ctx;

  if (!adapters.claude && !adapters.opencode && command !== "uninstall" && !shouldScaffold) {
    helpers.log(`No adapters are enabled for ${command}.`);
    if (config.exists) {
      helpers.log(`Config checked: ${path.relative(options.targetDir, config.path)}`);
    }
    return;
  }

  if (
    (command === "install" || command === "init") &&
    !options.skipBuild &&
    !helpers.isInstalledPackage() &&
    (adapters.claude || adapters.opencode)
  ) {
    helpers.run("npm", ["install"]);
    helpers.run("npm", ["run", "build"]);
  }

  if (command === "install") { executeInstall("install", ctx); return; }
  if (command === "sync") { executeInstall("sync", ctx); return; }
  if (command === "uninstall") { executeUninstall(ctx); return; }

  if (command === "init") {
    helpers.seedIndexConfig(config);
    helpers.scaffoldProject(options.targetDir, scaffold);
    executeInstall("install", ctx);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  // Non-interactive: --yes uses defaults; both --command and --platform supplied skips prompts
  const nonInteractive = opts.yes || (opts.command !== null && opts.platform !== null);

  let command: ActionChoice;
  let platform: PlatformChoice;

  if (nonInteractive) {
    command = opts.command ?? "install";
    platform = opts.platform ?? "both";
    process.stderr.write(`Running hf-setup: command=${command}, platform=${platform}\n`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stderr });

    try {
      command = opts.command ?? (await askAction(rl));
      platform = opts.platform ?? (await askPlatform(rl));
    } finally {
      rl.close();
    }

    process.stderr.write(`\nRunning: ${command} / ${platform}...\n`);
  }

  await runSetup(command, platform, opts);
  process.stderr.write("Done.\n");
}

main().catch((error: unknown) => {
  console.error((error as Error).message ?? String(error));
  process.exitCode = 1;
});

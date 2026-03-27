import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const packageJsonPath = path.join(sourceRoot, "package.json");
const defaultIndexConfigPath = path.join(sourceRoot, "schemas", "index-defaults.json");
const lifecycleCommands = ["install", "init", "sync", "uninstall"];
const configFileName = "hybrid-framework.json";
const manifestRelativePath = path.join(".hybrid-framework", "generated-state.json");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function getInvokedCommand(argv) {
  const executableName = path.basename(process.argv[1] ?? "").replace(/\.(cjs|mjs|js)$/u, "");
  const aliasedCommand = executableName.replace(/^hf-/u, "").replace(/-(claude|opencode)$/u, "");

  if (lifecycleCommands.includes(argv[0])) {
    return argv[0];
  }

  if (lifecycleCommands.includes(aliasedCommand)) {
    return aliasedCommand;
  }

  return "install";
}

function printHelp(forcedTool = null) {
  const commandPrefix = forcedTool ? `hf-<install|init|sync|uninstall>-${forcedTool}` : "hf-<install|init|sync|uninstall>";
  log("Hybrid Framework consumer lifecycle contract");
  log("");
  log("Commands:");
  if (forcedTool) {
    const toolLabel = forcedTool === "claude" ? "Claude" : "OpenCode";
    log(`  hf-install-${forcedTool}   Install ${toolLabel}-only adapter wiring into a target project.`);
    log(`  hf-init-${forcedTool}      Scaffold plans/vault workspace, then install ${toolLabel}-only wiring.`);
    log(`  hf-sync-${forcedTool}      Refresh generated ${toolLabel}-only adapter assets from canonical root assets.`);
    log(`  hf-uninstall-${forcedTool} Remove generated ${toolLabel}-only framework artifacts from a target project.`);
  } else {
    log("  hf-install   Install adapter wiring into a target project.");
    log("  hf-init      Scaffold plans/vault workspace, then install adapter wiring.");
    log("  hf-sync      Refresh generated adapter assets from canonical root assets.");
    log("  hf-uninstall Remove generated framework artifacts from a target project.");
  }
  log("");
  log("Options:");
  log("  --target-dir <path>  Target project root. Defaults to cwd when installed as a package, or the package repo root when developing locally.");
  if (forcedTool) {
    log(`  --tool <${forcedTool}>  Optional explicit adapter selection; this entry point always runs ${forcedTool}.`);
  } else {
    log("  --tool <all|claude|opencode>  Adapter selection for install/sync/uninstall.");
  }
  log("  --config <path>      Optional path to hybrid-framework.json in the target project.");
  log("  --platform <windows|linux>  Claude command rendering override.");
  log("  --skip-build         Skip npm install + npm run build before install.");
  log("  --help               Print this contract summary.");
  log("");
  log("Target-project config contract: hybrid-framework.json");
  log("  adapters.claude.enabled: boolean, default true");
  log("  adapters.opencode.enabled: boolean, default true");
  log("  scaffold.plans: boolean, default false for hf-install and hf-sync, true for hf-init");
  log("  scaffold.vault: boolean, default false for hf-install and hf-sync, true for hf-init");
  log("  assets.mode: one of references|copy|symlink, default references");
  log("  assets.claude.copy: array of canonical markdown asset paths, default []");
  log("  assets.opencode.copy: array of canonical markdown asset paths, default []");
  log("  assets.opencode.syncGenerated: boolean, default true");
  log("");
  log("Safe defaults with no config file:");
  if (forcedTool) {
    log(`  - ${commandPrefix} targets ${forcedTool} only and never switches to the other adapter.`);
    log(`  - hf-init-${forcedTool} creates plans/ and vault/ scaffolding, then wires ${forcedTool} only.`);
  } else {
    log("  - hf-install enables Claude and OpenCode wiring only.");
    log("  - hf-init creates plans/ and vault/ scaffolding, then wires Claude and OpenCode.");
  }
  log("  - hf-sync refreshes generated adapter surfaces while keeping repo-root markdown assets canonical.");
  log("  - hf-uninstall removes only generated framework artifacts and preserves unrelated user config.");
  log(`  - generated install state is tracked at ${manifestRelativePath.replaceAll("\\", "/")}.`);
}

function parseArgs(argv, { forcedTool = null } = {}) {
  const options = {
    command: getInvokedCommand(argv),
    tool: forcedTool ?? "all",
    configPath: null,
    skipBuild: false,
    platform: process.platform === "win32" ? "windows" : "linux",
    targetDir: isInstalledPackage() ? process.cwd() : sourceRoot,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (index === 0 && lifecycleCommands.includes(arg)) {
      continue;
    }

    if (arg === "--tool" && argv[index + 1]) {
      options.tool = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--platform" && argv[index + 1]) {
      options.platform = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--config" && argv[index + 1]) {
      options.configPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--target-dir" && argv[index + 1]) {
      options.targetDir = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  if (!["all", "claude", "opencode"].includes(options.tool)) {
    throw new Error(`Unsupported --tool value: ${options.tool}`);
  }

  if (forcedTool && options.tool !== forcedTool) {
    throw new Error(`This entry point only supports --tool ${forcedTool}`);
  }

  if (!["windows", "linux"].includes(options.platform)) {
    throw new Error(`Unsupported --platform value: ${options.platform}`);
  }

  return options;
}

function ensureTargetDir(targetDir) {
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }
}

function toProjectRelative(targetDir, filePath) {
  return path.relative(targetDir, filePath).split(path.sep).join("/");
}

function getConfigPath(options) {
  return options.configPath ?? path.join(options.targetDir, configFileName);
}

function loadProjectConfig(options) {
  const resolvedConfigPath = getConfigPath(options);
  const config = readJson(resolvedConfigPath, null);
  return {
    path: resolvedConfigPath,
    exists: config !== null,
    value: config ?? {}
  };
}

function readManifest(targetDir) {
  return readJson(path.join(targetDir, manifestRelativePath), {
    version: 1,
    packageName: getPackageName(),
    adapters: {}
  });
}

function writeManifest(targetDir, manifest) {
  const manifestPath = path.join(targetDir, manifestRelativePath);
  const hasAdapters = Object.keys(manifest.adapters ?? {}).length > 0;

  if (!hasAdapters) {
    fs.rmSync(manifestPath, { force: true });
    removeEmptyParents(path.dirname(manifestPath), targetDir);
    return;
  }

  writeJson(manifestPath, manifest);
}

function resolveAdapterSelection(options, config, manifest) {
  const configAdapters = config.adapters ?? {};
  const defaults = {
    claude: configAdapters.claude?.enabled ?? true,
    opencode: configAdapters.opencode?.enabled ?? true
  };

  if (options.command === "uninstall" && options.tool === "all") {
    return {
      claude: true,
      opencode: true
    };
  }

  if (options.tool === "claude") {
    return { claude: true, opencode: false };
  }

  if (options.tool === "opencode") {
    return { claude: false, opencode: true };
  }

  return defaults;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: sourceRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeTextIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return true;
}

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyIfMissing(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function getPackageName() {
  const packageJson = readJson(packageJsonPath, {});
  return typeof packageJson.name === "string" && packageJson.name.length > 0
    ? packageJson.name
    : "hybrid-framework";
}

function isSelfInstall(targetDir) {
  return path.resolve(targetDir) === sourceRoot;
}

function isInstalledPackage() {
  return sourceRoot.split(path.sep).includes("node_modules");
}

function resolveScaffoldSelection(options, config) {
  const scaffoldConfig = config.scaffold ?? {};
  const defaults = {
    plans: options.command === "init",
    vault: options.command === "init"
  };

  return {
    plans: scaffoldConfig.plans ?? defaults.plans,
    vault: scaffoldConfig.vault ?? defaults.vault
  };
}

const DEFAULT_INDEX_CONFIG = readJson(defaultIndexConfigPath, null);

function seedIndexConfig(config) {
  const existing = config.value;
  if (existing.index) {
    return;
  }

  const merged = { ...existing, index: DEFAULT_INDEX_CONFIG };
  writeJson(config.path, merged);
  log(`Seeded index config in ${path.basename(config.path)}`);
}

function buildPackageRelativePath(targetDir, packageName, segments) {
  if (isSelfInstall(targetDir)) {
    return segments.join("/");
  }

  return ["node_modules", packageName, ...segments].join("/");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isObjectEmpty(value) {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function removeEmptyParents(startPath, stopPath) {
  let currentPath = startPath;
  while (path.resolve(currentPath).startsWith(path.resolve(stopPath))) {
    if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isDirectory()) {
      return;
    }

    if (fs.readdirSync(currentPath).length > 0) {
      return;
    }

    fs.rmdirSync(currentPath);

    if (path.resolve(currentPath) === path.resolve(stopPath)) {
      return;
    }

    currentPath = path.dirname(currentPath);
  }
}

function removeManifestEntries(targetDir, entries) {
  const sortedEntries = [...entries].sort((left, right) => right.length - left.length);
  for (const entry of sortedEntries) {
    const entryPath = path.join(targetDir, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
    removeEmptyParents(path.dirname(entryPath), targetDir);
  }
}

function pruneEmptyDirectories(targetDir, entries) {
  const sortedEntries = [...entries].sort((left, right) => right.length - left.length);
  for (const entry of sortedEntries) {
    const entryPath = path.join(targetDir, entry);
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isDirectory()) {
      continue;
    }

    if (fs.readdirSync(entryPath).length === 0) {
      fs.rmdirSync(entryPath);
      removeEmptyParents(path.dirname(entryPath), targetDir);
    }
  }
}

function listFilesRecursively(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(fullPath);
    }
  }

  return files;
}

function scaffoldPlans(targetDir) {
  const plansRoot = path.join(targetDir, "plans");
  fs.mkdirSync(path.join(plansRoot, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(plansRoot, "runtime"), { recursive: true });

  copyIfMissing(path.join(sourceRoot, "plans", "README.md"), path.join(plansRoot, "README.md"));
  writeTextIfMissing(path.join(plansRoot, "evidence", ".gitkeep"), "");
  writeTextIfMissing(path.join(plansRoot, "runtime", ".gitkeep"), "");
}

function scaffoldVault(targetDir) {
  const vaultRoot = path.join(targetDir, "vault");
  fs.mkdirSync(path.join(vaultRoot, "plans"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "shared"), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, "templates"), { recursive: true });

  copyIfMissing(path.join(sourceRoot, "vault", "README.md"), path.join(vaultRoot, "README.md"));
  writeTextIfMissing(path.join(vaultRoot, "plans", ".gitkeep"), "");

  const templateNames = [
    "plan-context.md",
    "plan-discoveries.md",
    "plan-decisions.md",
    "plan-references.md",
    "shared-architecture.md",
    "shared-patterns.md",
    "shared-decisions.md"
  ];

  for (const templateName of templateNames) {
    copyIfMissing(
      path.join(sourceRoot, "vault", "templates", templateName),
      path.join(vaultRoot, "templates", templateName)
    );
  }

  copyIfMissing(
    path.join(sourceRoot, "vault", "templates", "shared-architecture.md"),
    path.join(vaultRoot, "shared", "architecture.md")
  );
  copyIfMissing(
    path.join(sourceRoot, "vault", "templates", "shared-patterns.md"),
    path.join(vaultRoot, "shared", "patterns.md")
  );
  copyIfMissing(
    path.join(sourceRoot, "vault", "templates", "shared-decisions.md"),
    path.join(vaultRoot, "shared", "decisions.md")
  );
}

function scaffoldProject(targetDir, scaffold) {
  if (scaffold.plans) {
    scaffoldPlans(targetDir);
  }

  if (scaffold.vault) {
    scaffoldVault(targetDir);
  }

  if (scaffold.plans || scaffold.vault) {
    log("Project scaffolding ready.");
  }
}

function collectGeneratedAssetState(targetDir, directories) {
  const generatedPaths = [];
  const managedDirectories = [];

  for (const relativeDir of directories) {
    const absoluteDir = path.join(targetDir, relativeDir);
    if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
      continue;
    }

    managedDirectories.push(relativeDir);
    generatedPaths.push(...listFilesRecursively(absoluteDir).map((filePath) => toProjectRelative(targetDir, filePath)));
  }

  return {
    generatedPaths: [...new Set(generatedPaths)],
    managedDirectories
  };
}

export {
  DEFAULT_INDEX_CONFIG,
  buildPackageRelativePath,
  collectGeneratedAssetState,
  configFileName,
  copyIfMissing,
  copyIfPresent,
  ensureTargetDir,
  getConfigPath,
  getInvokedCommand,
  getPackageName,
  isObjectEmpty,
  isInstalledPackage,
  isPlainObject,
  isSelfInstall,
  lifecycleCommands,
  listFilesRecursively,
  loadProjectConfig,
  log,
  manifestRelativePath,
  packageJsonPath,
  parseArgs,
  printHelp,
  pruneEmptyDirectories,
  readJson,
  readManifest,
  removeEmptyParents,
  removeManifestEntries,
  resolveAdapterSelection,
  resolveScaffoldSelection,
  run,
  scaffoldPlans,
  scaffoldProject,
  scaffoldVault,
  seedIndexConfig,
  sourceRoot,
  toProjectRelative,
  writeJson,
  writeManifest,
  writeTextIfMissing
};

# Quickstart

Use this when you want to start fast.

## 1) Install and build

```bash
npm install
npm run build
```

## 2) Run baseline checks

```bash
npm run validate:assets
npm test
```

## 3) Verify runtime profile

```bash
node dist/cli/index.js doctor
```

## 4) Try core CLI flow

```bash
framework agents
framework skills
framework run --intent "implement feature" --mode fast
```

## 5) Use command contracts

Command definitions are in `.opencode/commands/`.

Recommended flow:
1. `setup`
2. `plan-feature`
3. `run-core-delegation`
4. `verify`
5. `finish`

## 6) Safe install/update of `.opencode` assets

Default mode is `symlink`.

```bash
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --dry-run
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup
node scripts/install/install-opencode-assets.mjs --target .opencode.local --collision backup --open-env
```

Global linked install (recommended):

```bash
git clone <your-repo-url> ~/.config/opencode/hybrid-framework
cd ~/.config/opencode/hybrid-framework
node scripts/install/install-opencode-assets.mjs --target ~/.config/opencode --mode symlink --collision backup --open-env
```

Use `--mode copy` if you need copied files instead of links.

Uninstall example:

```bash
node scripts/install/uninstall-opencode-assets.mjs --target ~/.config/opencode --dry-run
node scripts/install/uninstall-opencode-assets.mjs --target ~/.config/opencode
```

Collision policies:
- `skip`
- `overwrite`
- `backup`
- `cancel`

## 7) Token usage harness

```bash
npm run eval:transcript
```

## 8) MCP setup (optional)

```bash
# PowerShell (option A)
$env:TAVILY_API_KEY="your_tavily_key"

# PowerShell (option B)
$env:TAVILY_MCP_URL="https://mcp.tavily.com/mcp/?tavilyApiKey=<your_tavily_key>"

# Run live MCP searches
node dist/cli/index.js mcp-search --provider tavily --query "typescript orchestration"
node dist/cli/index.js mcp-search --provider gh-grep --query "useEffect(" --json
```

## Where to look next

- Full project overview: `README.md`
- Architecture and contracts: `docs/architecture.md`, `docs/architecture-contracts.md`
- Install and validation ops: `docs/install-and-validation.md`
- Portability notes: `docs/portability-matrix.md`

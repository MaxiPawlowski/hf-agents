# Consumer Install Contract

This repo serves two different audiences:

- Package maintainers work in this repository and edit the canonical framework assets at the repo root.
- Consumer projects install the package, run explicit lifecycle commands, and treat generated adapter folders as managed output.

---

## Installation Rules

**Project-level installation only.** The OpenCode plugin and Claude hooks are installed per-project. No global installation path is supported - the vault system is project-scoped (`vault/plans/<slug>/`, `vault/shared/`), so a globally-installed plugin has no way to locate the correct vault. Always run `hf-setup` inside each target project.

**Install only the adapter(s) you need.** `hf-setup` supports `--platform claude`, `--platform opencode`, or `--platform both` (default). Claude-only consumers do not need to install OpenCode and vice versa.

Package installation and project initialization are separate steps.

1. Install the package into a target project: `npm install <package-name-or-tarball>`
2. Run an explicit lifecycle command from the target project using `hf-setup`:
   - Interactive wizard (prompts for command and platform): `npm exec hf-setup`
   - Combined (both platforms): `npm exec hf-setup --command init`
   - Claude-only: `npm exec hf-setup --command init --platform claude`
   - OpenCode-only: `npm exec hf-setup --command init --platform opencode`
   - Non-interactive / CI: add `--yes` to skip all prompts

`postinstall` still runs after `npm install`, but it is informational only in consumer projects. It does not wire adapters, scaffold folders, or remove anything implicitly. Its job is to point operators at `hf-setup`.

---

## Consumer Quick Start

Use one of these flows inside the target project that will consume the framework:

### Combined install: Claude + OpenCode

```bash
npm install hybrid-framework   # or: npm install /path/to/hybrid-framework-<version>.tgz
npm exec hf-setup --command init
```

### Claude-only install

```bash
npm install hybrid-framework
npm exec hf-setup --command init --platform claude
```

### OpenCode-only install

```bash
npm install hybrid-framework
npm exec hf-setup --command init --platform opencode
```

### Interactive wizard

```bash
npm install hybrid-framework
npm exec hf-setup   # prompts for command and platform
```

### Non-interactive / CI

```bash
npm install hybrid-framework
npm exec hf-setup --command init --yes
```

Those sequences keep installation explicit:

- `npm install` adds the package only.
- `npm exec hf-setup --command init` scaffolds `plans/` and `vault/`, then wires both adapters by default.
- `npm exec hf-setup --command init --platform claude` scaffolds `plans/` and `vault/`, then wires only Claude.
- `npm exec hf-setup --command init --platform opencode` scaffolds `plans/` and `vault/`, then wires only OpenCode.
- `--yes` skips all interactive prompts; safe for CI pipelines.
- All commands default to the current working directory; pass `--target-dir <path>` to target a different directory.
- The build step is skipped automatically when running from an installed package; no `--skip-build` flag is needed.
- Later reruns use `hf-setup --command sync` instead of relying on package-manager side effects.

Consumer projects can also keep the full lifecycle as local scripts:

```json
{
  "scripts": {
    "hf:init": "hf-setup --command init",
    "hf:sync": "hf-setup --command sync",
    "hf:uninstall": "hf-setup --command uninstall"
  }
}
```

Adapter-specific local scripts are also supported when a project only needs one tool:

```json
{
  "scripts": {
    "hf:init:claude": "hf-setup --command init --platform claude",
    "hf:sync:claude": "hf-setup --command sync --platform claude",
    "hf:uninstall:claude": "hf-setup --command uninstall --platform claude",
    "hf:init:opencode": "hf-setup --command init --platform opencode",
    "hf:sync:opencode": "hf-setup --command sync --platform opencode",
    "hf:uninstall:opencode": "hf-setup --command uninstall --platform opencode"
  }
}
```

---

## hf-setup Flags

`hf-setup` is the unified lifecycle wizard. All old per-lifecycle and per-platform commands (`hf-install`, `hf-init`, `hf-sync`, `hf-uninstall`, `hf-install-claude`, etc.) are replaced by `hf-setup` with explicit flags.

| Flag | Values | Default | Description |
|---|---|---|---|
| `--command` | `install \| init \| sync \| uninstall` | prompted interactively | Lifecycle operation to perform |
| `--platform` | `claude \| opencode \| both` | prompted interactively (defaults to `both`) | Which adapter(s) to operate on |
| `--yes` | — | `false` | Skip all interactive prompts; accept defaults |
| `--target-dir` | `<path>` | current working directory | Target project directory |
| `--config` | `<path>` | `hybrid-framework.json` in target dir | Path to consumer config file |

### Interactive mode

Running `npm exec hf-setup` without `--command` launches the wizard, which prompts:
1. Which lifecycle operation: `install`, `init`, `sync`, or `uninstall`
2. Which platform(s): `claude`, `opencode`, or `both`

### CI mode

Pass `--yes` to skip all prompts and use flag defaults. Combine with `--command` and `--platform` for fully non-interactive execution:

```bash
npm exec hf-setup --command init --platform both --yes
```

---

## Lifecycle Command Contract

| `--command` | Scope | Inputs | Outputs |
|---|---|---|---|
| `install` | Wire selected adapters into an existing project without creating framework folders by default | `--target-dir`, `--config`, `--platform`, `--yes` | merged Claude hooks, generated `.opencode/plugins/hybrid-runtime.js`, generated `.opencode/registry.json`, generated adapter-local metadata |
| `init` | Initialize a project for first use, scaffold the framework workspace, then run install wiring | `--target-dir`, `--config`, `--platform`, `--yes` | everything from install plus `plans/`, `plans/evidence/`, `plans/runtime/`, `vault/`, `vault/plans/`, `vault/shared/`, `vault/templates/`, copied starter docs, and empty-dir markers where needed |
| `sync` | Refresh generated adapter surfaces from canonical package assets | `--target-dir`, `--config`, `--platform`, `--yes` | updated generated `.claude/` and `.opencode/` surfaces, copied or linked markdown assets per config |
| `uninstall` | Remove generated framework artifacts without relying on package-manager side effects | `--target-dir`, `--config`, `--platform`, `--yes` | removed generated adapters/assets, reversed generated hook/plugin wiring, preserved unrelated user-owned settings |

### Platform mapping

| Purpose | `hf-setup` command | Old dedicated command (removed) |
|---|---|---|
| Install Claude wiring into an existing project | `hf-setup --command install --platform claude` | `hf-install-claude` |
| Scaffold `plans/` + `vault/`, then install Claude wiring | `hf-setup --command init --platform claude` | `hf-init-claude` |
| Refresh managed Claude output | `hf-setup --command sync --platform claude` | `hf-sync-claude` |
| Remove managed Claude output | `hf-setup --command uninstall --platform claude` | `hf-uninstall-claude` |
| Install OpenCode wiring into an existing project | `hf-setup --command install --platform opencode` | `hf-install-opencode` |
| Scaffold `plans/` + `vault/`, then install OpenCode wiring | `hf-setup --command init --platform opencode` | `hf-init-opencode` |
| Refresh managed OpenCode output | `hf-setup --command sync --platform opencode` | `hf-sync-opencode` |
| Remove managed OpenCode output | `hf-setup --command uninstall --platform opencode` | `hf-uninstall-opencode` |
| Install both adapters | `hf-setup --command install` | `hf-install` |
| Init both adapters (first run) | `hf-setup --command init` | `hf-init` |
| Sync both adapters | `hf-setup --command sync` | `hf-sync` |
| Uninstall both adapters | `hf-setup --command uninstall` | `hf-uninstall` |

Ownership rules:

- `hf-setup --command init` copies `plans/README.md`, `vault/README.md`, `vault/templates/*`, and starter `vault/shared/*.md` files into the target project as editable local content; reruns keep existing edits and only fill in missing files.
- `hf-setup --command install` and `hf-setup --command sync` keep `.claude/` and `.opencode/` as generated adapter mirrors derived from the package's canonical assets.
- `hf-setup --command uninstall` removes generated adapter artifacts tracked in `.hybrid-framework/generated-state.json` and preserves project-local scaffold content under `plans/` and `vault/`.

---

## Target Project Config

Consumer config lives at `hybrid-framework.json` in the target project root unless `--config <path>` is passed.

```json
{
  "adapters": {
    "claude": {
      "enabled": true
    },
    "opencode": {
      "enabled": true
    }
  },
  "scaffold": {
    "plans": true,
    "vault": true
  },
  "assets": {
    "mode": "references",
    "claude": {
      "copy": []
    },
    "opencode": {
      "copy": [],
      "syncGenerated": true
    }
  }
}
```

Config rules:

- `adapters.*.enabled` selects which adapter surfaces are managed; when no config exists, both `claude` and `opencode` default to enabled.
- `scaffold.plans` and `scaffold.vault` control whether `hf-setup --command init` creates framework folders such as `plans/`, `plans/evidence/`, `plans/runtime/`, `vault/`, `vault/plans/`, and `vault/shared/`; `install` and `sync` commands leave scaffolding off by default.
- When scaffolding is enabled, `hf-setup --command init` also copies editable starter docs into those folders and seeds `vault/shared/` from `vault/templates/` without overwriting existing project files.
- `assets.mode` decides how adapter-local surfaces are materialized: `references` keeps repo-root markdown assets canonical, `copy` generates editable local copies, and `symlink` links when the environment allows it.
- `assets.claude.copy` and `assets.opencode.copy` list canonical markdown asset paths that should be copied into generated `.claude/` or `.opencode/` surfaces for the consumer project.
- `assets.opencode.syncGenerated` preserves today's generated `.opencode/agents/` and `.opencode/skills/` sync behavior when enabled.

Safe defaults with no config file:

- `hf-setup --command install` wires Claude and OpenCode only.
- `hf-setup --command init` creates the recommended `plans/` and `vault/` scaffold, copies starter docs/templates, and then wires Claude and OpenCode.
- `hf-setup --command sync` refreshes generated adapter surfaces but does not move the canonical markdown source of truth out of the package root.
- `hf-setup --command uninstall` is expected to remove only generated framework artifacts and leave unrelated user-authored config alone.

If a project only needs one adapter, pass `--platform claude` or `--platform opencode` instead of relying on config changes just to avoid wiring the other adapter.

Repo-root markdown assets remain canonical. Generated `.claude/` and `.opencode/` surfaces in consumer projects are adapter-local copies, references, or links derived from those root assets.

---

## Consumer Project Flow

The end-to-end consumer flow after package installation is:

1. Install the package with `npm install`.
2. Initialize the project once with `hf-setup --command init` (both adapters), `hf-setup --command init --platform claude` (Claude only), or `hf-setup --command init --platform opencode` (OpenCode only).
3. Customize `hybrid-framework.json` when the project wants different adapters, scaffold defaults, or asset sync behavior.
4. Run the matching sync command after config changes or package upgrades: `hf-setup --command sync`, `hf-setup --command sync --platform claude`, or `hf-setup --command sync --platform opencode`.
5. Use the generated `plans/` and `vault/` content as editable project-local workflow docs.
6. Run `hf-setup --command uninstall` (with optional `--platform`) when removing the framework so generated adapter artifacts are cleaned up intentionally.

### Generated Target Layout

After `hf-setup --command init --target-dir .`, a consumer project typically contains:

```text
.
|- hybrid-framework.json        Consumer-owned framework config
|- plans/
|  |- README.md                 Editable local guidance copied from the package
|  |- evidence/
|  `- runtime/
|- vault/
|  |- README.md                 Editable local guidance copied from the package
|  |- plans/
|  |- shared/
|  `- templates/
|- .claude/
|  |- README.md                 Generated adapter guidance
|  `- settings.local.json       Managed hook wiring merged with user settings
`- .opencode/
   |- README.md                 Generated adapter guidance
   |- plugins/hybrid-runtime.js Managed plugin loader
   |- registry.json             Managed asset registry
   |- agents/                   Generated when OpenCode asset sync is enabled
   `- skills/                   Generated when OpenCode asset sync is enabled
```

The package-maintainer view in this repository is different:

- Root `agents/`, `subagents/`, `skills/`, `src/`, and `schemas/` stay canonical here.
- Consumer projects should not edit generated `.claude/` or `.opencode/` files by hand unless they intentionally stop managing them.
- Consumer projects should edit `hybrid-framework.json`, `plans/`, and `vault/` instead of patching package internals.

### install vs init vs sync vs uninstall

- `hf-setup --command install` wires adapters into an existing project without creating the full planning scaffold.
- `hf-setup --command init` is the first-run command for most consumer projects because it creates `plans/` and `vault/` and then performs install wiring.
- `hf-setup --command sync` re-generates adapter-local surfaces from the package's canonical assets after config or package changes.
- `hf-setup --command uninstall` removes only generated framework artifacts tracked by the package lifecycle metadata and preserves consumer-owned planning docs.
- Add `--platform claude` or `--platform opencode` to any command to scope it to a single adapter.

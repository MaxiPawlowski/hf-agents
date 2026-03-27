# Consumer Install Contract

This repo serves two different audiences:

- Package maintainers work in this repository and edit the canonical framework assets at the repo root.
- Consumer projects install the package, run explicit lifecycle commands, and treat generated adapter folders as managed output.

---

## Installation Rules

**Project-level installation only.** The OpenCode plugin and Claude hooks are installed per-project. No global installation path is supported - the vault system is project-scoped (`vault/plans/<slug>/`, `vault/shared/`), so a globally-installed plugin has no way to locate the correct vault. Always run `hf-init` or `hf-install` inside each target project.

**Install only the adapter(s) you need.** The combined lifecycle commands still support wiring both adapters, but Claude-only consumers do not need to install OpenCode and OpenCode-only consumers do not need to install Claude.

Package installation and project initialization are separate steps.

1. Install the package into a target project: `npm install <package-name-or-tarball>`
2. Run an explicit lifecycle command from the target project:
   - Combined: `npm exec hf-install`, `npm exec hf-init`, `npm exec hf-sync`, `npm exec hf-uninstall`
   - Claude-only: `npm exec hf-install-claude`, `npm exec hf-init-claude`, `npm exec hf-sync-claude`, `npm exec hf-uninstall-claude`
   - OpenCode-only: `npm exec hf-install-opencode`, `npm exec hf-init-opencode`, `npm exec hf-sync-opencode`, `npm exec hf-uninstall-opencode`

`postinstall` still runs after `npm install`, but it is informational only in consumer projects. It does not wire adapters, scaffold folders, or remove anything implicitly. Its job is to point operators at the explicit lifecycle commands.

---

## Consumer Quick Start

Use one of these flows inside the target project that will consume the framework:

### Combined install: Claude + OpenCode

```bash
npm install hybrid-framework   # or: npm install /path/to/hybrid-framework-<version>.tgz
npm exec hf-init
```

### Claude-only install

```bash
npm install hybrid-framework
npm exec hf-init-claude
```

### OpenCode-only install

```bash
npm install hybrid-framework
npm exec hf-init-opencode
```

Those sequences keep installation explicit:

- `npm install` adds the package only.
- `npm exec hf-init` scaffolds `plans/` and `vault/`, then wires both adapters by default.
- `npm exec hf-init-claude` scaffolds `plans/` and `vault/`, then wires only Claude.
- `npm exec hf-init-opencode` scaffolds `plans/` and `vault/`, then wires only OpenCode.
- All init commands default to the current working directory; pass `--target-dir <path>` to target a different directory.
- The build step is skipped automatically when running from an installed package; no `--skip-build` flag is needed.
- Later reruns use the matching sync command instead of relying on package-manager side effects.

Consumer projects can also keep the full lifecycle as local scripts:

```json
{
  "scripts": {
    "hf:install": "hf-install",
    "hf:init": "hf-init",
    "hf:sync": "hf-sync",
    "hf:uninstall": "hf-uninstall"
  }
}
```

Adapter-specific local scripts are also supported when a project only needs one tool:

```json
{
  "scripts": {
    "hf:init:claude": "hf-init-claude",
    "hf:sync:claude": "hf-sync-claude",
    "hf:uninstall:claude": "hf-uninstall-claude",
    "hf:init:opencode": "hf-init-opencode",
    "hf:sync:opencode": "hf-sync-opencode",
    "hf:uninstall:opencode": "hf-uninstall-opencode"
  }
}
```

---

## Lifecycle Command Contract

| Command | Scope | Inputs | Outputs |
|---|---|---|---|
| `hf-install` | Wire selected adapters into an existing project without creating framework folders by default | `--target-dir`, `--tool`, `--config`, `--platform`, `--skip-build` | merged Claude hooks, generated `.opencode/plugins/hybrid-runtime.js`, generated `.opencode/registry.json`, generated adapter-local metadata |
| `hf-init` | Initialize a project for first use, scaffold the framework workspace, then run install wiring | `--target-dir`, `--tool`, `--config`, `--platform`, `--skip-build` | everything from install plus `plans/`, `plans/evidence/`, `plans/runtime/`, `vault/`, `vault/plans/`, `vault/shared/`, `vault/templates/`, copied starter docs, and empty-dir markers where needed |
| `hf-sync` | Refresh generated adapter surfaces from canonical package assets | `--target-dir`, `--tool`, `--config` | updated generated `.claude/` and `.opencode/` surfaces, copied or linked markdown assets per config |
| `hf-uninstall` | Remove generated framework artifacts without relying on package-manager side effects | `--target-dir`, `--tool`, `--config` | removed generated adapters/assets, reversed generated hook/plugin wiring, preserved unrelated user-owned settings |

Dedicated command aliases map to the same lifecycle behavior with a fixed adapter selection:

| Adapter | Install existing project | Init first-run project | Sync generated surface | Uninstall managed surface | Combined equivalent |
|---|---|---|---|---|---|
| Claude-only | `hf-install-claude` | `hf-init-claude` | `hf-sync-claude` | `hf-uninstall-claude` | `hf-<lifecycle> --tool claude` |
| OpenCode-only | `hf-install-opencode` | `hf-init-opencode` | `hf-sync-opencode` | `hf-uninstall-opencode` | `hf-<lifecycle> --tool opencode` |

Use the dedicated aliases when a project only needs one adapter. Use the combined commands when the project wants both adapters or prefers the explicit `--tool` flag.

Ownership rules:

- `hf-init` copies `plans/README.md`, `vault/README.md`, `vault/templates/*`, and starter `vault/shared/*.md` files into the target project as editable local content; reruns keep existing edits and only fill in missing files.
- `hf-install` and `hf-sync` keep `.claude/` and `.opencode/` as generated adapter mirrors derived from the package's canonical assets.
- `hf-uninstall` removes generated adapter artifacts tracked in `.hybrid-framework/generated-state.json` and preserves project-local scaffold content under `plans/` and `vault/`.

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
- `scaffold.plans` and `scaffold.vault` control whether `hf-init` creates framework folders such as `plans/`, `plans/evidence/`, `plans/runtime/`, `vault/`, `vault/plans/`, and `vault/shared/`; `hf-install` and `hf-sync` leave scaffolding off by default.
- When scaffolding is enabled, `hf-init` also copies editable starter docs into those folders and seeds `vault/shared/` from `vault/templates/` without overwriting existing project files.
- `assets.mode` decides how adapter-local surfaces are materialized: `references` keeps repo-root markdown assets canonical, `copy` generates editable local copies, and `symlink` links when the environment allows it.
- `assets.claude.copy` and `assets.opencode.copy` list canonical markdown asset paths that should be copied into generated `.claude/` or `.opencode/` surfaces for the consumer project.
- `assets.opencode.syncGenerated` preserves today's generated `.opencode/agents/` and `.opencode/skills/` sync behavior when enabled.

Safe defaults with no config file:

- `hf-install` wires Claude and OpenCode only.
- `hf-init` creates the recommended `plans/` and `vault/` scaffold, copies starter docs/templates, and then wires Claude and OpenCode.
- `hf-sync` refreshes generated adapter surfaces but does not move the canonical markdown source of truth out of the package root.
- `hf-uninstall` is expected to remove only generated framework artifacts and leave unrelated user-authored config alone.

If a project only needs one adapter, prefer the dedicated commands instead of relying on config changes just to avoid wiring the other adapter.

Repo-root markdown assets remain canonical. Generated `.claude/` and `.opencode/` surfaces in consumer projects are adapter-local copies, references, or links derived from those root assets.

---

## Consumer Project Flow

The end-to-end consumer flow after package installation is:

1. Install the package with `npm install`.
2. Initialize the project once with `hf-init`, `hf-init-claude`, or `hf-init-opencode` depending on whether the project needs both adapters, Claude only, or OpenCode only.
3. Customize `hybrid-framework.json` when the project wants different adapters, scaffold defaults, or asset sync behavior.
4. Run the matching sync command after config changes or package upgrades: `hf-sync`, `hf-sync-claude`, or `hf-sync-opencode`.
5. Use the generated `plans/` and `vault/` content as editable project-local workflow docs.
6. Run the matching uninstall command when removing the framework so generated adapter artifacts are cleaned up intentionally.

### Generated Target Layout

After `hf-init --target-dir .`, a consumer project typically contains:

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

### Install vs Init vs Sync vs Uninstall

- `hf-install` wires adapters into an existing project without creating the full planning scaffold.
- `hf-init` is the first-run command for most consumer projects because it creates `plans/` and `vault/` and then performs install wiring.
- `hf-sync` re-generates adapter-local surfaces from the package's canonical assets after config or package changes.
- `hf-uninstall` removes only generated framework artifacts tracked by the package lifecycle metadata and preserves consumer-owned planning docs.
- `hf-install-claude`, `hf-init-claude`, `hf-sync-claude`, and `hf-uninstall-claude` are the Claude-only equivalents.
- `hf-install-opencode`, `hf-init-opencode`, `hf-sync-opencode`, and `hf-uninstall-opencode` are the OpenCode-only equivalents.
